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

/** 某个文本节点上指定 mark 的 attrs；没有该 mark 返回 null。 */
function attrsFor(doc: PMNode, text: string, markName: string): Record<string, unknown> | null {
  const matches: Array<Record<string, unknown> | null> = [];
  doc.descendants((n) => {
    if (n.isText && n.text === text) {
      const mark = n.marks.find((m) => m.type.name === markName);
      matches.push(mark ? { ...mark.attrs } : null);
    }
    return true;
  });
  expect(matches, `text node count for ${JSON.stringify(text)}`).toHaveLength(1);
  return matches[0]!;
}

describe("inline math 由 math_inline token 派生", () => {
  test("$x$ 是公式", () => {
    const { doc, out } = live("$x$");
    expect(marksFor(doc, "x")).toEqual(["inline_math"]);
    expect(attrsFor(doc, "x", "inline_math")).toEqual({ latex: "x" });
    expect(out).toBe("$x$");
  });

  test("$a b$ 保留内部空格", () => {
    const { doc } = live("$a b$");
    expect(attrsFor(doc, "a b", "inline_math")).toEqual({ latex: "a b" });
  });

  test("\\(y\\) 仍是公式（brackets 模式）", () => {
    const { doc, out } = live("\\(y\\)");
    expect(attrsFor(doc, "y", "inline_math")).toEqual({ latex: "y" });
    expect(out).toBe("\\(y\\)");
  });

  test("\\( y \\) 的 latex 被 trim，空格留在文本里", () => {
    const { doc, out } = live("\\( y \\)");
    expect(attrsFor(doc, "y", "inline_math")).toEqual({ latex: "y" });
    expect(out).toBe("\\( y \\)");
  });

  test("$ 首尾带空格的写法不再是公式（已知行为变化）", () => {
    const { doc, out } = live("$ x $");
    expect(marksFor(doc, "$ x $")).toEqual([]);
    expect(out).toBe("$ x $");
  });

  test("行内 $$x$$ 保持纯文本", () => {
    const { doc, out } = live("a $$x$$ b");
    expect(marksFor(doc, "a $$x$$ b")).toEqual([]);
    expect(out).toBe("a $$x$$ b");
  });

  test("可与 emphasis / link 嵌套，代码与转义优先", () => {
    const em = live("*$x$*");
    expect(marksFor(em.doc, "x")).toEqual(["em", "inline_math"]);
    expect(em.out).toBe("*$x$*");

    const link = live("[a$b$](u)");
    expect(marksFor(link.doc, "b")).toEqual(["inline_math", "link"]);
    expect(link.out).toBe("[a$b$](u)");

    expect(marksFor(live("`$x$`").doc, "$x$")).toEqual(["code"]);
    expect(marksFor(live("\\$x\\$").doc, "\\$x\\$")).toEqual([]);
  });

  test("$a==b==$ 仍是公式（texmath 在 md-it 层先整段认领）", () => {
    const { doc } = live("$a==b==$");
    expect(attrsFor(doc, "a==b==", "inline_math")).toEqual({ latex: "a==b==" });
  });

  test("与数字相邻不成立（texmath 的 pre/post 守卫）", () => {
    for (const src of ["$x$2", "1$x$"]) {
      const { doc, out } = live(src);
      expect(marksFor(doc, src)).toEqual([]);
      expect(out).toBe(src);
    }
    // 字母相邻则照常成立
    expect(attrsFor(live("a$x$").doc, "x", "inline_math")).toEqual({ latex: "x" });
    expect(attrsFor(live("$x$a").doc, "x", "inline_math")).toEqual({ latex: "x" });
    // brackets 没有数字守卫，`1\(x\)` 仍是公式（与 `$` 侧不对称）
    expect(attrsFor(live("1\\(x\\)").doc, "x", "inline_math")).toEqual({ latex: "x" });
  });

  test("空白 brackets 公式不会让后续 span 漂移", () => {
    const { doc, out } = live("\\( \\) **x**");
    expect(out).toBe("\\( \\) **x**");
    expect(marksFor(doc, "x")).toEqual(["strong"]);

    const tab = live("\\(\t\\) **x**");
    expect(tab.out).toBe("\\(\t\\) **x**");
    expect(marksFor(tab.doc, "x")).toEqual(["strong"]);
    // 空白公式不得留下 inline_math mark（否则空格/制表符会被当成公式内容）。
    const marked: string[] = [];
    tab.doc.descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type.name === "inline_math")) marked.push(n.text!);
      return true;
    });
    expect(marked).toEqual([]);
  });

  test("加载期源码组装认领 $x$ 与 \\(y\\)", () => {
    for (const src of ["$x$", "\\(y\\)", "text $x$ text"]) {
      expect(parseInlineTokens(src).some((t) => t.type === "math_inline")).toBe(true);
      expect(assembleLoadText(parseInlineTokens(src), src)).toBe(src);
    }
  });
});
