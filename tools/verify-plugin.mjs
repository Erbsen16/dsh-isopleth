// 插件验收：在真实浏览器里跑 examples/plugin-demo.html，断言
//   1) 单文件插件能加载、能生成（浏览器路径 = CompressionStream，无 Node API）
//   2) 第二次 apply 命中缓存，生成次数仍为 1（规格：只生成一次、不得每帧重算）
//   3) 底纹确实挂到了元素的 background-image 上
// 同时出一张截图供肉眼确认。
//
//   node tools/verify-plugin.mjs
//
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'examples/plugin-demo.html');
const OUT = join(ROOT, 'out/plugin-verify');
mkdirSync(OUT, { recursive: true });

const CANDIDATES = [
  process.env.DSH_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const browser = CANDIDATES.find((c) => existsSync(c));
if (!browser) {
  console.error('找不到浏览器；设置 DSH_BROWSER 指向 chrome/msedge');
  process.exit(1);
}

const scratch = join(tmpdir(), 'dsh-isopleth-browser');
mkdirSync(scratch, { recursive: true });
const url = pathToFileURL(PAGE).href;
const common = [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + scratch,
  '--window-size=1440,1000',
];

// ---- 1) dump-dom 断言 ----
const dom = spawnSync(browser, [...common, '--virtual-time-budget=20000', '--dump-dom', url], {
  encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024,
});
if (dom.error) throw dom.error;
const html = dom.stdout || '';
const attr = (name) => {
  const m = html.match(new RegExp(`data-${name}="([^"]*)"`));
  return m ? m[1] : null;
};

const report = {
  browser: browser.split('\\').pop(),
  domBytes: html.length,
  ready: attr('ready'),
  error: attr('error'),
  pluginVersion: attr('plugin-version'),
  generateMs: attr('ms'),
  svgBytes: attr('bytes'),
  generations: attr('generations'),
  applyOk: attr('apply-ok'),
  applyError: attr('apply-error'),
  secondApplyCached: attr('second-cached'),
  backgroundSet: attr('background-set'),
  virtualTimeBudgetMs: 20000,
};
report.pass =
  report.ready === '1' &&
  report.error === null &&
  report.backgroundSet === '1' &&
  report.generations === '1' &&
  report.secondApplyCached === 'true';

// ---- 2) 截图 ----
const png = join(OUT, 'plugin-demo.png');
spawnSync(browser, [...common, '--virtual-time-budget=20000', `--screenshot=${png}`, url], {
  encoding: 'utf8', timeout: 120000,
});
report.screenshot = existsSync(png) ? png : null;

writeFileSync(join(OUT, 'verify-plugin.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
