import { beforeAll, describe, expect, test } from "vitest";
import { TextSelection } from "prosemirror-state";

import { createState } from "../../src/editor.ts";
import { parse } from "../../src/parser.ts";
import { getSchema } from "../../src/schema.ts";

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});
import {
  canInsertBlockAt,
} from "../../src/features/block-insert.ts";

function stateAt(md: string, pos: number) {
  const doc = parse(md);
  let state = createState(doc);
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, pos, pos)));
  return state;
}

function rangeState(md: string, from: number, to: number) {
  const doc = parse(md);
  let state = createState(doc);
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, from, to)));
  return state;
}

// markdown 解析会折叠连续空行，中间空段落需手动构造：
// doc(paragraph("a"), paragraph(), paragraph("b"))，空段落内容位置 = 4。
function stateInMiddleEmptyPara() {
  const para = schema.nodes.paragraph!;
  const doc = schema.nodes.doc!.create(null, [
    para.create(null, schema.text("a")),
    para.create(),
    para.create(null, schema.text("b")),
  ]);
  let state = createState(doc);
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, 4, 4)));
  return state;
}

describe("canInsertBlockAt", () => {
  test("empty doc cursor at end is insertable", () => {
    expect(canInsertBlockAt(stateAt("", 1))).toBe(true);
  });

  test("empty paragraph among content is insertable", () => {
    expect(canInsertBlockAt(stateInMiddleEmptyPara())).toBe(true);
  });

  test("non-empty top-level paragraph is not insertable", () => {
    expect(canInsertBlockAt(stateAt("hello", 3))).toBe(false);
  });

  test("text selection (range) is not insertable", () => {
    expect(canInsertBlockAt(rangeState("hello", 1, 4))).toBe(false);
  });

  test("inside list item is not insertable", () => {
    expect(canInsertBlockAt(stateAt("- item", 4))).toBe(false);
  });

  test("inside blockquote is not insertable", () => {
    expect(canInsertBlockAt(stateAt("> quote", 4))).toBe(false);
  });

  test("inside heading is not insertable", () => {
    expect(canInsertBlockAt(stateAt("# title", 4))).toBe(false);
  });
});
