import { describe, expect, test, vi, afterEach } from "vitest";
import { TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { parse } from "../src/parser.ts";
import { createState } from "../src/editor.ts";

// The floating inline-format toolbar positions itself from
// `view.coordsAtPos(from/to)`. When a selection boundary lands on a hidden
// delimiter char (`**`, `==`, `` ` `` … which are `.syntax-hidden` /
// font-size:0 in the app theme), coordsAtPos returns a degenerate rect and
// the toolbar jumps to the wrong place. The toolbar must query coordinates
// at the *visible* selection boundaries instead.

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function setupView(md: string) {
  const doc = parse(md);
  const state = createState(doc);
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const view = new EditorView(mount, { state });
  return { view, doc, mount };
}

function select(view: EditorView, from: number, to: number) {
  vi.useFakeTimers();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  view.focus();
  vi.advanceTimersByTime(600);
}

function spyCoords(view: EditorView): Array<[number, number | undefined]> {
  const calls: Array<[number, number | undefined]> = [];
  const orig = view.coordsAtPos.bind(view);
  view.coordsAtPos = ((pos: number, side?: number) => {
    calls.push([pos, side]);
    return orig(pos, side);
  }) as EditorView["coordsAtPos"];
  return calls;
}

describe("inline-format-toolbar position vs hidden delimiters", () => {
  test("selecting the visible text of **bold** queries coords at visible chars", () => {
    const { view, mount } = setupView("**bold**");
    try {
      const calls = spyCoords(view);
      select(view, 3, 7); // "bold" only — to is right before the closing `**`
      expect(calls.length).toBeGreaterThan(0);
      // The `to` boundary must be queried with side=-1 (element BEFORE the
      // position = the visible 'd'), not side=1 (element after = the hidden
      // closing `*`).
      expect(calls.some(([p, s]) => p === 7 && s === -1)).toBe(true);
      // The `from` boundary is the visible 'b'.
      expect(calls.some(([p, s]) => p === 3 && s === 1)).toBe(true);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("selecting the whole **bold** (incl. delims) nudges to visible chars", () => {
    const { view, mount } = setupView("**bold**");
    try {
      const calls = spyCoords(view);
      select(view, 1, 9); // includes the `**` delims
      expect(calls.length).toBeGreaterThan(0);
      for (const [p] of calls) {
        expect(p).toBeGreaterThanOrEqual(3);
        expect(p).toBeLessThanOrEqual(7);
      }
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("plain text selection still queries the real boundaries", () => {
    const { view, mount } = setupView("hello world");
    try {
      const calls = spyCoords(view);
      select(view, 2, 5); // "ell" — no leading/trailing space
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.some(([p]) => p === 2)).toBe(true);
      expect(calls.some(([p]) => p === 5)).toBe(true);
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});
