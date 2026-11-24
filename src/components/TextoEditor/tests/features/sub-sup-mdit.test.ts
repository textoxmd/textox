import { describe, expect, test } from "vitest";
import type { Node as PMNode } from "prosemirror-model";

import { createState } from "../../src/editor.ts";
import { parse, parseInlineTokens } from "../../src/parser.ts";
import { serialize } from "../../src/serializer.ts";
import { assembleLoadText } from "../../src/features/load-assemble.ts";

function live(md: string): { doc: PMNode; out: string } {
  const base = createState(parse(md));
  const state = base.apply(base.tr);
  return { doc: state.doc, out: serialize(state.doc) };
}

/** 某个文本节点上的 mark 名（排序后）；同名文本节点恰好 1 个。 */
function marksFor(doc: PMNode, text: string): string[] {
  const matches: string[][] = [];
  doc.descendants((n) => {
    if (n.isText && n.text === text) matches.push(n.marks.map((m) => m.type.name).sort());
    return true;
  });
  expect(matches, `text node count for ${JSON.stringify(text)}`).toHaveLength(1);
  return matches[0]!;
}

/** 文档里出现过的全部 mark 名（含重复）。 */
function allMarkNames(doc: PMNode): string[] {
  const names: string[] = [];
  doc.descendants((n) => {
    if (n.isText) for (const m of n.marks) names.push(m.type.name);
    return true;
  });
  return names;
}

describe("inline sub/sup 由 md-it token 派生", () => {
  test("~x~ 是下标，^x^ 是上标", () => {
    const sub = live("H~2~O");
    expect(marksFor(sub.doc, "2")).toEqual(["sub"]);
    expect(sub.out).toBe("H~2~O");

    const sup = live("E=mc^2^");
    expect(marksFor(sup.doc, "2")).toEqual(["sup"]);
    expect(sup.out).toBe("E=mc^2^");
  });

  test("未转义空白不成立（已知行为变化）", () => {
    const { doc, out } = live("~a b~");
    expect(marksFor(doc, "~a b~")).toEqual([]);
    expect(out).toBe("~a b~");
  });

  test("~~x~~ 仍是删除线，~~~x~~~ 保持形态", () => {
    expect(marksFor(live("~~x~~").doc, "x")).toEqual(["strike"]);

    // `~~~x~~~` 位于段落开头会开围栏代码块，这里必须放在行内上下文：
    // md-it 的 strikethrough 从 3 连 `~` 中取走 `~~`，两侧各留一个 `~`。
    const inline = live("a ~~~x~~~");
    expect(marksFor(inline.doc, "x")).toEqual(["strike"]);
    expect(inline.out).toBe("a ~~~x~~~");
  });

  test("内容压平：~a^b^~ 只有 sub", () => {
    expect(marksFor(live("~a^b^~").doc, "a^b^")).toEqual(["sub"]);
  });

  test("转义内容保真：~a\\ b~ / ~a\\~b~ / ~a\\\\~ / ^a\\^b^", () => {
    const space = live("~a\\ b~");
    expect(space.out).toBe("~a\\ b~");
    expect(marksFor(space.doc, "a\\ b")).toEqual(["sub"]);

    const tilde = live("~a\\~b~");
    expect(tilde.out).toBe("~a\\~b~");
    expect(marksFor(tilde.doc, "a\\~b")).toEqual(["sub"]);

    const slash = live("~a\\\\~");
    expect(slash.out).toBe("~a\\\\~");
    expect(marksFor(slash.doc, "a\\\\")).toEqual(["sub"]);

    const caret = live("^a\\^b^");
    expect(caret.out).toBe("^a\\^b^");
    expect(marksFor(caret.doc, "a\\^b")).toEqual(["sup"]);
  });

  test("与强调 / 链接 / 代码 / escape 的关系", () => {
    expect(marksFor(live("*~x~*").doc, "x")).toEqual(["em", "sub"]);
    expect(marksFor(live("[~x~](u)").doc, "x")).toEqual(["link", "sub"]);
    expect(marksFor(live("`~x~`").doc, "~x~")).toEqual(["code"]);
    expect(marksFor(live("\\~x\\~").doc, "\\~x\\~")).toEqual([]);
  });

  test("^ 在脚注引用的内层收口（加载期空 env 的既有行为）", () => {
    const { doc, out } = live("a^b[^1]c^d\n\n[^1]: note\n");
    expect(marksFor(doc, "b[")).toEqual(["sup"]);
    expect(allMarkNames(doc)).not.toContain("footnote_ref");
    // 未被引用的脚注定义在上游就被丢弃（既有行为，与本迁移无关）。
    expect(out).toBe("a^b[^1]c^d");
  });

  test("加载期源码组装认领 sub / sup", () => {
    for (const src of ["~x~", "^y^", "a ~b~ c"]) {
      expect(parseInlineTokens(src).some((t) => t.type === "sub_open" || t.type === "sup_open")).toBe(true);
      expect(assembleLoadText(parseInlineTokens(src), src)).toBe(src);
    }
  });

  test("strike 与单波浪线的交互（上游 sub 会抢走成对的 ~）", () => {
    // `~~5~10~~`：sub 抢走 strike 的闭合 `~`，整段不再是删除线。
    const single = live("~~5~10~~");
    expect(single.out).toBe("~~5~10~~");
    expect(marksFor(single.doc, "10")).toEqual(["sub"]);

    // `~a~~b~`：两个独立的 sub 文本节点（`a` / `b`），中间的 `~~` 是字面。
    const doubled = live("~a~~b~");
    expect(doubled.out).toBe("~a~~b~");
    expect(marksFor(doubled.doc, "a")).toEqual(["sub"]);
    expect(marksFor(doubled.doc, "b")).toEqual(["sub"]);
  });
});
