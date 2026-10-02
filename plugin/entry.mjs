/**
 * dsh-isopleth / plugin
 *
 * 客户端插件形态：不依赖任何框架、不依赖宿主 API，只用 Web 标准（CompressionStream / matchMedia）。
 * 打包成单文件后可以直接像 platform-purple/dracula-map.js 那样注入渲染进程。
 *
 * 契约：
 *   - 只在初始化时生成一次，之后走缓存；重复 apply 不会重算，更没有每帧逻辑
 *   - 尊重 prefers-reduced-motion（无动画；只有显式要求 fadeIn 时才加过渡，且被该媒体查询关掉）
 *   - 失败不抛给宿主：apply() 返回 {ok:false, error}，并在 target 上留下 data-isopleth-error
 */

import { createTerrainTexture, fullTerrainConfig } from '../src/browser.mjs';
import { TOKENS } from '../src/tokens.mjs';

export const PLUGIN_ID = 'dsh-isopleth';
export const PLUGIN_VERSION = '0.4.0';

export const PLUGIN_DEFAULTS = {
  seed: 'isopleth-01',
  width: 1440,
  height: 1000,
  levels: 9,
  bands: true,
  lighting: true,
  water: true,
  /** CSS：铺满容器且不重复（底纹本身就是完整一张图，禁止平铺） */
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  /** 可选淡入；prefers-reduced-motion: reduce 时自动跳过 */
  fadeIn: false,
  fadeInMs: 240,
};

export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * @param {Partial<typeof PLUGIN_DEFAULTS>} options
 */
export function createIsoplethPlugin(options = {}) {
  const opts = { ...PLUGIN_DEFAULTS, ...options };

  let cache = null;     // { key, css, svg, bytes, ms }
  let inflight = null;  // { key, promise }
  let generations = 0;  // 生成次数，用来证明「只生成一次」

  const cacheKey = () =>
    [
      opts.seed, opts.width, opts.height, opts.levels,
      opts.bands ? 'b' : '-', opts.lighting ? 'l' : '-', opts.water ? 'w' : '-',
      opts.theme ? JSON.stringify(opts.theme) : '',
    ].join('|');

  /** 生成（或取缓存）。同一 key 并发调用只会真的算一次。 */
  function texture() {
    const key = cacheKey();
    if (cache && cache.key === key) return Promise.resolve(cache);
    if (inflight && inflight.key === key) return inflight.promise;

    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const promise = createTerrainTexture(
      fullTerrainConfig({
        seed: opts.seed,
        width: opts.width,
        height: opts.height,
        theme: opts.theme,
        ...(opts.terrain ?? {}),
      }),
    ).then((svg) => {
      const entry = {
        key,
        svg,
        css: `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`,
        bytes: svg.length,
        ms: (typeof performance !== 'undefined' ? performance : Date).now() - t0,
      };
      cache = entry;
      inflight = null;
      generations++;
      return entry;
    });

    inflight = { key, promise: promise.catch((e) => { inflight = null; throw e; }) };
    return inflight.promise;
  }

  /**
   * 应用到元素：把生成的 SVG 作为 background-image。
   * @returns {Promise<{ok:boolean, cached:boolean, ms:number, bytes:number, error?:string}>}
   */
  async function apply(target, applyOptions = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el || !el.style) return { ok: false, cached: false, ms: 0, bytes: 0, error: 'target missing' };

    const hit = !!(cache && cache.key === cacheKey());
    try {
      const entry = await texture();
      const o = { ...opts, ...applyOptions };

      if (o.fadeIn && !prefersReducedMotion()) {
        el.style.transition = `background-image ${o.fadeInMs}ms ease`;
      } else {
        el.style.transition = '';
      }
      el.style.backgroundImage = entry.css;
      el.style.backgroundSize = o.backgroundSize;
      el.style.backgroundPosition = o.backgroundPosition;
      el.style.backgroundRepeat = o.backgroundRepeat;
      el.setAttribute('data-isopleth-seed', String(opts.seed));
      el.removeAttribute('data-isopleth-error');
      return { ok: true, cached: hit, ms: Math.round(entry.ms), bytes: entry.bytes, generations };
    } catch (error) {
      el.setAttribute('data-isopleth-error', String((error && error.message) || error));
      return { ok: false, cached: hit, ms: 0, bytes: 0, error: String((error && error.message) || error) };
    }
  }

  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    options: opts,
    texture,
    apply,
    /** 清缓存（换 seed / 换主题时调用）；下次 apply 会重新生成一次 */
    invalidate() { cache = null; },
    get stats() {
      return { generations, cachedBytes: cache ? cache.bytes : 0, cacheKey: cache ? cache.key : null };
    },
  };
}

/**
 * 给页面里所有 [data-isopleth] 元素套上底纹。
 *   <div data-isopleth data-seed="ridge-07" data-width="1440" data-height="1000"></div>
 */
export async function autoMount(root = document) {
  const nodes = Array.from(root.querySelectorAll('[data-isopleth]'));
  const results = [];
  for (const el of nodes) {
    const plugin = createIsoplethPlugin({
      seed: el.getAttribute('data-seed') || PLUGIN_DEFAULTS.seed,
      width: Number(el.getAttribute('data-width')) || PLUGIN_DEFAULTS.width,
      height: Number(el.getAttribute('data-height')) || PLUGIN_DEFAULTS.height,
    });
    results.push(await plugin.apply(el));
  }
  return results;
}
