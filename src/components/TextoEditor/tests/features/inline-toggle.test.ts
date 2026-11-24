import { describe, expect, test } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";

import { createState } from "../../src/editor.ts";
import { fakeView } from "../../specs/sim.ts";
import { parse } from "../../src/parser.ts";
import { getSchema } from "../../src/schema.ts";
import { serialize } from "../../src/serializer.ts";
import { toggleInlineDelim } from "../../src/features/inline-toggle.ts";

function run(md: string, delim: string, closeDelim: string | undefined, pos?: number): string {
  const doc = parse(md);
  let state = createState(doc);
  const p = pos ?? doc.content.size - 1;
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, p, p)));
  const view = fakeView(state);
  toggleInlineDelim(view, delim, closeDelim);
  return serialize(view.state.doc);
}

describe("toggleInlineDelim", () => {
  test("wraps selected text in the delim", () => {
    const doc = parse("hello");
    let state = createState(doc);
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, 1, 4)));
    const view = fakeView(state);
    toggleInlineDelim(view, "**");
    expect(serialize(view.state.doc)).toBe("**hel**lo");
  });

  test("unwraps a non-empty selection already wrapped in the delim", () => {
    const doc = parse("**bold**");
    let state = createState(doc);
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, 3, 7)));
    const view = fakeView(state);
    toggleInlineDelim(view, "**");
    expect(serialize(view.state.doc)).toBe("bold");
  });

  test("empty selection inside bold removes the delimiters", () => {
    // cursor between "bo" and "ld"
    expect(run("**bold**", "**", undefined, 5)).toBe("bold");
  });

  test("empty selection in plain text is a no-op", () => {
    expect(run("hello", "**", undefined, 3)).toBe("hello");
  });

  test("显式 markName 可包裹非核心分隔符", () => {
    const doc = parse("hello");
    let state = createState(doc);
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, 1, 6)));
    const view = fakeView(state);
    toggleInlineDelim(view, "##", undefined, "highlight");
    expect(view.state.doc.textContent).toBe("##hello##");
  });

  test("显式 markName 可解除非核心分隔符的包裹", () => {
    const schema = getSchema();
    const paragraph = schema.node("paragraph", null, [
      schema.text("##"),
      schema.text("hi", [schema.marks.highlight.create()]),
      schema.text("##"),
    ]);
    const doc = schema.node("doc", null, [paragraph]);
    let state = EditorState.create({ schema, doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, 3, 5)));
    const view = fakeView(state);
    toggleInlineDelim(view, "##", undefined, "highlight");
    expect(view.state.doc.textContent).toBe("hi");
  });

  test("显式 markName + 非对称 closeDelim 可包裹", () => {
    const doc = parse("hello");
    let state = createState(doc);
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, 1, 6)));
    const view = fakeView(state);
    toggleInlineDelim(view, "<u>", "</u>", "underline");
    expect(view.state.doc.textContent).toBe("<u>hello</u>");
  });

  test("显式 markName + 非对称 closeDelim 可解除包裹", () => {
    const schema = getSchema();
    const paragraph = schema.node("paragraph", null, [
      schema.text("<u>"),
      schema.text("under", [schema.marks.underline.create()]),
      schema.text("</u>"),
    ]);
    const doc = schema.node("doc", null, [paragraph]);
    let state = EditorState.create({ schema, doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, 4, 9)));
    const view = fakeView(state);
    toggleInlineDelim(view, "<u>", "</u>", "underline");
    expect(view.state.doc.textContent).toBe("under");
  });
});
