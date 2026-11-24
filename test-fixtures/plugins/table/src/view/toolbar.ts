import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { LayoutGridIcon, TrashIcon } from "@animateicons/react/lucide";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import type { Node as PMNode } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import i18next from "i18next";

import "./table.css";

// ---------------- toolbar plugin ----------------
//
// Floating toolbar shown when the cursor is inside a table. Carries:
//   * resize trigger (田字格 icon) → opens a popup with a hover-grid
//     and numeric R × C inputs to resize the table.
//   * 3 align buttons → set `align` on every cell in the cursor's
//     current column.
//   * trash → delete the whole table (replaced by an empty paragraph).
//
// The toolbar lives at `document.body` (position: fixed, viewport
// coords). Position is recomputed every PM transaction from the table
// element's bounding rect. The shared floating chrome
// (`.floating-toolbar` / `.floating-toolbar-btn` / `.floating-toolbar-sep`)
// is defined by the core widgets stylesheet.

type TableInfo = {
  pos: number; // pos *of* the table node (so view.nodeDOM works).
  node: PMNode;
  rowIdx: number;
  cellIdx: number;
};

function findTableAtSelection(state: import("prosemirror-state").EditorState): TableInfo | null {
  const $from = state.selection.$from;
  let cellDepth = -1;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === "table_cell") {
      cellDepth = d;
      break;
    }
  }
  if (cellDepth === -1) return null;
  const tableDepth = cellDepth - 2;
  return {
    pos: $from.before(tableDepth),
    node: $from.node(tableDepth),
    rowIdx: $from.index(tableDepth),
    cellIdx: $from.index(cellDepth - 1),
  };
}

function applyAlignToColumn(
  view: EditorView,
  info: TableInfo,
  align: "left" | "center" | "right" | null,
): void {
  const tr = view.state.tr;
  let pos = info.pos + 1; // inside table
  info.node.forEach((row) => {
    let cellPos = pos + 1; // inside row
    row.forEach((cell, _o, idx) => {
      if (idx === info.cellIdx) {
        tr.setNodeMarkup(cellPos, null, { ...cell.attrs, align });
      }
      cellPos += cell.nodeSize;
    });
    pos += row.nodeSize;
  });
  view.dispatch(tr);
  view.focus();
}

function deleteTable(view: EditorView, info: TableInfo): void {
  const schema = view.state.schema;
  const tr = view.state.tr;
  const start = info.pos;
  const end = start + info.node.nodeSize;
  const para = schema.nodes.paragraph.create();
  tr.replaceWith(start, end, para);
  tr.setSelection(TextSelection.create(tr.doc, start + 1));
  view.dispatch(tr);
  view.focus();
}

function resizeTable(
  view: EditorView,
  info: TableInfo,
  rows: number,
  cols: number,
): void {
  if (rows < 1 || cols < 1) return;
  const schema = view.state.schema;
  const old = info.node;
  const oldRows: PMNode[] = [];
  old.forEach((r) => oldRows.push(r));

  const newRows: PMNode[] = [];
  for (let r = 0; r < rows; r++) {
    const oldRow = oldRows[r];
    const oldCells: PMNode[] = [];
    if (oldRow) oldRow.forEach((c) => oldCells.push(c));
    const cells: PMNode[] = [];
    for (let c = 0; c < cols; c++) {
      const oldCell = oldCells[c];
      const isHeader = r === 0;
      // Reuse alignment from the corresponding column in the old
      // header row (if any) so resizing preserves user intent.
      const headerRowOld = oldRows[0];
      const align =
        headerRowOld && c < headerRowOld.childCount
          ? (headerRowOld.child(c).attrs.align as string | null)
          : null;
      const content = oldCell ? oldCell.content : null;
      cells.push(
        schema.nodes.table_cell.create(
          { header: isHeader, align },
          content,
        ),
      );
    }
    newRows.push(schema.nodes.table_row.create(null, cells));
  }
  const newTable = schema.nodes.table.create(null, newRows);
  const tr = view.state.tr;
  const start = info.pos;
  const end = start + old.nodeSize;
  tr.replaceWith(start, end, newTable);
  // Place cursor inside the first body cell (or first cell if rows=1).
  const firstBodyCell =
    start + 1 + newRows[0]!.nodeSize + (rows > 1 ? 2 : -newRows[0]!.nodeSize + 2);
  // ^ if rows>1: tableStart+1 (table) + headerSize + 1 (row open) + 1 (cell open)
  //   if rows=1: tableStart+1 (table) + 1 (row open) + 1 (cell open)
  const safePos = Math.min(firstBodyCell, tr.doc.content.size);
  tr.setSelection(TextSelection.create(tr.doc, safePos));
  view.dispatch(tr);
  view.focus();
}

