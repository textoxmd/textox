/**
 * 平台检测与移动端适配辅助函数。
 *
 * iPadOS 上的 Tauri 运行在 WKWebView 中，桌面专属 API（窗口、菜单、
 * 多窗口创建等）不可用或行为不同，前端需要据此走替代路径。
 */

/** 是否运行在移动平台（iOS/iPadOS）。 */
export function isMobilePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ 桌面版 Safari UA 伪装成 Mac，但触摸事件可用
  if (/Macintosh|Mac OS X/.test(ua) && "ontouchend" in document) return true;
  return false;
}

/** 是否运行在 Tauri 容器中（而非纯浏览器）。 */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 移动端是否应该跳过某类桌面专属操作（创建独立窗口等）。 */
export function isDesktopOnlyFeature(): boolean {
  return !isMobilePlatform();
}

/**
 * 在 html 根节点标记触屏设备，供 CSS 常驻显示触屏必需控件
 * （桌面端依赖 hover 显示的按钮在 iPad 上无法悬停）。
 */
export function initTouchDeviceClass(): void {
  if (typeof document !== "undefined" && isMobilePlatform()) {
    document.documentElement.classList.add("touch-device");
  }
}
