import { TextSelection } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";

// 工具栏"链接"按钮的核心逻辑：把选区文本包装成 `[text](url)` 源文本，
// 交给 normalize 插件落 mark。独立成纯函数以便直接测试。
// 回归：旧实现用 window.prompt（Tauri WebView 中不可用）且直接 addMark
// 不写源文本，会被 normalize 清掉，链接无法持久化。

export function insertLinkTransaction(state: EditorState): Transaction | null {
  const { from, to } = state.selection;
  // 链接是行内 mark，跨块选区无法生成合法链接：直接放弃，
  // 避免把多个段落的内容合并成一个链接文本。
  if (to > from && !state.doc.resolve(from).sameParent(state.doc.resolve(to))) {
    return null;
  }
  const selectedText = state.doc.textBetween(from, to);
  const hasSelection = from !== to;
  const text = selectedText || "link text";
  const source = `[${text}](url)`;
  // inheritMarks=false：模板不应继承光标处的行内 mark（如 code/em），
  // 否则会被吞进 code 里，normalize 不会把链接物化。
  const tr = state.tr.replaceSelectionWith(state.schema.text(source), false);
  if (hasSelection) {
    // 有选区：URL 占位符被选中，直接输入网址
    const urlFrom = from + text.length + 3; // `[text](` 之后
    tr.setSelection(TextSelection.create(tr.doc, urlFrom, urlFrom + 3));
  } else {
    // 无选区：链接文字占位符被选中，先输入文字
    tr.setSelection(TextSelection.create(tr.doc, from + 1, from + 1 + text.length));
  }
  return tr;
}
