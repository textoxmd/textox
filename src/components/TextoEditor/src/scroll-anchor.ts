/**
 * 模式切换（IR ⇄ SV）时光标行的视觉锚点：窗口高度比例。
 *
 * 0.5 是窗口几何正中。实际使用中按正中仍略偏低：人眼舒适的阅读线通常略高于
 * 几何中心，IR 顶部的格式操作栏还会把内容再压一点。因此取 0.47 —— 默认
 * 960×700 窗口下比正中高约 21px。
 *
 * 锚点用**窗口**高度而不是编辑器滚动容器高度：主窗口在 macOS 是
 * `TitleBarStyle::Overlay` + 32px 自绘标题栏（Windows 为 `decorations(false)`），
 * 容器中线比窗口视觉中线低半个标题栏高；用窗口坐标还能让 IR/SV 切换时行在
 * 窗口中的绝对高度一致（不上下跳）。
 *
 * 微调只改这一个常量：数值越小，光标行越靠上。
 */
export const MODE_SWITCH_ANCHOR_RATIO = 0.47;

/** 模式切换的对齐目标，单位与 `getBoundingClientRect().top` 一致（视口坐标）。 */
export function modeSwitchAnchorY(): number {
  return window.innerHeight * MODE_SWITCH_ANCHOR_RATIO;
}
