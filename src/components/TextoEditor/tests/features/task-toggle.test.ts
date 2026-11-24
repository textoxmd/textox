import { describe, expect, test } from "vitest";
import { TextSelection } from "prosemirror-state";

import { createState } from "../../src/editor.ts";
import { fakeView } from "../../specs/sim.ts";
import { pretty } from "../../specs/pretty.ts";
import { parse } from "../../src/parser.ts";
import { toggleTaskList } from "../../src/features/task.ts";

// Directly invoke the toolbar's toggleTaskList command (the same command
// EditorToolbar's task button and TextoEditorRef.toggleTaskList run) and
// pretty-print the resulting state.
function toggle(md: string, pos?: number): string {
  const doc = parse(md);
  let state = createState(doc);
  const p = pos ?? doc.content.size - 1;
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, p, p)));
  const view = fakeView(state);
  toggleTaskList()(view.state, view.dispatch, undefined);
  return pretty(view.state);
}

describe("toggleTaskList", () => {
  test("wraps the current paragraph into a task item, preserving text", () => {
    expect(toggle("hello world")).toBe("<ul><li><checkbox/>|hello world</li></ul>");
  });

  test("wraps an empty paragraph into an empty task item", () => {
    expect(toggle("")).toBe("<ul><li><checkbox/>|</li></ul>");
  });

  test("cursor mid-line still keeps the line content intact", () => {
    // Cursor between "hel" and "lo".
    expect(toggle("hello", 4)).toBe("<ul><li><checkbox/>|hello</li></ul>");
  });

  test("removes marker when already inside task item", () => {
    expect(toggle("- [ ] hi", 6)).toBe("<ul><li>hi|</li></ul>");
  });

  test("does not remove marker when cursor is in a tail paragraph of a task item", () => {
    // loose list：li 首段（含 marker）之后有独立 tail 段落；光标在其中不应动 marker。
    expect(toggle("- [ ] a\n\n  tail", 10)).toBe("<ul><li><checkbox/>a<li-tail>tai|l</li-tail></li></ul>");
  });

  test("does nothing when cursor is already inside a list item", () => {
    expect(toggle("- bullet", 8)).toBe("<ul><li>bulle|t</li></ul>");
  });

  test("does nothing on a heading", () => {
    expect(toggle("# title")).toBe("<h1><h-label>H1</h-label>title|</h1>");
  });
});
