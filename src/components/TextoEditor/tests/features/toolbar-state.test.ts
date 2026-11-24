import { beforeAll, describe, expect, test } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { createState } from "../../src/editor.ts";
import { parse } from "../../src/parser.ts";
import { getSchema } from "../../src/schema.ts";

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});
import {
  computeToolbarState,
  createToolbarStatePlugin,
  type ToolbarActiveState,
} from "../../src/features/toolbar-state.ts";

function emptyState(): ToolbarActiveState {
  return {
    headingLevel: null,
    bold: false,
    italic: false,
    strikethrough: false,
    inlineCode: false,
    marks: [],
    blockquote: false,
    codeBlock: false,
    bulletList: false,
    orderedList: false,
    taskList: false,
    blockInsertDisabled: false,
  };
}

function stateAt(md: string, pos: number) {
  const doc = parse(md);
  let state = createState(doc);
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, pos, pos)));
  return state;
}

// Boot a real EditorView (happy-dom) with the toolbar state plugin so PM
// instantiates its view()/update() callbacks. Kept minimal: no defaultPlugins.
function setupView(md: string) {
  const controller = createToolbarStatePlugin();
  const doc = parse(md);
  const state = EditorState.create({ schema, doc, plugins: [controller.plugin] });
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const view = new EditorView(mount, { state });
  return { view, controller, mount };
}

// Select the whole paragraph and apply the strong mark via a dispatched
// transaction, driving the plugin's view.update path.
function makeBold(view: EditorView) {
  const { doc } = view.state;
  const from = doc.resolve(1).start(1);
  const to = doc.resolve(1).end(1);
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(doc, from, to))
      .addMark(from, to, schema.marks.strong.create()),
  );
}

describe("computeToolbarState", () => {
  test("plain paragraph: no format active", () => {
    const s = stateAt("hello", 3);
    expect(computeToolbarState(s)).toEqual({
      ...emptyState(),
      blockInsertDisabled: true,
    });
  });

  test("heading sets headingLevel", () => {
    const s = stateAt("# title", 4);
    expect(computeToolbarState(s)).toEqual({
      ...emptyState(),
      headingLevel: 1,
      blockInsertDisabled: true,
    });
  });

  test("bullet list sets bulletList", () => {
    const s = stateAt("- item", 4);
    expect(computeToolbarState(s)).toEqual({
      ...emptyState(),
      bulletList: true,
      blockInsertDisabled: true,
    });
  });

  test("ordered list sets orderedList", () => {
    const s = stateAt("1. item", 4);
    expect(computeToolbarState(s)).toEqual({
      ...emptyState(),
      orderedList: true,
      blockInsertDisabled: true,
    });
  });

  test("task list sets taskList", () => {
    const s = stateAt("- [ ] task", 7);
    expect(computeToolbarState(s)).toEqual({
      ...emptyState(),
      bulletList: true,
      taskList: true,
      blockInsertDisabled: true,
    });
  });

  test("blockquote sets blockquote", () => {
    const s = stateAt("> quote", 4);
    expect(computeToolbarState(s)).toEqual({
      ...emptyState(),
      blockquote: true,
      blockInsertDisabled: true,
    });
  });

  test("code block sets codeBlock", () => {
    const s = stateAt("```\ncode\n```", 3);
    expect(computeToolbarState(s)).toEqual({
      ...emptyState(),
      codeBlock: true,
      blockInsertDisabled: true,
    });
  });

  test("bold text sets bold via marks", () => {
    const s = stateAt("**bold**", 5);
    expect(computeToolbarState(s)).toEqual({
      ...emptyState(),
      bold: true,
      marks: ["strong"],
      blockInsertDisabled: true,
    });
  });

  test("italic text sets italic via marks", () => {
    const s = stateAt("*text*", 4);
    expect(computeToolbarState(s)).toEqual({
      ...emptyState(),
      italic: true,
      marks: ["em"],
      blockInsertDisabled: true,
    });
  });

  test("strikethrough text sets strikethrough via marks", () => {
    const s = stateAt("~~gone~~", 5);
    expect(computeToolbarState(s)).toEqual({
      ...emptyState(),
      strikethrough: true,
      marks: ["strike"],
      blockInsertDisabled: true,
    });
  });

  test("empty top-level paragraph: blockInsertDisabled false", () => {
    const s = stateAt("", 1);
    expect(computeToolbarState(s).blockInsertDisabled).toBe(false);
  });

  test("non-empty paragraph: blockInsertDisabled true", () => {
    const s = stateAt("hello", 3);
    expect(computeToolbarState(s).blockInsertDisabled).toBe(true);
  });

  test("list item: blockInsertDisabled true", () => {
    const s = stateAt("- item", 4);
    expect(computeToolbarState(s).blockInsertDisabled).toBe(true);
  });

  test("text selection: blockInsertDisabled true", () => {
    const doc = parse("hello");
    let state = createState(doc);
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, 1, 4)));
    expect(computeToolbarState(state).blockInsertDisabled).toBe(true);
  });
});

describe("createToolbarStatePlugin", () => {
  test("subscribe immediately replays the latest computed state", () => {
    const { view, controller, mount } = setupView("hello");
    const seen: ToolbarActiveState[] = [];
    const unsub = controller.subscribe((s) => seen.push(s));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ ...emptyState(), blockInsertDisabled: true });
    unsub();
    view.destroy();
    mount.remove();
  });

  test("subscribe replays a non-empty latest state", () => {
    const { view, controller, mount } = setupView("# title");
    const seen: ToolbarActiveState[] = [];
    const unsub = controller.subscribe((s) => seen.push(s));
    expect(seen[0]).toEqual({
      ...emptyState(),
      headingLevel: 1,
      blockInsertDisabled: true,
    });
    unsub();
    view.destroy();
    mount.remove();
  });

  test("dispatch triggers update notification with new state", () => {
    const { view, controller, mount } = setupView("hello");
    const seen: ToolbarActiveState[] = [];
    const unsub = controller.subscribe((s) => seen.push(s));
    seen.length = 0;

    makeBold(view);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      ...emptyState(),
      bold: true,
      marks: ["strong"],
      blockInsertDisabled: true,
    });
    unsub();
    view.destroy();
    mount.remove();
  });

  test("unsubscribe stops further notifications", () => {
    const { view, controller, mount } = setupView("hello");
    const seen: ToolbarActiveState[] = [];
    const unsub = controller.subscribe((s) => seen.push(s));
    seen.length = 0;
    unsub();

    makeBold(view);

    expect(seen).toHaveLength(0);
    view.destroy();
    mount.remove();
  });

  test("unsubscribe is idempotent and other listeners keep receiving", () => {
    const { view, controller, mount } = setupView("hello");
    const a: ToolbarActiveState[] = [];
    const b: ToolbarActiveState[] = [];
    const unsubA = controller.subscribe((s) => a.push(s));
    controller.subscribe((s) => b.push(s));
    a.length = 0;
    b.length = 0;

    unsubA();
    unsubA();
    makeBold(view);

    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
    expect(b[0]).toEqual({ ...emptyState(), bold: true, marks: ["strong"], blockInsertDisabled: true });
    view.destroy();
    mount.remove();
  });
});
