/**
 * 生产构建下屏蔽 WebView 原生右键菜单（macOS WKWebView / Windows WebView2 自带的
 * Reload / Inspect Element 等系统项）。React 自研右键菜单自行 preventDefault 并弹出
 * 自己的菜单；此监听只作兜底，阻止未被自定义菜单处理过的右键触发系统默认菜单。
 * 开发期（PROD=false）不挂载，保留原生 Inspect 便于调试。
 */
export function initNativeContextMenuGuard(): void {
  if (!import.meta.env.PROD) return;
  window.addEventListener('contextmenu', (e) => e.preventDefault());
}

