import { describe, expect, test } from "vitest";
import { TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { parseInline } from "../../src/inline-parse.ts";
import { parse } from "../../src/parser.ts";
import { createState } from "../../src/editor.ts";
import { serialize } from "../../src/serializer.ts";
import { toggleInlineDelim } from "../../src/features/inline-toggle.ts";

function types(md: string): string[] {
  return parseInline(md).map((s) => s.type);
}

function unwrap(md: string, delim: string, from: number, to: number): string {
  const doc = parse(md);
  let state = createState(doc);
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const view = new EditorView(mount, { state });
  try {
    toggleInlineDelim(view, delim);
    return serialize(view.state.doc);
  } finally {
    view.destroy();
    mount.remove();
  }
}

describe("nested inline delims", () => {
  test("==**TEXT**== → highlight + strong", () => {
    expect(types("==**TEXT**==").sort()).toEqual(["highlight", "strong"]);
  });

  test("**==TEXT==** → highlight + strong", () => {
    expect(types("**==TEXT==**").sort()).toEqual(["highlight", "strong"]);
  });

  test("==*TEXT*== → highlight + em", () => {
    expect(types("==*TEXT*==").sort()).toEqual(["em", "highlight"]);
  });

  test("==~~TEXT~~== → highlight + strike", () => {
    expect(types("==~~TEXT~~==").sort()).toEqual(["highlight", "strike"]);
  });

  test("~~**TEXT**~~ → strike + strong", () => {
    expect(types("~~**TEXT**~~").sort()).toEqual(["strike", "strong"]);
  });

  test("**==TEXT==** and ==**TEXT**== render same marks", () => {
    const a = parseInline("**==TEXT==**");
    const b = parseInline("==**TEXT**==");
    expect(a.map((s) => s.type).sort()).toEqual(b.map((s) => s.type).sort());
  });
});

describe("nested unwrap via toggle", () => {
  test("==**TEXT**== click Bold on inner text unwraps regardless of boundary drift", () => {
    // Selecting into the hidden outer `=` (from=2) must still unwrap the
    // inner `**TEXT**` — the run is located at the visible start, not the
    // raw cursor position.
    expect(unwrap("==**TEXT**==", "**", 2, 7)).toBe("==TEXT==");
    expect(unwrap("==**TEXT**==", "**", 3, 7)).toBe("==TEXT==");
    expect(unwrap("==**TEXT**==", "**", 4, 9)).toBe("==TEXT==");
    expect(unwrap("==**TEXT**==", "**", 2, 9)).toBe("==TEXT==");
  });

  test("**==代码显示==** click Bold on inner text unwraps the outer bold", () => {
    expect(unwrap("**==代码显示==**", "**", 5, 9)).toBe("==代码显示==");
    expect(unwrap("**==代码显示==**", "**", 2, 9)).toBe("==代码显示==");
    expect(unwrap("**==代码显示==**", "**", 4, 10)).toBe("==代码显示==");
  });
});
