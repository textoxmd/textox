import type { Node as PMNode, Schema } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import type { SyntaxFeature } from "@texto/markdown-editor-runtime";

import { alignDelim, parseAlignFromStyle, renderCellInline } from "./serialize";
import { tableSourcePreserve } from "./source-preserve";

export { parseAlignFromStyle } from "./serialize";

// GFM table — parse / serialize / display plus in-cell interactions:
// Tab / Shift-Tab cell navigation, Mod-Enter inserts a row,
// Mod-Shift-Backspace deletes a row, and Enter exits the table (or
// commits a `| ... |` paragraph into one). The floating resize / align
// toolbar is owned by a later task.
//
// Schema:
//   table → table_row+ → table_cell+
//   table_cell carries `{header: boolean, align: "left"|"center"|"right"|null}`
//   (alignment from the GFM `:---:` divider; header inferred from
//   md-it's th_open vs td_open tokens — first row's cells carry it).
//
// Round-trip: doc-level only. md-it produces resolved tokens; we emit
// canonical `| col1 | col2 |\n| --- | --- |\n| ... |` shape on save.
// Bare-pipe and column-width-padded variants are accepted on input;
// output is normalized.

function tabCellNav(dir: 1 | -1) {
  return (state: import("prosemirror-state").EditorState,
    dispatch?: (tr: import("prosemirror-state").Transaction) => void): boolean => {
    const $from = state.selection.$from;
    let cellDepth = -1;
    for (let d = $from.depth; d >= 0; d--) {
      if ($from.node(d).type.name === "table_cell") {
        cellDepth = d;
        break;
      }
    }
    if (cellDepth === -1) return false;
    const rowDepth = cellDepth - 1;
    const tableDepth = cellDepth - 2;
    const cellIdx = $from.index(rowDepth);
    const rowIdx = $from.index(tableDepth);
    const tableNode = $from.node(tableDepth);
    const row = $from.node(rowDepth);

    let nextRow = rowIdx;
    let nextCell = cellIdx + dir;
    if (nextCell < 0) {
      nextRow = rowIdx - 1;
      if (nextRow < 0) return true; // first cell — consume, no-op
      nextCell = tableNode.child(nextRow).childCount - 1;
    } else if (nextCell >= row.childCount) {
      nextRow = rowIdx + 1;
      if (nextRow >= tableNode.childCount) return true; // last cell — consume, no-op
      nextCell = 0;
    }
    if (dispatch) {
      const tableStart = $from.before(tableDepth);
      let pos = tableStart + 1; // inside table
      for (let r = 0; r < nextRow; r++) pos += tableNode.child(r).nodeSize;
      pos += 1; // inside row
      const targetRow = tableNode.child(nextRow);
      for (let c = 0; c < nextCell; c++) pos += targetRow.child(c).nodeSize;
      pos += 1; // inside cell
      dispatch(
        state.tr.setSelection(TextSelection.create(state.doc, pos)),
      );
    }
    return true;
  };
}

