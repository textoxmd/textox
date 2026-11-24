import type { EditorState } from "prosemirror-state";

// 折叠光标位于文档顶层（depth === 1）空 paragraph 时才允许块级插入。
export function canInsertBlockAt(state: EditorState): boolean {
  if (!state.selection.empty) return false;
  const { $from } = state.selection;
  if ($from.depth !== 1) return false;
  if ($from.parent.type.name !== "paragraph") return false;
  if ($from.parent.childCount !== 0) return false;
  return true;
}
