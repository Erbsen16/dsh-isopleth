# 舆图 · dsh-isopleth

程序化**地形底纹生成器**：深色地面 + 分级色带（等高面）+ 等高线 + 单向光照 + 水面。
风格取向是工业/科幻测绘界面——疏朗、克制、无装饰性光晕。

零第三方依赖：噪声、marching squares、曲线平滑、山体阴影、PNG 编解码全部自写（仅用 Node 标准库）。

![1440×1000](preview/terrain-1440x1000.png)

<sub>1440×1000 · 5 级色带 + 单向光照 + 水面 + 9 条等高线 · 全部由 `seed` 决定</sub>

| 2560×1440 | 390×844 | 换 seed（`ridge-07`） |
|---|---|---|
| ![2560×1440](preview/terrain-2560x1440.png) | ![390×844](preview/terrain-390x844.png) | ![ridge-07](preview/terrain-1440x1000-seed-ridge-07.png) |

> 命名说明：`dsh-isopleth` 取自制图学术语 *isopleth*（等值线）。本项目**不含任何游戏商标**，
> 模块名、类名、包名、SVG 属性里都不会出现「终末地 / Endfield / 明日方舟」。
> 灵感来自工业风测绘界面与分层设色地形图的通用做法，未使用任何游戏素材。

## 快速开始

```bash
node steps/step1.mjs      # Step 1：高度场 + 单层等值线
node steps/step2.mjs      # Step 2：+ 分级色带
node steps/step3.mjs      # Step 3：+ 单向光照
node steps/step4.mjs      # Step 4：+ 水面（完整产物）

node steps/step4.mjs --seed ridge-07 --sizes 1440x1000,2560x1440,390x844
node steps/step4.mjs --variants 1        # 额外输出各档参数对比裁切
node tools/bench.mjs 1600 1000 9 7 5 1   # 性能基准
node tools/verify-lines.mjs              # 线条不透明度像素级验收
```

产物在 `out/step4-<seed>/`：`terrain-<WxH>.svg`（交付物）、`.png` / `@2x.png`（预览）、
`crop1to1-<WxH>.png`（1:1 原生像素裁切），以及 `out/step4-report-<seed>.json`（全部实测值）。

## 输入参数（都有默认值）

| 参数 | 默认 | 说明 |
|---|---|---|
| `seed` | `isopleth-01` | 任意字符串；换成 `ridge-07` 地形完全不同 |
| `width` / `height` | 1440 / 1000 | 任意宽高比 |
| `levels` | 9 条（0.1…0.9） | 等高线条数 |
| `bands.bandCount` | 5 | 色带级数（5~7），边界自动吸附到等高线层级 |
| `bands.lightenStep` | 0.05 | 每级白叠加 3%~5% |
| `lighting` | 开 | `{ azimuthDeg: 315, altitudeDeg: 45, gradientRadiusPx: 60, relief: 260, shadowAlpha: 0.28, lightAlpha: 0 }` |
| `water` | 开 | `{ level: 0.3 }`，颜色 `#2b3a3d` |
| `field` | — | fBm 参数：`octaves 6 / gain 0.42 / baseWavelength 560 / contrast 1.5 / step 3 / pad 64` |

## 产物规模与性能（实测）

| 尺寸 | SVG | 生成耗时（全套） |
|---|---|---|
| 1440×1000 | 149 KB | 282 ms |
| 2560×1440 | 349 KB | 345 ms |
| 390×844 | 39 KB | 62 ms |
| **1600×1000（规格目标）** | **154 KB** | **139 ms**（7 次中位，预热后，最慢 187 ms） |

预算 300ms，余量约 2.2×。生成是**纯函数**：同参数必得同一 SVG，常驻插件只需初始化算一次并缓存，不含每帧逻辑。
无任何动画，`prefers-reduced-motion` 天然满足。

## 规格自查（禁止项）

| 禁止项 | 状态 |
|---|---|
| 平铺 / 重复贴图 / 可见接缝 | 世界坐标连续采样，无取模、无重复；相邻色带共用同一条曲线，接缝被等高线压住 |
| 同一几何缩放叠加（摩尔纹） | 不存在任何缩放叠加图层 |
| 未覆盖区域 | `ground` 矩形覆盖整个 viewBox，三尺寸实测覆盖 == 视口 |
| 游戏商标 | 模块名 / 类名 / 包名 / SVG 属性中均无 |
| 规格外视觉元素 | 无光晕、无噪点、无外发光、无渐变按钮；明暗只有一束平行光，无光斑（迎光提亮默认关闭） |

## 目录

```
src/noise.mjs      自写 2D 值噪声 + fBm
src/field.mjs      世界坐标采样格 + 确定性取景
src/marching.mjs   marching squares：等值线 + 区域掩膜多边形
src/simplify.mjs   Douglas-Peucker
src/smooth.mjs     Catmull-Rom → 三次贝塞尔
src/bands.mjs      分级色带
src/hillshade.mjs  单向光照
src/water.mjs      水面
src/svg.mjs        SVG 组装
src/generate.mjs   生成核心
steps/             各步骤 CLI
tools/             自写 PNG 编解码、光栅化、基准与各类验收探针
```
