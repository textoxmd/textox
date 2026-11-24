import { beforeAll, describe, expect, test, vi, afterEach } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { parse } from "../../src/parser.ts";
import { getSchema } from "../../src/schema.ts";

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});
import { inlineFormatToolbarPlugin, setInlineFormatToolbarEnabled, INLINE_FORMAT_TOOLBAR_CHANGED_EVENT } from "../../src/features/inline-format-toolbar/index.ts";

afterEach(() => {
  vi.useRealTimers();
  setInlineFormatToolbarEnabled(true);
  document.body.innerHTML = "";
});

function setupView(md: string) {
  const doc = parse(md);
  const state = EditorState.create({ schema, doc, plugins: [inlineFormatToolbarPlugin()] });
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const view = new EditorView(mount, { state });
  return { view, doc, mount };
}

function selectAll(view: EditorView) {
  const { doc } = view.state;
  const from = doc.resolve(1).start(1);
  const to = doc.resolve(1).end(1);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, from, to)));
  view.focus();
}

function visibleToolbar(): HTMLElement | null {
  return document.querySelector(".fmt-toolbar");
}

describe("inline-format-toolbar runtime toggle", () => {
  test("toolbar never shows after the show delay when disabled", () => {
    vi.useFakeTimers();
    setInlineFormatToolbarEnabled(false);
    const { view } = setupView("hello world");
    selectAll(view);
    view.dispatch(view.state.tr);
    vi.advanceTimersByTime(1000);
    expect(visibleToolbar()).toBeNull();
    view.destroy();
  });

  test("toolbar shows when enabled (after show delay)", () => {
    vi.useFakeTimers();
    setInlineFormatToolbarEnabled(true);
    const { view } = setupView("hello world");
    selectAll(view);
    view.dispatch(view.state.tr);
    vi.advanceTimersByTime(600);
    expect(visibleToolbar()).not.toBeNull();
    view.destroy();
  });

  test("dispatch event with detail hides an already-visible toolbar immediately", () => {
    vi.useFakeTimers();
    setInlineFormatToolbarEnabled(true);
    const { view } = setupView("hello world");
    selectAll(view);
    view.dispatch(view.state.tr);
    vi.advanceTimersByTime(600);
    expect(visibleToolbar()).not.toBeNull();

    window.dispatchEvent(new CustomEvent(INLINE_FORMAT_TOOLBAR_CHANGED_EVENT, { detail: { enabled: false } }));
    expect(visibleToolbar()).toBeNull();
    view.destroy();
  });

  test("dispatch event with detail re-enables the toolbar after being disabled", () => {
    vi.useFakeTimers();
    setInlineFormatToolbarEnabled(false);
    const { view } = setupView("hello world");
    selectAll(view);
    view.dispatch(view.state.tr);
    vi.advanceTimersByTime(600);
    expect(visibleToolbar()).toBeNull();

    window.dispatchEvent(new CustomEvent(INLINE_FORMAT_TOOLBAR_CHANGED_EVENT, { detail: { enabled: true } }));
    vi.advanceTimersByTime(600);
    expect(visibleToolbar()).not.toBeNull();
    view.destroy();
  });

  test("toolbar is suppressed when the selection is inside an inline-math mark", () => {
    vi.useFakeTimers();
    setInlineFormatToolbarEnabled(true);
    const { view } = setupView("$x$ ");
    const { doc } = view.state;
    // 段落内容位置：`$`(1) `x`(2) `$`(3) ` `(4)；选区只覆盖 latex 内容 `x`。
    const latexNode = doc.nodeAt(2);
    expect(latexNode?.marks.some((m) => m.type.name === "inline_math")).toBe(true);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, 2, 3)));
    view.focus();
    view.dispatch(view.state.tr);
    vi.advanceTimersByTime(600);
    expect(visibleToolbar()).toBeNull();
    view.destroy();
  });
});
