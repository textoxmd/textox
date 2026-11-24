import { describe, expect, test } from "vitest";

import { parseInline } from "../src/inline-parse.ts";

describe("parseInline", () => {
  test("plain text — no spans", () => {
    expect(parseInline("hello")).toEqual([]);
  });

  test("lone asterisk — no pair", () => {
    expect(parseInline("*")).toEqual([]);
  });

  test("unclosed em — no pair", () => {
    expect(parseInline("*1")).toEqual([]);
  });

  test("*1* — em", () => {
    expect(parseInline("*1*")).toEqual([
      { type: "em", from: 1, to: 2, openFrom: 0, openTo: 1, closeFrom: 2, closeTo: 3 },
    ]);
  });

  test("**1** — strong", () => {
    expect(parseInline("**1**")).toEqual([
      { type: "strong", from: 2, to: 3, openFrom: 0, openTo: 2, closeFrom: 3, closeTo: 5 },
    ]);
  });

  test("**1* — literal leading asterisk, em on the inner run", () => {
    // CommonMark pairs the closer with the nearest opener, so the first `*`
    // stays literal and em covers `1` only. (The old delimiter scanner
    // produced em("*1"); `parse()` has always read it this way.)
    expect(parseInline("**1*")).toEqual([
      { type: "em", from: 2, to: 3, openFrom: 1, openTo: 2, closeFrom: 3, closeTo: 4 },
    ]);
  });

  test("*1** — em then a literal trailing asterisk", () => {
    // 1-char opener paired with the leftmost char of the 2-char close run;
    // the remaining `*` is literal text.
    expect(parseInline("*1**")).toEqual([
      { type: "em", from: 1, to: 2, openFrom: 0, openTo: 1, closeFrom: 2, closeTo: 3 },
    ]);
  });

  test("* 1 * — whitespace-adjacent, no pair", () => {
    expect(parseInline("* 1 *")).toEqual([]);
  });

  test("*a*b* — L→R stack pairing closes at first close run", () => {
    // Stack-based pairing (CommonMark style): first `*` opens, second
    // `*` closes → em("a"); trailing `*` has no open left on stack.
    // (Old "outermost" rule bridged to the last `*`, which also caused
    // the `_em_ __strong__` bridging bug — see emphasis.ts.)
    expect(parseInline("*a*b*")).toEqual([
      { type: "em", from: 1, to: 2, openFrom: 0, openTo: 1, closeFrom: 2, closeTo: 3 },
    ]);
  });

  test("hello *world* — em in the middle", () => {
    expect(parseInline("hello *world*")).toEqual([
      { type: "em", from: 7, to: 12, openFrom: 6, openTo: 7, closeFrom: 12, closeTo: 13 },
    ]);
  });

  test("** — just delim chars, no pair", () => {
    expect(parseInline("**")).toEqual([]);
  });

  test("`1` — code", () => {
    expect(parseInline("`1`")).toEqual([
      { type: "code", from: 1, to: 2, openFrom: 0, openTo: 1, closeFrom: 2, closeTo: 3 },
    ]);
  });

  test("`*x*` — code wins over em; inner stars stay as content", () => {
    expect(parseInline("`*x*`")).toEqual([
      { type: "code", from: 1, to: 4, openFrom: 0, openTo: 1, closeFrom: 4, closeTo: 5 },
    ]);
  });

  test("~~1~~ — strike", () => {
    expect(parseInline("~~1~~")).toEqual([
      { type: "strike", from: 2, to: 3, openFrom: 0, openTo: 2, closeFrom: 3, closeTo: 5 },
    ]);
  });

  test("~1~ — single tilde is subscript (Typora extension)", () => {
    expect(parseInline("~1~")).toEqual([
      { type: "sub", from: 1, to: 2, openFrom: 0, openTo: 1, closeFrom: 2, closeTo: 3 },
    ]);
  });
});
