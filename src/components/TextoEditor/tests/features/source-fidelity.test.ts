import { expect, it } from "vitest";
import type Token from "markdown-it/lib/token.mjs";

import { assembleLoadText } from "../../src/features/load-assemble.ts";
import { parse, parseInlineTokens } from "../../src/parser.ts";
import { serialize } from "../../src/serializer.ts";

// Load path fidelity: opening a file must not rewrite the user's source.
// The textblock text *is* the source, so `serialize(parse(src)) === src` for
// the forms markdown-it would otherwise normalize (angle-bracket destinations,
// single-quoted titles, code-span padding spaces). Reference-style links have
// no inline target in the source, so they still collapse to canonical form.

function roundTrip(src: string): string {
  return serialize(parse(src));
}

it("preserves raw link/image/code forms", () => {
  for (const src of [
    "[t](<u v>)",
    "[t](u 'ti')",
    "[t](u \"ti\")",
    "[t](u)",
    "[a [b] c](u)",
    "[t](foo(and(bar)))",
    "![a](<x y>)",
    "![a](x.png 't')",
    "x ![a *em*](x.png) y",
    "a ` x ` b",
    "a `` b ` c `` d",
    "text [a](<u v>) and [b](x.png 'T') end",
  ]) {
    expect(roundTrip(src), src).toBe(src);
  }
});

it("reference links are still canonicalised", () => {
  // 参考式的目标只存在于别处（定义块被 md-it 消费、不产出 block token），
  // 段落内没有可保留的原文，故仍收敛为行内形式；serialize 本身会把文末
  // 换行收敛为无尾换行。
  expect(roundTrip("[t][r]\n\n[r]: /url\n")).toBe("[t](/url)");
});

it("keeps marks while preserving the raw source", () => {
  const doc = parse("[t](<u v>)");
  const para = doc.firstChild!;
  expect(para.textContent).toBe("[t](<u v>)");
  let hasLink = false;
  para.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === "link")) hasLink = true;
    return true;
  });
  expect(hasLink).toBe(true);
});

it("hard breaks keep their node while the source form is canonical", () => {
  expect(roundTrip("line a  \nline b")).toBe("line a  \nline b");
  // `\` + 换行的硬换行在保存时收敛为两空格形式（既有行为）。
  expect(roundTrip("line a\\\nline b")).toBe("line a  \nline b");
});

it("aborts assembly when the token stream does not match the source", () => {
  // 组装必须逐字对齐；对不齐时返回 null，由 parser 回退旧路径（不猜长度）。
  const tokens = parseInlineTokens("[t](u)");
  expect(assembleLoadText(tokens, "[t](u)")).toBe("[t](u)");
  expect(assembleLoadText(tokens, "not the same source")).toBeNull();
});

it("paired tokens advance generically (em / strong / strike / declared marks)", () => {
  for (const src of ["*a*", "**a**", "~~a~~", "==a==", "***a***"]) {
    expect(assembleLoadText(parseInlineTokens(src), src)).toBe(src);
  }
});

it("assembles plugin tokens through tokenAdvance", () => {
  for (const src of ["a :smile: b", "$x^2$", "\\(y\\)", "~x~"]) {
    expect(assembleLoadText(parseInlineTokens(src), src)).toBe(src);
  }
});

it("assembles an unescaped text token from the raw source", () => {
  const tokens = [{ type: "text", content: "a b" }] as unknown as Token[];
  expect(assembleLoadText(tokens, "a\\ b")).toBe("a\\ b");
  expect(assembleLoadText(tokens, "a b")).toBe("a b");
});

it("keeps backslashes inside sub/sup around emoji shortcodes", () => {
  for (const src of [
    "~a\\:smile:~",
    "^a\\:smile:^",
    "~a\\\\:smile:~",
    "~\\:smile:~",
    "~a\\:smile:~ b",
  ]) {
    expect(assembleLoadText(parseInlineTokens(src), src)).toBe(src);
  }
});
