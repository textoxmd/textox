import { describe, expect, it } from "vitest";
import { Schema } from "prosemirror-model";

import { buildAlertDecorations, createAlertLabel } from "./decoration";

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

function blockquoteWith(text: string) {
  const para = schema.node("paragraph", null, text ? schema.text(text) : undefined);
  return schema.node("doc", null, [schema.node("blockquote", null, [para])]);
}

// prosemirror-view 未公开 attrs 访问，测试经内部字段 `type` 断言（仓库既有惯例）。
type DecoType = { attrs?: { class?: string }; toDOM?: unknown };

function decoType(d: { from: number; to: number }): DecoType {
  return (d as unknown as { type: DecoType }).type;
}

describe("createAlertLabel", () => {
  it("renders the human label for a known type", () => {
    const el = createAlertLabel("warning");
    expect(el.className).toBe("alert-label");
    expect(el.contentEditable).toBe("false");
    expect(el.textContent).toBe("Warning");
  });

  it("falls back to the raw type for an unknown label", () => {
    expect(createAlertLabel("unknown").textContent).toBe("unknown");
  });
});

describe("buildAlertDecorations", () => {
  it("tags the alert blockquote, hides the marker and prepends the label widget", () => {
    const decos = buildAlertDecorations(blockquoteWith("[!NOTE] Hello"), 0);
    expect(decos).toHaveLength(3);
    // 位置契约：node = 整个 blockquote(0..17)、inline = 仅标记(2..9)、widget 在标记起点(2..2)。
    expect([decos[0]!.from, decos[0]!.to]).toEqual([0, 17]);
    expect([decos[1]!.from, decos[1]!.to]).toEqual([2, 9]);
    expect([decos[2]!.from, decos[2]!.to]).toEqual([2, 2]);
    expect(decos.map((d) => decoType(d).attrs?.class)).toEqual([
      "alert alert-note",
      "syntax-hidden",
      undefined,
    ]);
    expect(decoType(decos[2]!).toDOM).toBeInstanceOf(HTMLElement);
  });

  it("hides the marker only when the cursor is outside the marker range [2, 9]", () => {
    // 闭区间：2 与 9 视为在标记内。
    for (const cursor of [2, 3, 9]) {
      expect(
        buildAlertDecorations(blockquoteWith("[!NOTE] Hello"), cursor),
      ).toHaveLength(1);
    }
    for (const cursor of [0, 1, 10]) {
      expect(
        buildAlertDecorations(blockquoteWith("[!NOTE] Hello"), cursor),
      ).toHaveLength(3);
    }
  });

  it("leaves a plain blockquote undecorated", () => {
    expect(buildAlertDecorations(blockquoteWith("Just a quote"), 0)).toHaveLength(0);
  });
});
