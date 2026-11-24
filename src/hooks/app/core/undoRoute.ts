/** 撤销/重做的落点：文档编辑器（统一历史）或浏览器原生（输入框等）。 */
export type UndoRoute = 'editor' | 'native';

function isEditableTarget(target: Element | null): boolean {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // contenteditable 的空串/plaintext-only 也算可编辑；isContentEditable 在
  // 部分 DOM 实现（happy-dom）上不可靠，属性判断作为兜底。
  const attr = target.getAttribute('contenteditable');
  return (target as HTMLElement).isContentEditable === true || (attr !== null && attr !== 'false');
}

/**
 * 按焦点上下文决定撤销/重做落点。
 *
 * - 焦点在文档编辑器（IR/SV）内 → editor
 * - 焦点在普通输入框、或对话框里的可编辑区 → native
 * - 焦点不在编辑器（侧边栏/工具栏等）→ editor：菜单撤销仍作用于文档
 *
 * 文档编辑器未挂载时（插件文件编辑器等）由调用方回退到原生命令。
 */
export function resolveUndoRoute(active: Element | null, editorFocused: boolean): UndoRoute {
  if (editorFocused) return 'editor';
  // CodeMirror 内容区即使没被 isFocused() 判到，也应交给编辑器历史
  if (active?.closest('.cm-editor')) return 'editor';
  return isEditableTarget(active) ? 'native' : 'editor';
}
