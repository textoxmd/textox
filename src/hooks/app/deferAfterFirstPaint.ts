/**
 * 首屏之后执行：优先 `requestIdleCallback`（带超时兜底），
 * 不支持时退化到 `setTimeout`。返回取消函数。
 *
 * 注意：macOS 的 WKWebView 不提供 `requestIdleCallback`，桌面端实际走
 * fallback（默认 500ms）。`timeoutMs` 仅对 idle 分支生效。
 */
export function deferAfterFirstPaint(
  fn: () => void,
  timeoutMs = 3000,
  fallbackMs = 500,
): () => void {
  const idle = (globalThis as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
  }).requestIdleCallback;
  if (typeof idle === 'function') {
    const id = idle(fn, { timeout: timeoutMs });
    const cancel = (globalThis as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    return () => cancel?.(id);
  }
  const timer = setTimeout(fn, fallbackMs);
  return () => clearTimeout(timer);
}
