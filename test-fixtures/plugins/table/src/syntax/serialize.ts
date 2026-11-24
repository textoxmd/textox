import type { Node as PMNode } from "prosemirror-model";

// Pure serialization helpers for GFM tables, shared by the feature's parser
// token handlers / block handler and (from a later task) the source-preserve
// reconciler. Kept free of editor/React imports so they are trivially testable.

export function parseAlignFromStyle(style: string | null): string | null {
  if (!style) return null;
  // Browsers / happy-dom may canonicalize with a space after `:` and a
  // trailing semicolon — match either form.
  const m = /text-align:\s*(left|center|right)/.exec(style);
  return m ? m[1]! : null;
}

export function alignDelim(align: string | null, width: number): string {
  // Min divider width is 3 (per GFM); we expand to match content width
  // so the source is human-readable on save.
  const w = Math.max(3, width);
  if (align === "left") return ":" + "-".repeat(w - 1);
  if (align === "right") return "-".repeat(w - 1) + ":";
  if (align === "center") return ":" + "-".repeat(w - 2) + ":";
  return "-".repeat(w);
}

export function renderCellInline(cell: PMNode): string {
  // Minimal cell-content serializer — covers method-B marks (delim chars
  // already live in textContent) and avoids depending on the editor's full
  // serializer. Inline atom nodes inside cells (image, etc.) are skipped
  // for the pilot; phase 2 can route them through the full serializer
  // if/when atoms in tables become a real use case.
  let out = "";
  cell.content.forEach((child) => {
    if (child.isText) out += child.text ?? "";
  });
  // Pipes inside cells are GFM-escaped as `\|`.
  return out.replace(/\|/g, "\\|");
}

/** 表格 canonical 行（header + body，不含分隔行），行序与 PM table_row 对应。 */
export function tableCanonicalRows(
  renderBlockCanon: (node: PMNode) => string,
  table: PMNode,
): string[] {
  const full = renderBlockCanon(table);
  const lines = full.replace(/\n$/, "").split("\n");
  const rows: string[] = [];
  if (lines.length > 0) rows.push(lines[0]!);
  for (let i = 2; i < lines.length; i++) rows.push(lines[i]!);
  return rows;
}
