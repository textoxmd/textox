import { describe, expect, test, vi, afterEach } from "vitest";
import { TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { parse } from "../src/parser.ts";
import { createState } from "../src/editor.ts";
import { serialize } from "../src/serializer.ts";

// The floating toolbar shows the active style button when the selection is
// inside a mark. Clicking that button again must UNWRAP the mark. Unwrap
// detection in toggleInlineDelim compares the delim chars adjacent to the
// selection — but when the drag stops a pixel past the visible text, the
// selection boundary drifts onto a hidden delimiter char (`**` is
// font-size:0) and the adjacent text no longer equals the full delim, so it
// wrongly wraps again instead of unwrapping.

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

function clickBold(): void {
  const btn = document.querySelector<HTMLButtonElement>(
    '.fmt-toolbar .floating-toolbar-btn[title*="bold" i]',
  );
  if (!btn) throw new Error("bold button not found");
  btn.click();
}

describe("floating toolbar click unwraps a mark despite hidden delim drift", () => {
  test("exact selection of visible bold content unwraps", () => {
    const { view, mount } = setupView("**bold**");
    try {
      select(view, 3, 7);
      clickBold();
      expect(serialize(view.state.doc)).toBe("bold");
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("selection slightly past the visible content (into hidden `**`) still unwraps", () => {
    const { view, mount } = setupView("**bold**");
    try {
      select(view, 3, 8); // to drifts into the closing `**`
      clickBold();
      expect(serialize(view.state.doc)).toBe("bold");
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("selection starting slightly before the visible content still unwraps", () => {
    const { view, mount } = setupView("**bold**");
    try {
      select(view, 1, 7); // from drifts into the opening `**`
      clickBold();
      expect(serialize(view.state.doc)).toBe("bold");
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("plain text selection wraps instead", () => {
    const { view, mount } = setupView("hello world");
    try {
      select(view, 2, 6); // "ello"
      clickBold();
      expect(serialize(view.state.doc)).toBe("h**ello** world");
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("clicking Bold on inner text of **==代码显示==** unwraps the outer bold", () => {
    const { view, mount } = setupView("**==代码显示==**");
    try {
      select(view, 5, 9); // inner "代码显示"
      clickBold();
      expect(serialize(view.state.doc)).toBe("==代码显示==");
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("clicking Bold on **TEXT** does not touch anything (only one style)", () => {
    const { view, mount } = setupView("**TEXT**");
    try {
      select(view, 3, 7);
      clickBold();
      expect(serialize(view.state.doc)).toBe("TEXT");
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});
