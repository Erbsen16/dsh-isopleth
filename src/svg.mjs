// SVG assembly.
//
// 只输出交给它的图层，不额外发明元素。
// 图层顺序即绘制顺序：调用方先给色带（低层级在下），再给等高线（画在填充之上）。
//
// 支持三类图层：
//   {kind:'path'}   结构化路径（fill / stroke）
//   {kind:'image'}  内嵌位图（光照层）
//   {raw:'<g>…</g>'}任意标记（分层方案的叠加层、标注点、蒙版引用等）
// 另可传 defs（渐变 / 图案 / 滤镜 / 蒙版定义）。

import { TOKENS, STROKE } from './tokens.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * @param {{width:number,height:number,background?:string,defs?:string,
 *          layers:Array<object>, meta?:object}} spec
 */
export function buildSvg(spec) {
  const { width, height, layers } = spec;
  const background = spec.background ?? TOKENS.ground;
  const meta = spec.meta ?? {};
  const metaAttrs = Object.entries(meta)
    .map(([k, v]) => ` data-${esc(k)}="${esc(v)}"`)
    .join('');

  const body = layers
    .filter((l) => l && (l.d || l.href || l.raw !== undefined))
    .map((l) => {
      if (l.raw !== undefined) return `    ${l.raw}`;
      if (l.kind === 'image') {
        return `    <image x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height}" preserveAspectRatio="none" href="${l.href}"/>`;
      }
      const attrs = [];
      if (l.fill) {
        attrs.push(`fill="${l.fill}"`, `fill-opacity="${l.fillOpacity}"`, `fill-rule="${l.fillRule ?? 'evenodd'}"`, 'stroke="none"');
      }
      if (l.stroke) {
        attrs.push(`stroke="${l.stroke}"`, `stroke-width="${l.strokeWidth}"`, `stroke-opacity="${l.strokeOpacity}"`);
      }
      if (l.mask) attrs.push(`mask="url(#${l.mask})"`);
      if (l.style) attrs.push(`style="${l.style}"`);
      return `    <path d="${l.d}" ${attrs.join(' ')}/>`;
    })
    .join('\n');

  // defs 为空时不留多余空白，保证既有产物逐字节不变
  const extraDefs = spec.defs ? `\n${spec.defs}` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="geometricPrecision"${metaAttrs}>
  <defs>
    <clipPath id="viewport"><rect x="0" y="0" width="${width}" height="${height}"/></clipPath>${extraDefs}
  </defs>
  <rect id="ground" x="0" y="0" width="${width}" height="${height}" fill="${background}"/>
  <g clip-path="url(#viewport)" fill="none" stroke-linecap="round" stroke-linejoin="round">
${body}
  </g>
</svg>
`;
}

/** 一条等高线图层（细线或索引线）。 */
export function contourLayer(d, { index = false } = {}) {
  return {
    d,
    stroke: index ? TOKENS.indexContour : TOKENS.contour,
    strokeWidth: index ? STROKE.indexContour : STROKE.contour,
    strokeOpacity: index ? TOKENS.indexContourOpacity : TOKENS.contourOpacity,
  };
}

/** 一条色带图层：低透明度白叠加。 */
export function bandLayer(d, { alpha, fill = '#ffffff' }) {
  return { d, fill, fillOpacity: alpha, fillRule: 'evenodd' };
}
