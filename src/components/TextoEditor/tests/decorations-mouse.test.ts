import { describe, expect, test, afterEach } from "vitest";
import { EditorView } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";

import { createState } from "../src/editor.ts";
import { parse } from "../src/parser.ts";
import { pretty } from "../specs/pretty.ts";
import { setSyntaxHintsMouseDown } from "../src/decorations.ts";

// The delim reveal (Typora-style gray `**`) depends on the cursor being at
// rest inside the surrounding span. While the mouse is held down (drag
// selection), reveal is suppressed so the line keeps a stable layout —
// otherwise the delims pop in/out mid-drag, reflowing the text under the
// pointer and making precise selection jitter. On mouseup a plain click
// (empty selection inside a span) re-reveals them.

afterEach(() => {
  setSyntaxHintsMouseDown(false);
});

// `**bold**` → textblock positions: `*`=1,2 `b`=3 `o`=4 `l`=5 `d`=6 `*`=7,8.
// Cursor at 5 = inside the bold span, mid-word (no delim boundary split).
const MID_SPAN = 5;

function setupInsideBold() {
  const doc = parse("**bold**");
  const state = createState(doc);
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, MID_SPAN, MID_SPAN)),
  );
}

function hintCount(view: EditorView): number {
  return view.dom.querySelectorAll(".syntax-hint").length;
}

describe("syntax-hint mouse suppression", () => {
  test("cursor inside a span shows delims at rest", () => {
    const state = setupInsideBold();
    expect(pretty(state)).toBe("<g>**</g><b>bo|ld</b><g>**</g>");
  });

  test("while mouse is pressed, delims stay hidden", () => {
    let state = setupInsideBold();
    setSyntaxHintsMouseDown(true);
    // selection-only transaction (what PM dispatches after mousedown) —
    // rebuild must keep the delims hidden despite the empty cursor inside
    // the span.
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, MID_SPAN, MID_SPAN)),
    );
    expect(pretty(state)).toBe("<b>bo|ld</b>");
  });

  test("release reveals delims again for a plain click", () => {
    setSyntaxHintsMouseDown(true);
    let state = setupInsideBold();
    setSyntaxHintsMouseDown(false);
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, MID_SPAN, MID_SPAN)),
    );
    expect(pretty(state)).toBe("<g>**</g><b>bo|ld</b><g>**</g>");
  });

  test("a drag selection stays hidden through press and release", async () => {
    const state = setupInsideBold();
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    try {
      expect(hintCount(view)).toBe(2);

      view.dom.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
      );
      // PM dispatches the (non-empty) drag selection as the mouse moves.
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 8)),
      );
      expect(hintCount(view)).toBe(0);

      document.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }),
      );
      await new Promise((r) => setTimeout(r, 0));
      // Selection still non-empty after release → delims stay hidden.
      expect(hintCount(view)).toBe(0);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("plain click reveals delims on release", async () => {
    const state = setupInsideBold();
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    try {
      expect(hintCount(view)).toBe(2);

      view.dom.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
      );
      // No drag: PM dispatches the collapsed caret selection on press.
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, MID_SPAN, MID_SPAN)),
      );
      expect(hintCount(view)).toBe(0);

      document.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }),
      );
      await new Promise((r) => setTimeout(r, 0));
      expect(hintCount(view)).toBe(2);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("click outside the editor does not start a press", async () => {
    const state = setupInsideBold();
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    try {
      expect(hintCount(view)).toBe(2);

      outside.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
      );
      // No press was started on the editor → delims stay revealed.
      expect(hintCount(view)).toBe(2);

      outside.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }),
      );
      await new Promise((r) => setTimeout(r, 0));
      expect(hintCount(view)).toBe(2);
    } finally {
      view.destroy();
      outside.remove();
      mount.remove();
    }
  });

  test("one editor's press does not suppress a second editor's delims", async () => {
    const s1 = setupInsideBold();
    const m1 = document.createElement("div");
    document.body.appendChild(m1);
    const v1 = new EditorView(m1, { state: s1 });

    const s2 = setupInsideBold();
    const m2 = document.createElement("div");
    document.body.appendChild(m2);
    const v2 = new EditorView(m2, { state: s2 });
    try {
      expect(hintCount(v2)).toBe(2);

      // Press inside editor 1…
      v1.dom.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
      );
      // …must not affect editor 2. v1's own rebuild (a selection txn, as
      // PM dispatches while dragging) hides its delims, v2 stays revealed.
      v1.dispatch(
        v1.state.tr.setSelection(TextSelection.create(v1.state.doc, 3, 7)),
      );
      expect(hintCount(v2)).toBe(2);
      expect(hintCount(v1)).toBe(0);

      document.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }),
      );
      await new Promise((r) => setTimeout(r, 0));
      // v1 has a non-empty selection (3..7) → delims stay hidden; v2 is
      // unaffected by v1's press/release cycle.
      expect(hintCount(v1)).toBe(0);
      expect(hintCount(v2)).toBe(2);
    } finally {
      v1.destroy();
      v2.destroy();
      m1.remove();
      m2.remove();
    }
  });
});
