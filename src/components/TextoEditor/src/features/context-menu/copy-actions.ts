import type { EditorView } from 'prosemirror-view';

import { serialize } from '../../serializer.ts';
import { copyAsHtml, markdownToHtml } from './copy-utils.ts';

/** 选区序列化为 Markdown；空选区返回 null。 */
function selectionMarkdown(view: EditorView): string | null {
  const { from, to } = view.state.selection;
  if (from === to) return null;
  return serialize(view.state.doc.cut(from, to));
}

/** 复制选区为 Markdown（原 TextoEditor 的 handleCopyMarkdown）。 */
export function copySelectionAsMarkdown(view: EditorView): void {
  const md = selectionMarkdown(view);
  if (md === null) return;
  navigator.clipboard.writeText(md).catch(console.error);
}

/** 复制选区为 HTML（原 TextoEditor 的 handleCopyHtml）。 */
export function copySelectionAsHtml(view: EditorView): void {
  const md = selectionMarkdown(view);
  if (md === null) return;
  copyAsHtml(markdownToHtml(md)).catch(console.error);
}
