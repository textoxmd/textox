// Golden snapshot of load-time inline assembly, recorded *before* the
// `assembleLoadText` refactor onto `deriveInline`'s `positioned` units.
//
// The corpus pins the observable behaviour of the current implementation
// (`null` = assembly aborted, otherwise the exact text handed to the parser).
// After the refactor this test must still pass unchanged: same inputs, same
// assembled strings. Regenerate only when the behaviour change is intended:
//
//   UPDATE_GOLDEN=1 npx vitest run --config src/components/TextoEditor/vitest.config.ts \
//     tests/features/load-assemble-golden.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it, test } from "vitest";

import { assembleLoad, assembleLoadText } from "../../src/features/load-assemble.ts";
import { parseTokens } from "../../src/parser.ts";

const FIXTURE = "src/components/TextoEditor/tests/fixtures/load-assemble.golden.json";
const UPDATE = process.env.UPDATE_GOLDEN === "1";

const CORPUS: string[] = [
  "plain",
  "a *b* c **d** ~~e~~",
  "a  \nb",
  "a\\\nb",
  "a\nb",
  "`c`",
  "``a`b``",
  "a `c` b",
  "[t](u)",
  '[t](u "ti")',
  "[](u)",
  "[t][id]",
  "[t][]",
  "[t]",
  "![a](x.png)",
  '![a](x.png "ti")',
  "![a][id]",
  "![a][]",
  "<https://a.b/~x~>",
  "a :smile: b",
  "$x^2$",
  "\\(y\\)",
  "~a\\ b~",
  "~a\\:smile:~",
  "a \\* b",
  "a\\\\ b",
  "==x==",
  "H~2~O E=mc^2^",
  "[id]: https://x.example \"ti\"",
  "see [t][id] and ![a][id]\n\n[id]: https://x.example \"ti\"",
  "[full][id] and [collapsed][] and [shortcut]\n\n[id]: https://i.example \"ti\"\n[collapsed]: https://c.example\n[shortcut]: https://s.example",
  "[][empty]\n\n[empty]: https://e.example",
  "![alt][img] and ![a &amp; b][img]\n\n[img]: https://i.example \"ti\"",
];

function assembled(src: string): Array<string | null> {
  const out: Array<string | null> = [];
  for (const tok of parseTokens(src)) {
    if (tok.type !== "inline" || !tok.children) continue;
    out.push(assembleLoadText(tok.children, tok.content));
  }
  return out;
}

describe("load assembly golden", () => {
  const actual = CORPUS.map((src) => ({ src, out: assembled(src) }));

  if (UPDATE) {
    test("rewrites the snapshot", () => {
      writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
      expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(actual);
    });
    return;
  }

  const expected = JSON.parse(readFileSync(FIXTURE, "utf8")) as typeof actual;

  test.each(CORPUS.map((src, i) => [i, src] as const))("#%i %j", (i, src) => {
    expect({ src, out: assembled(src) }).toEqual(expected[i]);
  });
});

describe("assembleLoad invariants", () => {
  function lastEnd(units: ReadonlyArray<{ end: number }>): number {
    return units.reduce((max, unit) => Math.max(max, unit.end), 0);
  }

  it("普通块 reusable=true，派生对应 raw", () => {
    const inline = parseTokens("a *b* c").find((t) => t.type === "inline")!;
    const load = assembleLoad(inline.children!, inline.content)!;
    expect(load.text).toBe(inline.content);
    expect(load.reusable).toBe(true);
    expect(lastEnd(load.derivation.positioned)).toBe(inline.content.length);
  });

  it("参考式 canonical 化块 reusable=false，派生仍对应 raw", () => {
    const inline = parseTokens("see [t][id]\n\n[id]: https://x.example\n").find(
      (t) => t.type === "inline",
    )!;
    const load = assembleLoad(inline.children!, inline.content)!;
    expect(load.text).toBe("see [t](https://x.example)");
    expect(load.reusable).toBe(false);
    expect(lastEnd(load.derivation.positioned)).toBe(inline.content.length);
  });

  it("参考式图片 canonical 化后 reusable=false", () => {
    const inline = parseTokens("![a][img]\n\n[img]: https://i.example\n").find(
      (t) => t.type === "inline",
    )!;
    const load = assembleLoad(inline.children!, inline.content)!;
    expect(load.text).toBe("![a](https://i.example)");
    expect(load.reusable).toBe(false);
    expect(lastEnd(load.derivation.positioned)).toBe(inline.content.length);
  });

  it("内联链接未改写时 reusable=true", () => {
    const inline = parseTokens("[t](u)").find((t) => t.type === "inline")!;
    const load = assembleLoad(inline.children!, inline.content)!;
    expect(load.text).toBe("[t](u)");
    expect(load.reusable).toBe(true);
  });
});
