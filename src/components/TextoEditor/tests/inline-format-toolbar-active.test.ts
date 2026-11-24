import { describe, expect, test, vi, afterEach } from "vitest";
import { TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { parse } from "../src/parser.ts";
import { createState } from "../src/editor.ts";

// The floating inline-format toolbar's per-button `active` state should
// reflect the marks on the selected text (same as the top toolbar), not a
// textBetween scan of the adjacent delimiter chars. The adjacent-char
// approach misfires on nesting (`**==代码显示==**` inner text misses Bold)
// and on overlapping delims (`**TEXT**` wrongly reports Italic from the
// single `*` of `**`). Boundaries must also be nudged off hidden delimiter
// chars, since the delims are font-size:0 in the theme and invisible.

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

function btnActive(title: string): boolean {
  const btn = document.querySelector<HTMLButtonElement>(
    `.fmt-toolbar .floating-toolbar-btn[title="${title}"]`,
  );
  return btn?.classList.contains("active") ?? false;
}

function clickBtn(title: string): void {
  const btn = document.querySelector<HTMLButtonElement>(
    `.fmt-toolbar .floating-toolbar-btn[title="${title}"]`,
  );
  if (!btn) throw new Error(`button not found: ${title}`);
  btn.click();
}

function toolbarShown(): boolean {
  return !!document.querySelector(".fmt-toolbar");
}

describe("inline-format-toolbar active state vs hidden delimiters", () => {
  test("exact selection of the visible bold content is active", () => {
    const { view, mount } = setupView("**bold**");
    try {
      select(view, 3, 7); // "bold" exactly
      expect(btnActive("Bold")).toBe(true);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("selection slightly past the visible content (into hidden `**`) is still active", () => {
    const { view, mount } = setupView("**bold**");
    try {
      // Visually still "bold" — the closing `**` is font-size:0, but the
      // selection boundary has crossed into it.
      select(view, 3, 8);
      expect(btnActive("Bold")).toBe(true);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("selection starting slightly before the visible content is still active", () => {
    const { view, mount } = setupView("**bold**");
    try {
      select(view, 1, 7); // from has crossed into the opening `**`
      expect(btnActive("Bold")).toBe(true);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("plain text selection is not active", () => {
    const { view, mount } = setupView("hello world");
    try {
      select(view, 2, 7);
      expect(btnActive("Bold")).toBe(false);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("**==代码显示==** inner text shows BOTH bold and highlight", () => {
    const { view, mount } = setupView("**==代码显示==**");
    try {
      // Select the inner "代码显示" (positions 5..9)
      select(view, 5, 9);
      expect(btnActive("Bold")).toBe(true);
      expect(btnActive("Highlight")).toBe(true);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("**TEXT** shows bold but NOT italic", () => {
    const { view, mount } = setupView("**TEXT**");
    try {
      select(view, 3, 7); // "TEXT"
      expect(btnActive("Bold")).toBe(true);
      expect(btnActive("Italic")).toBe(false);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("applying bold to plain text activates the Bold button immediately", () => {
    const { view, mount } = setupView("hello");
    try {
      select(view, 1, 6); // whole "hello"
      expect(btnActive("Bold")).toBe(false);
      clickBtn("Bold");
      expect(btnActive("Bold")).toBe(true);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("removing bold from bold text clears the active state immediately", () => {
    const { view, mount } = setupView("**bold**");
    try {
      select(view, 3, 7); // "bold"
      expect(btnActive("Bold")).toBe(true);
      clickBtn("Bold");
      expect(btnActive("Bold")).toBe(false);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("selection with leading space hides the toolbar (invalid markdown)", () => {
    const { view, mount } = setupView("a hello b");
    try {
      select(view, 2, 8); // " hello " — starts with space
      expect(toolbarShown()).toBe(false);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("selection with trailing space hides the toolbar (invalid markdown)", () => {
    const { view, mount } = setupView("a hello b");
    try {
      select(view, 3, 9); // "hello " — ends with space
      expect(toolbarShown()).toBe(false);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("selection without edge whitespace still shows the toolbar", () => {
    const { view, mount } = setupView("a hello b");
    try {
      select(view, 3, 8); // "hello"
      expect(toolbarShown()).toBe(true);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("selection ending on hidden `**` whose visible edge is a space still hides", () => {
    const { view, mount } = setupView("word **bold**");
    try {
      // 8..13 = "bold" + the trailing invisible `**`. The *visible* text is
      // just "bold" (no trailing space), so the toolbar must NOT be hidden
      // by the whitespace check (it reads the nudged boundaries).
      select(view, 8, 13);
      expect(toolbarShown()).toBe(true);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("selection whose visible start is a space hides the toolbar", () => {
    const { view, mount } = setupView("word **bold**");
    try {
      // 5..8 = " " + `**` + "b" — the visible start (after nudging off the
      // hidden `**`) is a space.
      select(view, 5, 8);
      expect(toolbarShown()).toBe(false);
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});