function buildToolbar(view: EditorView, getInfo: () => TableInfo | null): {
  root: HTMLElement;
  popup: HTMLElement;
  iconRoots: Root[];
} {
  const t = i18next.t.bind(i18next);
  const iconRoots: Root[] = [];
  const root = document.createElement("div");
  root.className = "floating-toolbar";

  const grid = document.createElement("button");
  grid.type = "button";
  grid.className = "floating-toolbar-btn";
  grid.title = t("table.editTable");
  const gridRoot = createRoot(grid);
  gridRoot.render(createElement(LayoutGridIcon, { size: 14, color: "currentColor" }));
  iconRoots.push(gridRoot);

  const sep = document.createElement("span");
  sep.className = "floating-toolbar-sep";

  const alignTitles: Record<string, string> = {
    left: t("table.alignLeft"),
    center: t("table.alignCenter"),
    right: t("table.alignRight"),
  };
  const mkAlign = (a: "left" | "center" | "right", icon: ComponentType) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "floating-toolbar-btn";
    b.title = alignTitles[a];
    b.dataset.align = a;
    const iconRoot = createRoot(b);
    iconRoot.render(createElement(icon as ComponentType<{size?: number}>, { size: 14 }));
    iconRoots.push(iconRoot);
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      const info = getInfo();
      if (info) applyAlignToColumn(view, info, a);
    });
    return b;
  };
  const alignL = mkAlign("left", AlignLeft);
  const alignC = mkAlign("center", AlignCenter);
  const alignR = mkAlign("right", AlignRight);

  const trashSep = document.createElement("span");
  trashSep.className = "floating-toolbar-sep";

  const trash = document.createElement("button");
  trash.type = "button";
  trash.className = "floating-toolbar-btn table-tb-trash";
  trash.title = t("table.deleteTable");
  const trashRoot = createRoot(trash);
  trashRoot.render(createElement(TrashIcon, { size: 14, color: "currentColor" }));
  iconRoots.push(trashRoot);
  trash.addEventListener("mousedown", (e) => e.preventDefault());
  trash.addEventListener("click", () => {
    const info = getInfo();
    if (info) deleteTable(view, info);
  });

  root.append(grid, sep, alignL, alignC, alignR, trashSep, trash);

  // Resize popup — built once, toggled on grid click. Hover the grid
  // to highlight up to (R, C); the numeric inputs reflect the hover
  // and can be edited directly. Click the grid (or press Enter on the
  // inputs) to commit.
  //
  // Snapshot the current TableInfo when the popup opens: while the
  // popup is up, the user may interact with the popup (focusing
  // inputs, clicking grid cells) which can cause `getInfo()` to flip
  // to null mid-action. The snapshot keeps the target table stable.
  let popupSnapshot: TableInfo | null = null;
  const popup = document.createElement("div");
  popup.className = "table-resize-popup";
  popup.style.display = "none";
  // Block focus loss when clicking the popup background — preserves
  // editor selection so the snapshot stays valid. Inputs are exempt;
  // they need to receive focus to be typed in.
  popup.addEventListener("mousedown", (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName !== "INPUT") e.preventDefault();
  });

  const gridEl = document.createElement("div");
  gridEl.className = "table-resize-grid";
  const MAX_R = 10;
  const MAX_C = 10;
  const cells: HTMLElement[][] = [];
  for (let r = 0; r < MAX_R; r++) {
    const row: HTMLElement[] = [];
    for (let c = 0; c < MAX_C; c++) {
      const cell = document.createElement("div");
      cell.className = "table-resize-cell";
      cell.dataset.r = String(r + 1);
      cell.dataset.c = String(c + 1);
      gridEl.appendChild(cell);
      row.push(cell);
    }
    cells.push(row);
  }

  const inputs = document.createElement("div");
  inputs.className = "table-resize-inputs";
  const rIn = document.createElement("input");
  rIn.type = "number";
  rIn.min = "1";
  rIn.max = "20";
  const xLabel = document.createElement("span");
  xLabel.textContent = "×";
  const cIn = document.createElement("input");
  cIn.type = "number";
  cIn.min = "1";
  cIn.max = "20";
  inputs.append(rIn, xLabel, cIn);

  const setHighlight = (R: number, C: number) => {
    for (let r = 0; r < MAX_R; r++)
      for (let c = 0; c < MAX_C; c++) {
        cells[r]![c]!.classList.toggle("hover", r < R && c < C);
      }
    rIn.value = String(R);
    cIn.value = String(C);
  };
  gridEl.addEventListener("mousemove", (e) => {
    const t = (e.target as HTMLElement).closest(".table-resize-cell") as HTMLElement | null;
    if (!t) return;
    setHighlight(Number(t.dataset.r), Number(t.dataset.c));
  });
  gridEl.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest(".table-resize-cell") as HTMLElement | null;
    if (!t) return;
    const target = popupSnapshot ?? getInfo();
    if (!target) return;
    resizeTable(view, target, Number(t.dataset.r), Number(t.dataset.c));
    popup.style.display = "none";
    popupSnapshot = null;
  });
  const commitInputs = () => {
    const target = popupSnapshot ?? getInfo();
    if (!target) return;
    const R = Math.max(1, Math.min(20, Number(rIn.value) || 1));
    const C = Math.max(1, Math.min(20, Number(cIn.value) || 1));
    resizeTable(view, target, R, C);
    popup.style.display = "none";
    popupSnapshot = null;
  };
  rIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitInputs();
    }
  });
  cIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitInputs();
    }
  });

  popup.append(gridEl, inputs);

  grid.addEventListener("mousedown", (e) => e.preventDefault());
  grid.addEventListener("click", () => {
    const liveInfo = getInfo();
    if (!liveInfo) return;
    if (popup.style.display === "block") {
      popup.style.display = "none";
      popupSnapshot = null;
      return;
    }
    popupSnapshot = liveInfo;
    // Initialize highlight to current dims.
    let R = 0, C = 0;
    liveInfo.node.forEach((row) => {
      R++;
      C = Math.max(C, row.childCount);
    });
    setHighlight(Math.min(R, MAX_R), Math.min(C, MAX_C));
    // Anchor below the trigger button.
    const r = grid.getBoundingClientRect();
    popup.style.top = `${r.bottom + 4}px`;
    popup.style.left = `${r.left}px`;
    popup.style.display = "block";
  });

  return { root, popup, iconRoots };
}

