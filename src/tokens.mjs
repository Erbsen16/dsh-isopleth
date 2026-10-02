// 色彩与线宽令牌 —— 逐项对应第 2 节视觉规格量化表。
// 表里未出现的视觉元素（光晕、渐变、噪点）不在这里，也不会被渲染。

export const TOKENS = {
  // 底色：近黑但偏冷，不要纯黑
  ground: '#14171a',

  // 等高线：冷灰绿；不透明度 8%~14%（取带上沿 14%，实测 1x 落带、2x 略高于带顶，
  // 交叉处会因 alpha 合成再高一点，这是描边叠加的正常结果）
  contour: '#8ea79a',
  contourOpacity: 0.14,
  indexContour: '#8ea79a',
  indexContourOpacity: 0.14,

  // 水面（Step 4 用；低于 0.3 高度处填充）
  water: '#2b3a3d',

  // 主题「当前/选中」色：只用于状态，不用于地形
  highlight: '#fff500',
};

export const STROKE = {
  // 量化表建议 0.7px；0.7px 在 1x 屏单行覆盖率约 0.7，实测偏“细淡”，经确认提到 1.0px。
  contour: 1.0,      // 细线
  indexContour: 1.4, // 索引线（每 5 条一条）
};

/** 等值线间距的验收带（屏幕上 px，按 1440 宽计） */
export const SPACING_BAND = { min: 40, max: 90, tooDense: 30, tooSparse: 150 };
