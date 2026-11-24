import type { Editor } from "../../editor-api";
import type { CursorRange, HistoryViewAdapter } from "../types";

function selectionOf(editor: Editor): CursorRange {
  const sel = editor.view.state.selection;
  return {
    anchor: editor.posToLineCol(sel.anchor),
    head: editor.posToLineCol(sel.head),
  };
}

/** 把渲染态（ProseMirror）编辑器接到统一历史会话上。 */
export function createIrAdapter(editor: Editor): HistoryViewAdapter {
  return {
    getMarkdown: () => editor.getMarkdown(),
    getSelection: () => selectionOf(editor),
    applyMarkdown: (md, selection, align) =>
      editor.applyMarkdownFromHistory(md, selection, align),
    focus: () => editor.focus(),
  };
}
