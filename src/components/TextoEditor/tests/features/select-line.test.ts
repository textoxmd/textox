import { describe, expect, test } from "vitest";
import { TextSelection } from "prosemirror-state";
import { createState } from "../../src/editor.ts";
import { fakeView } from "../../specs/sim.ts";
import { feedKey } from "../../specs/events.ts";
import { parse } from "../../src/parser.ts";

describe("selectLine shortcut", () => {
  test("Mod-l selects entire paragraph content", () => {
    const doc = parse("hello world");
    let state = createState(doc);
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, 3, 3)));
    const view = fakeView(state);
    feedKey(view, "<Mod-l>");
    const sel = view.state.selection;
    expect(view.state.doc.textBetween(sel.from, sel.to)).toBe("hello world");
  });

  test("Mod-l replaces existing selection with line selection", () => {
    const doc = parse("hello world");
    let state = createState(doc);
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, 1, 4)));
    const view = fakeView(state);
    feedKey(view, "<Mod-l>");
    const sel = view.state.selection;
    expect(view.state.doc.textBetween(sel.from, sel.to)).toBe("hello world");
  });

  test("Mod-l does not select across blocks", () => {
    const doc = parse("first\n\nsecond");
    let state = createState(doc);
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, 8, 8)));
    const view = fakeView(state);
    feedKey(view, "<Mod-l>");
    const sel = view.state.selection;
    expect(view.state.doc.textBetween(sel.from, sel.to)).toBe("second");
  });
});
