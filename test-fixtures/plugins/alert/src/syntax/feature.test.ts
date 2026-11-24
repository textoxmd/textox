import { describe, expect, it } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import type { DecorationSet } from "prosemirror-view";

import { alertSyntaxFeature } from "./feature";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    blockquote: {
      group: "block",
      content: "block+",
      defining: true,
      parseDOM: [{ tag: "blockquote" }],
      toDOM: () => ["blockquote", 0],
    },
    text: { group: "inline" },
  },
  marks: {},
});

function alertDoc(text: string) {
  const para = schema.node("paragraph", null, text ? schema.text(text) : undefined);
  return schema.node("doc", null, [schema.node("blockquote", null, [para])]);
}

function decorationsAt(text: string, cursor: number): DecorationSet {
  const doc = alertDoc(text);
  const plugin = alertSyntaxFeature.plugins!(schema)[0]!;
  const state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, cursor),
  });
  const resolve = plugin.props.decorations as (state: EditorState) => DecorationSet;
  return resolve(state);
}

describe("alertSyntaxFeature", () => {
  it("contributes the md-it splitter and one PM plugin", () => {
    expect(alertSyntaxFeature.name).toBe("alert");
    expect(alertSyntaxFeature.mdItPlugins).toHaveLength(1);
    expect(alertSyntaxFeature.plugins!(schema)).toHaveLength(1);
  });

  it("declares no inline derive", () => {
    expect(alertSyntaxFeature.inline?.derive).toBeUndefined();
    expect(alertSyntaxFeature.inline?.markNames).toEqual([]);
  });

  it("keeps [!TYPE] unescaped at the start of a paragraph", () => {
    const para = schema.node("paragraph", null, schema.text("[!NOTE] Hello"));
    expect(alertSyntaxFeature.inline!.extRanges(para)).toEqual([[0, 7]]);
  });

  it("does not touch other paragraphs", () => {
    const para = schema.node("paragraph", null, schema.text("plain"));
    expect(alertSyntaxFeature.inline!.extRanges(para)).toEqual([]);
  });

  it("wires the decoration callback to the doc and cursor position", () => {
    // 光标在标记区间 [2,9] 外（10 为标记后的正文内合法 inline 位置）→ node + inline + widget 三个装饰
    expect(decorationsAt("[!NOTE] Hello", 10).find()).toHaveLength(3);
    // 光标在标记内 → 仅 node 装饰
    expect(decorationsAt("[!NOTE] Hello", 3).find()).toHaveLength(1);
    // 普通引用块 → 空
    expect(decorationsAt("Just a quote", 2).find()).toHaveLength(0);
  });
});
