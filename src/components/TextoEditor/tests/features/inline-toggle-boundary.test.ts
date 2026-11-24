import { describe, expect, test } from "vitest";
import { TextSelection } from "prosemirror-state";

import { createState } from "../../src/editor.ts";
import { parse } from "../../src/parser.ts";
import { fakeView } from "../../specs/sim.ts";
import { serialize } from "../../src/serializer.ts";
import { toggleInlineDelim } from "../../src/features/inline-toggle.ts";

function run(md: string, pos: number): string {
  const doc = parse(md);
  let state = createState(doc);
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, pos, pos)));
  const view = fakeView(state);
  toggleInlineDelim(view, "**");
  return serialize(view.state.doc);
}

describe("empty-selection cancel at mark boundaries", () => {
  test("cursor right after open ** (pos 3) cancels", () => {
    expect(run("**bold**", 3)).toBe("bold");
  });
  test("cursor right before close ** (pos 7) cancels", () => {
    expect(run("**bold**", 7)).toBe("bold");
  });
  test("cursor in middle (pos 5) cancels", () => {
    expect(run("**bold**", 5)).toBe("bold");
  });
  test("cursor inside close ** (pos 8) cancels", () => {
    expect(run("**bold**", 8)).toBe("bold");
  });
  test("cursor in plain text no-op", () => {
    expect(run("hello", 3)).toBe("hello");
  });
});
