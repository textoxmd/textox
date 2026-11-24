import { beforeAll, describe, expect, test } from "vitest";
import { TextSelection } from "prosemirror-state";

import { runFeatureCases } from "../utils.ts";
import { createState } from "../../src/editor.ts";
import { fakeView } from "../../specs/sim.ts";
import { feedKey } from "../../specs/events.ts";
import { pretty } from "../../specs/pretty.ts";
import { parse } from "../../src/parser.ts";
import { getSchema } from "../../src/schema.ts";

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});
import { emphasisSpecs } from "../../specs/features/emphasis.specs.ts";

runFeatureCases(emphasisSpecs);

describe("bold shortcut", () => {
  test("Mod-b applies bold to selection", () => {
    const doc = parse("hello world");
    let state = createState(doc);
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, 1, 6)));
    const view = fakeView(state);
    feedKey(view, "<Mod-b>");
    expect(pretty(view.state)).toBe("[<b>hello</b>] world");
  });

  test("Mod-b toggles bold off", () => {
    const doc = parse("hello world");
    let state = createState(doc);
    // First insert ** around "hello" to set up bold state
    state = state.apply(state.tr.replaceWith(1, 6, schema.text("**hello**")));
    // Select "hello" (inside the ** delimiters)
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3, 8)));
    const view = fakeView(state);
    feedKey(view, "<Mod-b>");
    expect(pretty(view.state)).toBe("[hello] world");
  });
});