export const tableFeature: SyntaxFeature = {
  name: "table",

  nodes: {
    table: {
      group: "block",
      content: "table_row+",
      defining: true,
      isolating: true,
      parseDOM: [{ tag: "table" }],
      toDOM: () => ["table", ["tbody", 0]],
    },
    table_row: {
      content: "table_cell+",
      parseDOM: [{ tag: "tr" }],
      toDOM: () => ["tr", 0],
    },
    table_cell: {
      content: "inline*",
      attrs: {
        header: { default: false },
        align: { default: null },
      },
      isolating: true,
      parseDOM: [
        {
          tag: "th",
          getAttrs: (el) => ({
            header: true,
            align: parseAlignFromStyle((el as HTMLElement).getAttribute("style")),
          }),
        },
        {
          tag: "td",
          getAttrs: (el) => ({
            header: false,
            align: parseAlignFromStyle((el as HTMLElement).getAttribute("style")),
          }),
        },
      ],
      toDOM: (node) => {
        const tag = node.attrs.header ? "th" : "td";
        const align = node.attrs.align as string | null;
        // 只有显式对齐才落内联 style；无对齐表头的左对齐交给 CSS 规则，
        // 避免把隐式左对齐误当成 `:---` 显式对齐（round-trip / spec 依赖此区分）。
        const attrs = align ? { style: `text-align:${align}` } : {};
        return [tag, attrs, 0];
      },
    },
  },

  mdItPlugins: [(md) => md.enable("table")],

  keymap: (schema: Schema) => ({
    // Cell navigation. Tab / Shift-Tab move the cursor row-major; at the
    // boundary (last/first cell) the keystroke is consumed but the
    // selection is unchanged — that matches Typora and avoids letting
    // browser focus escape the table.
    Tab: tabCellNav(1),
    "Shift-Tab": tabCellNav(-1),

    // Cmd/Ctrl-Enter inside a cell: insert an empty row below the
    // current one. New cells inherit the column's `align` from the
    // header row.
    "Mod-Enter": (state, dispatch) => {
      const $from = state.selection.$from;
      let cellDepth = -1;
      for (let d = $from.depth; d >= 0; d--) {
        if ($from.node(d).type.name === "table_cell") {
          cellDepth = d;
          break;
        }
      }
      if (cellDepth === -1) return false;
      const tableDepth = cellDepth - 2;
      const tableNode = $from.node(tableDepth);
      const rowIdx = $from.index(tableDepth);
      const cellIdx = $from.index(cellDepth - 1);
      const colCount = tableNode.child(rowIdx).childCount;
      if (dispatch) {
        const headerRow = tableNode.child(0);
        const newCells: PMNode[] = [];
        for (let c = 0; c < colCount; c++) {
          const align = (headerRow.child(c)?.attrs.align as string | null) ?? null;
          newCells.push(
            schema.nodes.table_cell.create({ header: false, align }, []),
          );
        }
        const newRow = schema.nodes.table_row.create(null, newCells);
        const tableStart = $from.before(tableDepth);
        let insertAt = tableStart + 1;
        for (let r = 0; r <= rowIdx; r++) insertAt += tableNode.child(r).nodeSize;
        const tr = state.tr.insert(insertAt, newRow);
        // Cursor inside the new row at the same column index.
        let cursorPos = insertAt + 1; // inside row
        for (let c = 0; c < cellIdx; c++) cursorPos += newRow.child(c).nodeSize;
        cursorPos += 1; // inside cell
        tr.setSelection(TextSelection.create(tr.doc, cursorPos));
        dispatch(tr);
      }
      return true;
    },

    // Cmd/Ctrl-Shift-Backspace inside a cell: delete the current row.
    // No-op (but consumed) when the table has a single row left.
    "Mod-Shift-Backspace": (state, dispatch) => {
      const $from = state.selection.$from;
      let cellDepth = -1;
      for (let d = $from.depth; d >= 0; d--) {
        if ($from.node(d).type.name === "table_cell") {
          cellDepth = d;
          break;
        }
      }
      if (cellDepth === -1) return false;
      const tableDepth = cellDepth - 2;
      const tableNode = $from.node(tableDepth);
      const rowIdx = $from.index(tableDepth);
      const cellIdx = $from.index(cellDepth - 1);
      if (tableNode.childCount <= 1) return true; // consume, no-op
      if (dispatch) {
        const tableStart = $from.before(tableDepth);
        let rowStart = tableStart + 1;
        for (let r = 0; r < rowIdx; r++) rowStart += tableNode.child(r).nodeSize;
        const row = tableNode.child(rowIdx);
        const tr = state.tr.delete(rowStart, rowStart + row.nodeSize);
        // Cursor → adjacent row, same column. Prefer next row (same
        // index in the post-delete table); fall back to previous when
        // we deleted the last row.
        const newTable = tr.doc.nodeAt(tableStart)!;
        const targetRowIdx = Math.min(rowIdx, newTable.childCount - 1);
        let cursorPos = tableStart + 1;
        for (let r = 0; r < targetRowIdx; r++)
          cursorPos += newTable.child(r).nodeSize;
        cursorPos += 1; // inside row
        const targetRow = newTable.child(targetRowIdx);
        const targetCol = Math.min(cellIdx, targetRow.childCount - 1);
        for (let c = 0; c < targetCol; c++) cursorPos += targetRow.child(c).nodeSize;
        cursorPos += 1; // inside cell
        tr.setSelection(TextSelection.create(tr.doc, cursorPos));
        dispatch(tr);
      }
      return true;
    },

    // When inside a table_cell at the end of the last row and the table
    // itself is the last block in the document, insert a blank paragraph
    // after the table so the user can continue typing outside it.
    // Falls through to the pipe-table trigger when not inside a cell.
    Enter: (state, dispatch) => {
      const $from = state.selection.$from;

      // Check if we're inside a table cell.
      let cellDepth = -1;
      for (let d = $from.depth; d >= 0; d--) {
        if ($from.node(d).type.name === "table_cell") {
          cellDepth = d;
          break;
        }
      }
      if (cellDepth !== -1) {
        const tableDepth = cellDepth - 2;
        const tableNode = $from.node(tableDepth);
        const rowIdx = $from.index(tableDepth);
        const cellIdx = $from.index(cellDepth - 1);
        const row = $from.node(cellDepth - 1);
        const isLastCell = rowIdx === tableNode.childCount - 1 &&
          cellIdx === row.childCount - 1;
        if (isLastCell) {
          const tableStart = $from.before(tableDepth);
          const tableEnd = tableStart + tableNode.nodeSize;
          if (tableEnd >= state.doc.content.size) {
            if (dispatch) {
              const para = schema.nodes.paragraph.create();
              const tr = state.tr.insert(tableEnd, para);
              tr.setSelection(TextSelection.create(tr.doc, tableEnd + 1));
              dispatch(tr);
            }
            return true;
          }
        }
        // Inside a cell but not the last-cell-at-end-of-doc — let base
        // keymap handle it (typically a no-op due to isolating/defining).
        return false;
      }

      // Live trigger: a paragraph whose text is exactly `|c1|c2|...|`
      // (≥ 2 cells, leading + trailing pipes) commits to a table on Enter.
      const sel = state.selection;
      if (!sel.empty) return false;
      if ($from.parent.type.name !== "paragraph") return false;
      const text = $from.parent.textContent;
      if (!/^\|.+\|$/.test(text)) return false;
      const parts = text.split("|");
      // Leading + trailing `|` always produce empty first/last entries.
      const cells = parts.slice(1, -1).map((c) => c.trim());
      if (cells.length < 2) return false;

      if (dispatch) {
        const headerRow = schema.nodes.table_row.create(
          null,
          cells.map((c) =>
            schema.nodes.table_cell.create(
              { header: true, align: null },
              c ? [schema.text(c)] : [],
            ),
          ),
        );
        const bodyRow = schema.nodes.table_row.create(
          null,
          cells.map(() =>
            schema.nodes.table_cell.create(
              { header: false, align: null },
              [],
            ),
          ),
        );
        const tableNode = schema.nodes.table.create(null, [headerRow, bodyRow]);

        const paraStart = $from.before();
        const paraEnd = $from.after();
        const tr = state.tr;
        tr.replaceWith(paraStart, paraEnd, tableNode);
        // Cursor inside first body cell. Position: paraStart (= table
        // start) + 1 (table open) + headerRow.nodeSize + 1 (body row open)
        // + 1 (first cell open).
        const firstBodyCell = paraStart + 1 + headerRow.nodeSize + 2;
        tr.setSelection(TextSelection.create(tr.doc, firstBodyCell));
        dispatch(tr);
      }
      return true;
    },
  }),

  parserTokens: {
    table_open: (state, _tok, schema) => {
      state.openNode(schema.nodes.table);
    },
    table_close: (state) => {
      state.closeNode();
    },
    // thead/tbody are wrappers in md-it but our schema is flat — skip them.
    thead_open: () => {},
    thead_close: () => {},
    tbody_open: () => {},
    tbody_close: () => {},
    tr_open: (state, _tok, schema) => {
      state.openNode(schema.nodes.table_row);
    },
    tr_close: (state) => {
      state.closeNode();
    },
    th_open: (state, tok, schema) => {
      const align = parseAlignFromStyle(tok.attrGet("style"));
      state.openNode(schema.nodes.table_cell, { header: true, align });
    },
    th_close: (state) => {
      state.closeNode();
    },
    td_open: (state, tok, schema) => {
      const align = parseAlignFromStyle(tok.attrGet("style"));
      state.openNode(schema.nodes.table_cell, { header: false, align });
    },
    td_close: (state) => {
      state.closeNode();
    },
  },

  blockHandlers: {
    table: (state, node) => {
      // Render every cell first so we can measure column widths and
      // emit nicely padded source on save. Two-pass (measure → emit).
      const rows: string[][] = [];
      const aligns: Array<string | null> = [];
      node.forEach((row, _, rowIdx) => {
        const cells: string[] = [];
        row.forEach((cell, _o, cellIdx) => {
          if (rowIdx === 0) aligns[cellIdx] = cell.attrs.align as string | null;
          cells.push(renderCellInline(cell));
        });
        rows.push(cells);
      });

      const colCount = aligns.length;
      const widths = new Array<number>(colCount).fill(3);
      for (const r of rows)
        for (let i = 0; i < colCount; i++)
          widths[i] = Math.max(widths[i]!, (r[i] ?? "").length);

      const formatRow = (cells: string[]): string => {
        const padded = cells.map((c, i) => " " + c.padEnd(widths[i]!) + " ");
        return "|" + padded.join("|") + "|";
      };
      const dividerRow = (): string => {
        const dividers = aligns.map((a, i) => " " + alignDelim(a, widths[i]!) + " ");
        return "|" + dividers.join("|") + "|";
      };

      // Header row → divider → body rows.
      state.write(formatRow(rows[0] ?? []));
      state.out += "\n";
      if (state.delim) state.out += state.delim;
      state.out += dividerRow();
      for (let i = 1; i < rows.length; i++) {
        state.out += "\n";
        if (state.delim) state.out += state.delim;
        state.out += formatRow(rows[i]!);
      }
      state.closeBlock(node);
    },
  },

  sourcePreserve: tableSourcePreserve,
};
