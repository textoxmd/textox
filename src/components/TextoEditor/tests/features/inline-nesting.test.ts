import { expect, it } from "vitest";
import { createState } from "../../src/editor.ts";
import { parse } from "../../src/parser.ts";
import { serialize } from "../../src/serializer.ts";

function live(md: string) {
  const s0 = createState(parse(md));
  const s = s0.apply(s0.tr);
  const marks: string[] = [];
  s.doc.descendants((n) => { if (n.isText) marks.push(...n.marks.map((m) => m.type.name)); return true; });
  return { marks, out: serialize(s.doc) };
}

it("live path keeps nested marks", () => {
  expect(live("*![a](x)*").marks).toContain("em");
  expect(live("*![a](x)*").marks).toContain("image");
  expect(live("*[a](b)*").marks).toContain("link");
  expect(live("x ![a *em*](x.png) y").marks).toContain("image");
  expect(live("[a [b] c](u)").marks).toContain("link");
  expect(live("[a](x*y*z)").marks).not.toContain("em");
});

it("live path round-trips unchanged", () => {
  for (const src of ["*![a](x)*", "*[a](b)*", "x ![a *em*](x.png) y", "[a [b] c](u)", "[a](x*y*z)"])
    expect(live(src).out).toBe(src);
});

it("code spans still work after retiring the scanner", () => {
  expect(live("a `b` c").marks).toContain("code");
  expect(live("a `` b ` c `` d").out).toBe("a `` b ` c `` d");
  expect(live("\\`not code\\`").marks).not.toContain("code");
});
