import type { Node as PMNode } from "prosemirror-model";
import type { IconDef, InsertCommandMeta } from "@texto/markdown-editor-api";

const footnoteIcon: IconDef = [
  ["path", "M7 4h4l3 8 3-8h4"],
  ["line", 4, 16, 10, 16],
  ["circle", 18, 6, 2],
];

const FN_RE = /\[\^(\d+)\]/g;

/** 现有脚注编号最大值 + 1。 */
function nextLabel(doc: PMNode): number {
  let max = 0;
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    const text = node.textContent;
    FN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FN_RE.exec(text))) max = Math.max(max, parseInt(m[1]!, 10));
    return true;
  });
  return max + 1;
}

export const footnoteInsert: InsertCommandMeta = {
  id: "footnote",
  keyword: "footnote",
  labelKey: "footnote.pluginName",
  descriptionKey: "footnote.footnoteDesc",
  icon: footnoteIcon,
  defaultShortcut: "Cmd+Opt+F",
  category: "paragraph",
  order: 2,
  insert(view) {
    const schema = view.state.schema;
    const markType = schema.marks.footnote_ref;
    if (!markType || !schema.nodes.paragraph) return;
    const label = String(nextLabel(view.state.doc));
    const ref = `[^${label}]`;
    const { from, to } = view.state.selection;
    const tr = view.state.tr.insertText(ref, from, to);
    tr.addMark(from, from + ref.length, markType.create({ id: label }));
    const def = schema.nodes.paragraph.create(null, schema.text(`[^${label}]: `));
    tr.insert(tr.doc.content.size, def);
    view.dispatch(tr);
    view.focus();
  },
};
