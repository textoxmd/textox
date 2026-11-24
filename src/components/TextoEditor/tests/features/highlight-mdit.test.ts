import { describe, expect, test } from "vitest";
import type { Node as PMNode } from "prosemirror-model";

import { createState } from "../../src/editor.ts";
import { parse, parseInlineTokens } from "../../src/parser.ts";
import { serialize } from "../../src/serializer.ts";
import { assembleLoadText } from "../../src/features/load-assemble.ts";

/** 解析 + 跑一次事务（让 normalize 对齐 mark），返回文档与序列化结果。 */
function live(md: string): { doc: PMNode; out: string } {
  const base = createState(parse(md));
  const state = base.apply(base.tr);
  return { doc: state.doc, out: serialize(state.doc) };
}

/** 某个文本节点上的 mark 名（排序后）；找不到该文本节点即报错（与「无 mark」区分）。 */
function marksFor(doc: PMNode, text: string): string[] {
  let found: string[] | null = null;
  doc.descendants((n) => {
    if (n.isText && n.text === text) found = n.marks.map((m) => m.type.name).sort();
    return true;
  });
  if (found === null) throw new Error(`text node not found: ${JSON.stringify(text)}`);
  return found;
}

describe("highlight 由 markdown-it-mark 派生", () => {
  test("==a=b== 生效（旧扫描器禁止内容含 =）", () => {
    const { doc, out } = live("==a=b==");
    expect(marksFor(doc, "a=b")).toEqual(["highlight"]);
    expect(out).toBe("==a=b==");
  });

  test("与 strong 双向嵌套", () => {
    const outer = live("==**b**==");
    expect(outer.out).toBe("==**b**==");
    expect(marksFor(outer.doc, "b")).toEqual(["highlight", "strong"]);

    const inner = live("**==b==**");
    expect(inner.out).toBe("**==b==**");
    expect(marksFor(inner.doc, "b")).toEqual(["highlight", "strong"]);
  });

  test("链接文字内生效", () => {
    const { doc, out } = live("[==x==](u)");
    expect(marksFor(doc, "x")).toEqual(["highlight", "link"]);
    expect(out).toBe("[==x==](u)");
  });

  test("奇数 run：===x=== → = + ==x== + =", () => {
    const { doc, out } = live("===x===");
    expect(marksFor(doc, "x")).toEqual(["highlight"]);
    expect(out).toBe("===x===");
  });

  test("未配对保持字面", () => {
    const { doc, out } = live("==x");
    expect(marksFor(doc, "==x")).toEqual([]);
    expect(out).toBe("==x");
  });

  test("同段两个高亮各自独立", () => {
    const { doc, out } = live("==a== ==b==");
    expect(marksFor(doc, "a")).toEqual(["highlight"]);
    expect(marksFor(doc, "b")).toEqual(["highlight"]);
    expect(out).toBe("==a== ==b==");
  });

  test("加载期源码组装认领 ==（不依赖回退路径）", () => {
    const src = "==a=b==";
    // 前提：规则确实生效，产出 mark_*；否则 assembleLoadText 会走 text 快路径而恒真。
    expect(parseInlineTokens(src).some((t) => t.type === "mark_open")).toBe(true);
    expect(assembleLoadText(parseInlineTokens(src), src)).toBe(src);
  });

  test("反斜杠转义保持字面（编辑器覆写的 escape 规则）", () => {
    // 实测 doc：单个文本节点 `\==x==`，无任何 mark（反斜杠留在文档文本里，
    // 序列化器的 escape 是恒等函数）。
    const { doc, out } = live("\\==x==");
    expect(marksFor(doc, "\\==x==")).toEqual([]);
    expect(out).toBe("\\==x==");
  });

  test("$a==b==$ 仍按数学处理（texmath 在 markdown-it 层整段认领）", () => {
    const { doc, out } = live("$a==b==$");
    expect(marksFor(doc, "a==b==")).toEqual(["inline_math"]);
    expect(out).toBe("$a==b==$");
  });
});
