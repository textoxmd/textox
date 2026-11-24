// 源码编辑器（CodeMirror）是 lazy 加载的。这里集中持有懒加载 thunk 与"是否已就绪"
// 标记：TextoEditor 用它做空闲预热，并在切换模式前判断能否播转场动画
// （未就绪时直接切，避免"空页面滑入"）。thunk 与 `lazy()` 共用，只有一次 import。

type SourceCodeEditorModule = typeof import('./index');

let ready = false;
let promise: Promise<SourceCodeEditorModule> | null = null;

/** 懒加载 thunk。 */
export function loadSourceCodeEditor(): Promise<SourceCodeEditorModule> {
  promise ??= import('./index').then((mod) => {
    ready = true;
    return mod;
  });
  return promise;
}

/** 同步判断源码编辑器是否已加载完成（供 canAnimate 使用）。 */
export function isSourceCodeEditorReady(): boolean {
  return ready;
}

/** 空闲时段预热一次；失败静默（下次切换会再试）。 */
export function preloadSourceCodeEditor(): void {
  void loadSourceCodeEditor().catch(() => {});
}
