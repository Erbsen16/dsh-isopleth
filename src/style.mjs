// 风格层（第二段）。
//
// 分工：
//   第一段 buildTerrain()  出「结构」——高度场、几级色带、几条等高线、归一化明暗位图
//   第二段 styleTerrain()  出「皮肤」——底色/线色/线对比/明暗强度/水面色
//
// 这样量化表管结构与密度，风格预设管观感，两者可以独立替换。
//
// 预设 `spec`     = 严格按需求第 2 节量化表
// 预设 `survey`   = 按参考图实测值反推（底色中性、线近乎不透明、明暗幅度大、色带压到近乎无）

export const STYLE_PRESETS = {
  /** 需求第 2 节量化表：冷灰绿 8~14% 线、5 级色带、只压暗 */
  spec: {
    label: '量化表（现状）',
    ground: '#14171a',
    contour: { color: '#8ea79a', opacity: 0.14, width: 1.0 },
    indexContour: { color: '#8ea79a', opacity: 0.14, width: 1.4 },
    band: { color: '#ffffff', opacityScale: 1 },
    water: '#2b3a3d',
    shading: { shadowAlpha: 0.28, lightAlpha: 0 },
  },

  /**
   * 参考图实测反推，但**只取地纹语言**：
   *   底色中性（B−R=0）、线 #5e5f5f 近乎不透明、线比底亮 +46、明暗幅度大。
   * 参考图里的白色地图块（建筑）、青蓝水系线、黄色状态高亮都是**游戏内容**，不是地纹语言，
   * 这里一律不抄 —— 所以 water / waterLine 都是 null。
   */
  survey: {
    label: '测绘风 · 纯等高线',
    ground: '#2b2b2b',
    contour: { color: '#6a6a6a', opacity: 0.95, width: 1.1 },
    indexContour: { color: '#909090', opacity: 1.0, width: 1.6 },
    band: { color: '#ffffff', opacityScale: 0.3 },
    water: null,      // 水面填色：非必要
    waterLine: null,  // 水系线：非必要
    shading: { shadowAlpha: 0.5, lightAlpha: 0.16 },
  },

  /** 对照用：保留水系的版本（量化表里的「可选水面」） */
  'survey-water': {
    label: '测绘风 · 带水系（对照）',
    ground: '#2b2b2b',
    contour: { color: '#6a6a6a', opacity: 0.95, width: 1.1 },
    indexContour: { color: '#909090', opacity: 1.0, width: 1.6 },
    waterLine: { color: '#4a9ea1', opacity: 1.0, width: 1.0 },
    band: { color: '#ffffff', opacityScale: 0.3 },
    water: '#2f3c44',
    shading: { shadowAlpha: 0.5, lightAlpha: 0.16 },
  },
};

/**
 * 对已建好的地形结构套用风格预设。
 *
 * 明暗位图必须是归一化的（buildTerrain 时传 lighting:{normalize:true}），
 * 这里按预设强度重算 alpha 通道 —— 所以第二段能独立决定明暗，不用回头改第一段。
 *
 * @returns 新的 terrain 对象（可直接交给 renderSvg）
 */
export function styleTerrain(terrain, style = 'survey') {
  const preset = typeof style === 'string' ? STYLE_PRESETS[style] : style;
  if (!preset) throw new Error(`未知风格预设：${style}（可选：${Object.keys(STYLE_PRESETS).join(', ')}）`);

  const layers = [];

  for (const l of terrain.layers) {
    if (l.kind === 'shade') {
      // buildTerrain 把 stats 摊平进 terrain.shade，所以 normalized 是顶层字段（不是 .stats.normalized）
      if (!terrain.shade || terrain.shade.normalized !== true) {
        throw new Error('styleTerrain 需要归一化明暗：buildTerrain 时传 lighting:{ normalize: true }');
      }
      layers.push({ ...l, rgba: remapShadeAlpha(l.rgba, preset.shading) });
      continue;
    }
    if (l.kind === 'band') {
      const alpha = l.alpha * (preset.band.opacityScale ?? 1);
      if (alpha <= 0) continue; // 压到 0 就不出这一层
      layers.push({ ...l, fill: preset.band.color, fillOpacity: alpha, alpha });
      continue;
    }
    if (l.kind === 'water') {
      if (!preset.water) continue; // 预设关掉水面就整层丢弃（地纹语言里非必要）
      layers.push({ ...l, fill: preset.water });
      continue;
    }
    if (l.kind === 'contour') {
      // 水系线上色的前提是这一版确实有水面；纯等高线版一律走地形线色
      const waterLevel = terrain.water ? terrain.water.level : -Infinity;
      const isWaterLine =
        !!preset.water && !!preset.waterLine && typeof l.level === 'number' && l.level <= waterLevel + 1e-9;
      const t = isWaterLine ? preset.waterLine : l.index ? preset.indexContour : preset.contour;
      layers.push({ ...l, stroke: t.color, strokeWidth: t.width, strokeOpacity: t.opacity, waterLine: !!isWaterLine });
      continue;
    }
    layers.push(l);
  }

  return {
    ...terrain,
    background: preset.ground,
    layers,
    style: preset,
    meta: { ...terrain.meta, style: preset.label },
  };
}

/** 黑/白两侧各自按预设强度缩放 alpha（0 = 去掉该侧）。 */
function remapShadeAlpha(rgba, { shadowAlpha = 0, lightAlpha = 0 }) {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const isLight = rgba[i] > 127;
    const strength = isLight ? lightAlpha : shadowAlpha;
    if (strength <= 0) continue; // alpha 保持 0 = 丢弃
    out[i] = rgba[i];
    out[i + 1] = rgba[i + 1];
    out[i + 2] = rgba[i + 2];
    out[i + 3] = Math.max(0, Math.min(255, Math.round(rgba[i + 3] * strength)));
  }
  return out;
}
