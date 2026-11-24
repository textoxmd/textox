import { expect, it } from "vitest";
import { createState } from "../../src/editor.ts";
import { parse } from "../../src/parser.ts";
import { serialize } from "../../src/serializer.ts";

function marksOf(doc: import("prosemirror-model").Node): string[] {
  const out: string[] = [];
  doc.descendants((n) => { if (n.isText) out.push(n.marks.map((m) => m.type.name).join("+")); return true; });
  return out;
}
const live = (src: string) => {
  const s0 = createState(parse(src));
  return s0.apply(s0.tr);
};

it("load path marks CommonMark autolinks", () => {
  expect(marksOf(parse("<http://x>"))).toContain("autolink");
  expect(marksOf(parse("<foo@bar>"))).toContain("autolink");   // 规范允许无点域名
  expect(marksOf(parse("<a@b.co>"))).toContain("autolink");
});

it("text is preserved verbatim", () => {
  for (const src of ["<http://x>", "<foo@bar>", "<a@b.co>", "*<http://x>*"])
    expect(serialize(parse(src))).toBe(src);
});

it("live path agrees with load path", () => {
  expect(marksOf(live("<foo@bar>").doc)).toContain("autolink");
  expect(serialize(live("<foo@bar>").doc)).toBe("<foo@bar>");
});

it("emphasis wrapping an autolink", () => {
  const s = live("*<http://x>*");
  expect(marksOf(s.doc)).toContain("em+autolink");
});

it("percent-encoded and punycode autolinks keep their source text", () => {
  for (const src of ["<http://x.com/a%20b>", "<http://x.com/%E4%B8%AD>", "<https://xn--r8jz45g.jp>"]) {
    expect(serialize(parse(src))).toBe(src);
    const s = live(src);
    expect(serialize(s.doc)).toBe(src);
  }
});

it("text after an autolink is not shifted", () => {
  const src = "*<http://x.com/a%20b>* *y*";
  expect(serialize(live(src).doc)).toBe(src);
});

it("extension syntax does not drill into an autolink", () => {
  for (const src of ["<http://x.com/~foo~>", "<http://x.com/$a$>", "<http://x.com/a==b==c>"]) {
    const marks = new Set<string>();
    const s = live(src);
    s.doc.descendants((n) => { if (n.isText) for (const m of n.marks) marks.add(m.type.name); return true; });
    expect([...marks].sort(), src).toEqual(["autolink"]);
  }
});

it("parse → serialize → parse is idempotent", () => {
  const src = "<http://x.com/a%20b>";
  expect(serialize(parse(serialize(parse(src))))).toBe(src);
});
