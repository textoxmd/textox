import { describe, expect, test } from "vitest";

import { parseInline } from "../../src/inline-parse.ts";
import { parse } from "../../src/parser.ts";
import { serialize } from "../../src/serializer.ts";

const widgets = (src: string) => parseInline(src).flatMap((s) => s.widgetDecorations ?? []);

describe("emoji via markdown-it-emoji tokens", () => {
  test(":smile: 产出 emoji span + widget，源码保留", () => {
    const spans = parseInline("a :smile: b");
    expect(spans.map((s) => [s.type, s.from, s.to])).toEqual([["emoji", 2, 9]]);
    expect(widgets("a :smile: b")[0]).toMatchObject({
      kind: "emoji",
      attrs: { glyph: "😄", len: "7" },
      when: "always",
      side: -1,
      stopEvents: true,
    });
    // serialize() collapses a single trailing newline (canonical doc form);
    // the point here is that the source shortcode survives, not a glyph.
    expect(serialize(parse("a :smile: b\n"))).toBe("a :smile: b");
  });

  test("未知名字 / shortcut / 代码 / autolink 都不触发", () => {
    for (const src of [":bogus:", ":)", "`:smile:`", "<http://x/:smile:>"]) {
      expect(parseInline(src).filter((s) => s.type === "emoji"), src).toEqual([]);
    }
  });

  test("转义的冒号不触发；转义后的冒号仍可触发", () => {
    expect(parseInline("\\:smile:").filter((s) => s.type === "emoji")).toEqual([]);
    expect(parseInline("\\::smile:").filter((s) => s.type === "emoji")).toHaveLength(1);
  });

  test("嵌套在强调 / 链接 / sub 内", () => {
    expect(parseInline("*:smile:*").some((s) => s.type === "emoji")).toBe(true);
    expect(parseInline("[:smile:](u)").some((s) => s.type === "emoji")).toBe(true);
    expect(parseInline("~:smile:~").filter((s) => s.type === "emoji")).toHaveLength(1);
  });

  test("sub/sup 内的转义冒号保真", () => {
    for (const src of ["~a\\:smile:~", "^a\\:smile:^", "~a\\\\:smile:~"]) {
      expect(serialize(parse(`${src}\n`))).toBe(src);
    }
    // 奇数反斜杠 ⇒ 不产 emoji；偶数 ⇒ 产 emoji。
    expect(parseInline("~a\\:smile:~").filter((s) => s.type === "emoji")).toEqual([]);
    expect(parseInline("~a\\\\:smile:~").filter((s) => s.type === "emoji")).toHaveLength(1);
  });
});
