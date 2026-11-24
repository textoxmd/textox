import type { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { FormatToolbarItemMeta } from "@texto/markdown-editor-api";

import { TOOLBAR_ICONS } from "../../editorIcons.ts";
import { toggleInlineDelim } from "../inline-toggle.ts";

/** 编辑器内置的行内格式项（悬浮工具栏默认按钮）。 */
export const CORE_FORMAT_ITEMS: FormatToolbarItemMeta[] = [
  { id: "bold", markName: "strong", delim: "**", labelKey: "menu.bold", icon: TOOLBAR_ICONS.bold!, order: 0 },
  { id: "italic", markName: "em", delim: "*", labelKey: "menu.italic", icon: TOOLBAR_ICONS.italic!, order: 1 },
  { id: "strikethrough", markName: "strike", delim: "~~", labelKey: "menu.strikethrough", icon: TOOLBAR_ICONS.strikethrough!, order: 2 },
  { id: "inlineCode", markName: "code", delim: "`", labelKey: "menu.inline_code", icon: TOOLBAR_ICONS.code!, order: 5 },
];

/** 执行一个格式项：优先自定义 run，否则走共享 toggle。 */
export function runFormatToolbarItem(view: EditorView, meta: FormatToolbarItemMeta): void {
  if (meta.run) {
    meta.run(view);
    return;
  }
  toggleInlineDelim(view, meta.delim, meta.closeDelim, meta.markName);
}

/**
 * 选区文本是否带指定 mark（悬浮工具栏激活态，与顶部工具栏同源语义）。
 *
 * 采用「任一文本节点带该 mark」的并集语义：选区边界可能因隐藏分隔符
 * （`**`/`==` 等在主题里 font-size:0）而落到无 mark 的分隔符字符上，
 * 若要求「全部节点都带 mark」会误判为未激活。nodesBetween 遍历真实文本
 * 节点，嵌套（`**==x==**`）与重叠分隔符（`**TEXT**` 的单个 `*`）都不会误判。
 */
export function selectionHasMark(state: EditorState, markName: string): boolean {
  const markType = state.schema.marks[markName];
  if (!markType) return false;
  const { from, to } = state.selection;
  let found = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText && node.marks.some((m) => m.type === markType)) {
      found = true;
      return false;
    }
  });
  return found;
}

/**
 * 选区是否「完全」落在指定 mark 内（区间内每个文本节点都带该 mark）。
 * 用于悬浮工具栏抑制判定（与激活态的并集语义不同）：
 * 跨 mark 的部分选区不应被抑制。无文本节点时视为不在 mark 内。
 */
export function selectionFullyInMark(state: EditorState, markName: string): boolean {
  const markType = state.schema.marks[markName];
  if (!markType) return false;
  const { from, to } = state.selection;
  let hasText = false;
  let all = true;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText) {
      hasText = true;
      if (!node.marks.some((m) => m.type === markType)) all = false;
    }
  });
  return hasText && all;
}
