import { TextSelection } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";

export interface ToggleView {
  state: EditorState;
  dispatch(tr: Transaction): void;
  focus?: () => void;
  // Optional DOM access — present on the real EditorView; lets the toggle
  // detect hidden delimiter chars and nudge selection boundaries onto
  // visible text before comparing delimiters.
  dom?: Node;
  domAtPos?: (pos: number, side?: number) => { node: Node; offset: number };
}

export const DELIM_TO_MARK: Record<string, string> = {
  "**": "strong",
  "*": "em",
  "~~": "strike",
  "`": "code",
};

export const DELIM_TO_CLOSE: Record<string, string> = {};

// True when the character at `pos` is inside a `.syntax-hidden` span — a
// markdown delimiter (`**`, `==`, `` ` `` …) that method-B decorations hide
// (font-size:0 / display:none in the theme). When a selection boundary
// drifts onto such a char, the delim-adjacent text comparison fails, so
// boundaries must be nudged to visible text first.
export function isHiddenDelimAt(view: ToggleView, pos: number): boolean {
  if (!view.domAtPos || !view.dom) return false;
  const { node } = view.domAtPos(pos, 1);
  let el: Element | null = node.nodeType === 3 ? node.parentElement : (node as Element);
  while (el && el !== view.dom) {
    if (el.classList.contains("syntax-hidden")) return true;
    el = el.parentElement;
  }
  return false;
}

// Nudge a selection boundary off hidden delimiter chars so the delimiters
// adjacent to the selection are the full delim pairs. `from` moves forward,
// `to` backward. Falls back to the raw boundaries when the view has no DOM
// access (headless tests) or the selection is entirely hidden.
export function visibleBoundaries(
  view: ToggleView,
  from: number,
  to: number,
): { from: number; to: number } {
  let vFrom = from;
  while (vFrom < to && isHiddenDelimAt(view, vFrom)) vFrom++;
  let vTo = to;
  while (vTo > vFrom && isHiddenDelimAt(view, vTo - 1)) vTo--;
  if (vFrom >= vTo) return { from, to };
  return { from: vFrom, to: vTo };
}

export function toggleInlineDelim(
  view: ToggleView,
  delim: string,
  closeDelim?: string,
  explicitMarkName?: string,
): void {
  const { from, to, empty } = view.state.selection;
  const doc = view.state.doc;
  const close = closeDelim ?? DELIM_TO_CLOSE[delim] ?? delim;
  const openLen = delim.length;
  const closeLen = close.length;

  if (empty) {
    const $from = view.state.selection.$from;
    const markName = explicitMarkName ?? DELIM_TO_MARK[delim];
    if (markName) {
      const run = findMarkRunAtCursor($from, markName, openLen, closeLen);
      if (run) {
        const before = run.from >= openLen
          ? doc.textBetween(run.from - openLen, run.from)
          : "";
        const after = run.to + closeLen <= doc.content.size
          ? doc.textBetween(run.to, run.to + closeLen)
          : "";
        if (before === delim && after === close) {
          view.dispatch(
            view.state.tr
              .delete(run.to, run.to + closeLen)
              .delete(run.from - openLen, run.from),
          );
          view.focus?.();
          return;
        }
      }
    }
    return;
  }

  // Unwrap when the whole selection is covered by the mark — decided by the
  // doc's marks (same source as the toolbar active state), not by scanning
  // the adjacent delim chars. Adjacent-text matching misfires on nesting
  // (`**==代码显示==**` inner text — the adjacent chars are `==`, so Bold
  // would wrongly re-wrap) and on overlapping delims (`**TEXT**` could be
  // mistaken for italic from the single `*` of `**`).
  const markName = explicitMarkName ?? DELIM_TO_MARK[delim];
  if (markName) {
    // Nudge boundaries off hidden delimiter chars first: the selection may
    // drift a pixel onto an invisible `**`/`==` char whose text node has no
    // mark, which would make the range-scan report "not covered".
    const v = visibleBoundaries(view, from, to);
    if (isRangeInMark(view.state, v.from, v.to, markName)) {
      // Resolve at the *visible* start: the raw $from can sit on a hidden
      // delim char outside the mark run (nested `==**x**==` selecting into
      // the outer `=`), which findMarkRunAtCursor would miss.
      const $visible = view.state.doc.resolve(v.from);
      const run = findMarkRunAtCursor($visible, markName, openLen, closeLen);
      if (run) {
        view.dispatch(
          view.state.tr
            .delete(run.to, run.to + closeLen)
            .delete(run.from - openLen, run.from),
        );
        view.focus?.();
        return;
      }
    }
  }

  const text = doc.textBetween(from, to);
  const tr = view.state.tr.replaceWith(from, to, view.state.schema.text(delim + text + close));
  tr.setSelection(TextSelection.create(tr.doc, from + openLen, from + openLen + text.length));
  view.dispatch(tr);
  view.focus?.();
}

// from..to 之间的所有文本节点是否都带指定 mark。
function isRangeInMark(
  state: EditorState,
  from: number,
  to: number,
  markName: string,
): boolean {
  const markType = state.schema.marks[markName];
  if (!markType) return false;
  let found = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText && !node.marks.some((m) => m.type === markType)) {
      found = true;
      return false;
    }
  });
  return !found;
}

// 找到光标所在 textblock 中与光标相关的 mark run。
// 与旧版（严格要求光标在 run 内）不同：把光标在 delimiter 边界（`**|bold**`、
// `**bold|**`）或 delimiter 内部（`**|` 的 `**` 内）也算作"在此 mark 内"，
// 这样用户视觉上点在粗体字上/边缘时点按钮也能取消。
function findMarkRunAtCursor(
  $pos: import("prosemirror-model").ResolvedPos,
  markName: string,
  openLen: number,
  closeLen: number,
): { from: number; to: number } | null {
  const textblock = $pos.parent;
  if (!textblock.isTextblock) return null;
  const markType = textblock.type.schema.marks[markName];
  if (!markType) return null;
  const blockStart = $pos.start();
  const cursorOff = $pos.parentOffset;

  // 收集所有连续 mark run（block 内偏移区间）。
  const runs: Array<{ start: number; end: number }> = [];
  let runStart = -1;
  let runEnd = -1;
  let off = 0;
  textblock.forEach((child) => {
    if (child.isText) {
      const has = child.marks.some((m) => m.type === markType);
      if (has && runStart < 0) runStart = off;
      if (has) runEnd = off + child.nodeSize;
      if (!has && runStart >= 0) {
        runs.push({ start: runStart, end: runEnd });
        runStart = -1;
        runEnd = -1;
      }
    }
    off += child.nodeSize;
    return true;
  });
  if (runStart >= 0) runs.push({ start: runStart, end: runEnd });

  // 光标落在 [start - openLen, end + closeLen]（含 delimiter 边界与内部）即命中。
  const hit = runs.find(
    (r) => cursorOff >= r.start - openLen && cursorOff <= r.end + closeLen,
  );
  if (!hit) return null;
  return { from: blockStart + hit.start, to: blockStart + hit.end };
}
