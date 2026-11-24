import { describe, expect, test } from "vitest";
import type { Node as PMNode } from "prosemirror-model";

import { parse } from "../src/parser.ts";
import {
  parseWithSource,
  serializePreserving,
} from "../src/source-preserve.ts";

function preserve(O: string, edited: PMNode): string {
  const ctx = parseWithSource(O);
  expect(ctx.supported).toBe(true);
  const P = serializePreserving(ctx, edited);
  expect(P).not.toBeNull();
  return P!;
}

describe("source-preserve: verbatim 顶层节点（脚注定义）", () => {
  test("未编辑定义：原地逐字保留（含正文编辑）", () => {
    const O = "Body with footnote[^1].\n\n[^1]: the footnote text\n\nafter\n";
    const edited = parse(O.replace("footnote[^1]", "footnote AGAIN[^1]"));
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe(O.replace("footnote[^1]", "footnote AGAIN[^1]"));
  });

  test("编辑定义正文：写回新内容", () => {
    const O = "Body[^1].\n\n[^1]: original def\n";
    const edited = parse("Body[^1].\n\n[^1]: CHANGED def\n");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toContain("[^1]: CHANGED def");
    expect(P).not.toContain("original def");
  });

  test("新增定义：追加到文末且不丢失", () => {
    const O = "Body[^1].\n\n[^1]: original def\n";
    const edited = parse("Body[^1][^2].\n\n[^1]: original def\n\n[^2]: brand new\n");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toContain("[^2]: brand new");
  });

  test("删除定义：移除对应原文行", () => {
    const O = "Body[^1].\n\n[^1]: gone def\n";
    const edited = parse("Body[^1].\n");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).not.toContain("[^1]: gone def");
  });

  test("定义写在引用之前：未编辑时原位保留", () => {
    const O = "[^1]: def first\n\nBody with note[^1].\n";
    const edited = parse(O.replace("Body", "BODY"));
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("[^1]: def first\n\nBODY with note[^1].\n");
  });

  test("多段定义未编辑：逐字保留", () => {
    const O = "Body[^1].\n\n[^1]: first para\n\n    second para\n\nbody\n";
    const edited = parse(O.replace("body", "BODY"));
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("Body[^1].\n\n[^1]: first para\n\n    second para\n\nBODY\n");
  });

  test("首个定义新增：原文无任何定义时追加到文末", () => {
    const O = "Body[^1].\n";
    const edited = parse("Body[^1].\n\n[^1]: brand new\n");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("Body[^1].\n\n[^1]: brand new\n");
  });

  test("非文末定义编辑：保留分隔空行与后续块", () => {
    const O = "A[^1]\n\n[^1]: d1\n\nB\n";
    const edited = parse("A[^1]\n\n[^1]: D1\n\nB\n");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("A[^1]\n\n[^1]: D1\n\nB\n");
  });

  test("CRLF 非文末定义编辑：往返一致且 EOL 保持", () => {
    const O = "A[^1]\r\n\r\n[^1]: d1\r\n\r\nB\r\n";
    const edited = parse("A[^1]\r\n\r\n[^1]: D1\r\n\r\nB\r\n");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("A[^1]\r\n\r\n[^1]: D1\r\n\r\nB\r\n");
  });

  test("空定义写回：给空脚注定义补内容", () => {
    const O = "Text[^1]\n\n[^1]: \n\nMore\n";
    const edited = parse("Text[^1]\n\n[^1]: filled\n\nMore\n");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("Text[^1]\n\n[^1]: filled\n\nMore\n");
  });

  test("CRLF 多行定义编辑：内部与尾随 EOL 全为 CRLF", () => {
    const O = "Body[^1].\r\n\r\n[^1]: line one\r\n    line two\r\n";
    const edited = parse("Body[^1].\r\n\r\n[^1]: line ONE\r\n    line two\r\n");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("Body[^1].\r\n\r\n[^1]: line ONE\r\nline two\r\n");
  });

  test("删除非文末定义：收敛两侧空行，仅留一个空行", () => {
    const O = "A[^1]\n\n[^1]: d1\n\nB\n";
    const edited = parse("A[^1]\n\nB\n");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    // 无定义后 [^1] 不再是脚注引用；文本块原样写回（canonical 不再转义方括号）。
    expect(P).toBe("A[^1]\n\nB\n");
  });

  test("无尾随换行追加定义：与前块之间恰好一个空行", () => {
    const O = "Body[^1].";
    const edited = parse("Body[^1].\n\n[^1]: brand new\n");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("Body[^1].\n\n[^1]: brand new\n");
  });

  test("源文以空行结尾时追加定义：恰好一个空行", () => {
    const O = "A[^1].\n\n";
    const edited = parse("A[^1].\n\n[^1]: new\n");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("A[^1].\n\n[^1]: new\n");
  });

  test("CRLF 源文以空行结尾时追加定义：恰好一个空行", () => {
    const O = "A[^1].\r\n\r\n";
    const edited = parse("A[^1].\r\n\r\n[^1]: new\r\n");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("A[^1].\r\n\r\n[^1]: new\r\n");
  });
});