export function createTableToolbar(view: EditorView): { update(): void; destroy(): void } {
  let info: TableInfo | null = null;
  // Lazy: toolbar DOM is only built and appended when this view is
  // both focused and on a table. Unfocused views (every case-card
  // in the harness with a table seed) never create toolbar DOM.
  let toolbar: { root: HTMLElement; popup: HTMLElement; iconRoots: Root[] } | null = null;

  const ensureMounted = () => {
    if (!toolbar) {
      toolbar = buildToolbar(view, () => info);
    }
    if (!toolbar.root.isConnected) {
      document.body.appendChild(toolbar.root);
      document.body.appendChild(toolbar.popup);
    }
    return toolbar;
  };
  const unmount = () => {
    if (toolbar?.root.isConnected) {
      toolbar.popup.style.display = "none";
      toolbar.root.remove();
      toolbar.popup.remove();
    }
  };

  const update = () => {
    if (!view.editable) { unmount(); return; }
    info = findTableAtSelection(view.state);
    if (!info || !view.hasFocus()) {
      unmount();
      return;
    }
    const dom = view.nodeDOM(info.pos) as HTMLElement | null;
    if (!dom) {
      unmount();
      return;
    }
    const tb = ensureMounted();
    const rect = dom.getBoundingClientRect();
    tb.root.style.display = "flex";
    tb.root.style.top = `${rect.top - 40}px`;
    tb.root.style.left = `${rect.left}px`;
    // Reflect current column's align in the button states.
    const cell = info.node.child(info.rowIdx).child(info.cellIdx);
    const cur = cell.attrs.align as string | null;
    tb.root.querySelectorAll<HTMLElement>("[data-align]").forEach((b) => {
      b.classList.toggle("active", b.dataset.align === cur);
    });
  };

  const onScroll = () => update();
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
  view.dom.addEventListener("focusin", update);
  view.dom.addEventListener("focusout", update);

  return {
    update() {
      update();
    },
    destroy() {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      view.dom.removeEventListener("focusin", update);
      view.dom.removeEventListener("focusout", update);
      if (toolbar) {
        toolbar.iconRoots.forEach((r) => r.unmount());
      }
      unmount();
    },
  };
}

export function tableToolbarPlugin(): Plugin {
  return new Plugin({ view: (v) => createTableToolbar(v) });
}
