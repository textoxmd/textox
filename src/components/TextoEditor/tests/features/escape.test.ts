import { expect, test } from "vitest";
import { TextSelection } from "prosemirror-state";

import { createState } from "../../src/editor.ts";
import { escape } from "../../src/features/escape.ts";
import { parseInline } from "../../src/inline-parse.ts";
import { getDelims } from "../../src/normalize.ts";
import { parse } from "../../src/parser.ts";
import { serialize } from "../../src/serializer.ts";
import type { Node as PMNode } from "prosemirror-model";

// Backslash escapes (CommonMark §2.3) must survive into the live editor:
// `\*x\*` renders as literal `*x*`, not emphasis, and saving keeps the escape.
// The doc text holds the source form (`\X` verbatim); the `escape` inline
// feature protects the pair from the method-B scanners.

/** Mark names per text node (empty string = unmarked). */
function markNames(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((n) => {
    if (n.isText) out.push(n.marks.map((m) => m.type.name).join("+"));
    return true;
  });
  return out;
}

function deriveOf(text: string, consumed = new Uint8Array(text.length)) {
  return escape.inline!.derive!({
    text,
    tokens: [],
    parentBlock: null,
    consumed,
    isConsumed: () => false,
    warn: () => {},
  });
}

/** Parse, run one transaction (so `normalize` reconciles marks), serialize. */
function live(md: string): { marks: string[]; out: string } {
  const base = createState(parse(md));
  const state = base.apply(base.tr);
  return { marks: markNames(state.doc), out: serialize(state.doc) };
}

test("goes through the v2 derive seam at order 0.2", () => {
  expect(escape.inline?.order).toBe(0.2);
  expect(typeof escape.inline?.derive).toBe("function");
});

test("derive claims every `\\X` pair before the mark scanners see it", () => {
  // `\*b\*` → two pairs; both chars of each pair are consumed so no scanner can
  // re-read the escaped punctuation as syntax. 反斜杠是开分隔符，被转义的字符
  // 是内容（`from..to`），没有闭分隔符（零宽在内容末尾）。
  const text = "a \\*b\\* c";
  const consumed = new Uint8Array(text.length);
  expect(deriveOf(text, consumed).map((s) => [s.type, s.from, s.to])).toEqual([
    ["escape", 3, 4],
    ["escape", 6, 7],
  ]);
  expect([...consumed]).toEqual([0, 0, 1, 1, 0, 1, 1, 0, 0]);
});

test("derive leaves non-escape backslashes alone", () => {
  // `\f` (LaTeX), a trailing `\`, and `\` before a newline are not escapes.
  for (const text of ["$\\frac{1}{2}$", "trailing\\", "a\\\nb"]) {
    expect(deriveOf(text)).toEqual([]);
  }
  // An already-consumed position is skipped (`\\` claims the pair, so the
  // second backslash's follower is not read as a fresh escape).
  const consumed = new Uint8Array("\\\\*x*".length);
  const spans = deriveOf("\\\\*x*", consumed);
  expect(spans.map((s) => [s.from, s.to])).toEqual([[1, 2]]);
});

test("the backslash is hidden when the cursor is outside the pair", () => {
  const src = "literal \\*x\\* tail";
  const base = createState(parse(src));
  // 光标放在末尾 → escape 的 span 外 → 反斜杠应被软隐藏
  const state = base.apply(base.tr.setSelection(TextSelection.create(base.doc, base.doc.content.size)));
  const hidden: string[] = [];
  for (const d of getDelims(state)) {
    if (!d.softInside) continue;
    hidden.push(state.doc.textBetween(d.from, d.to));
  }
  expect(hidden).toEqual(["\\", "\\"]);
  expect(serialize(state.doc)).toBe(src);
});

test("parse keeps the backslash in the textblock text", () => {
  expect(parse("literal \\*x\\*").textContent).toBe("literal \\*x\\*");
  expect(parse("\\# not a heading").firstChild!.type.name).toBe("paragraph");
  expect(parse("\\# not a heading").textContent).toBe("\\# not a heading");
});

test("escaped punctuation stays literal and carries no marks", () => {
  const cases = [
    "literal \\*not italic\\*",
    "\\`not code\\`",
    "\\~not sub\\~",
    "\\^not sup\\^",
    "\\<http://x.com>",
    "\\[a\\](b)",
    "\\# not a heading",
    "\\- not a bullet",
    "snake\\_case\\_ident",
    "a \\<b\\> c",
  ];
  for (const input of cases) {
    const { marks, out } = live(input);
    expect(marks.every((m) => m === ""), `${input} should carry no marks`).toBe(true);
    expect(out, `${input} should round-trip unchanged`).toBe(input);
  }
});

test("real syntax is unaffected", () => {
  expect(live("*yes*").marks).toEqual(["", "em", ""]);
  expect(live("*yes*").out).toBe("*yes*");
  expect(live("**bold**").out).toBe("**bold**");
  expect(live("`code`").out).toBe("`code`");
  expect(live("~~del~~").out).toBe("~~del~~");
});

test("escaped and unescaped delimiters coexist in one paragraph", () => {
  const { marks, out } = live("\\*real\\* and *em*");
  expect(out).toBe("\\*real\\* and *em*");
  expect(marks).toContain("em");
});

test("escaped backslash then a real delimiter pair", () => {
  // `\\` is a literal backslash; the following `*x*` is still emphasis.
  const { marks, out } = live("\\\\*x*");
  expect(out).toBe("\\\\*x*");
  expect(marks).toContain("em");
});

test("a backslash before a letter is not an escape (LaTeX etc.)", () => {
  // `\f` is a literal backslash + letter, so it must not be treated as an
  // escape pair (this is what keeps `$\frac{1}{2}$` intact).
  const { marks, out } = live("$\\frac{1}{2}$");
  expect(out).toBe("$\\frac{1}{2}$");
  expect(marks.some((m) => m === "")).toBe(true);
});

test("canonical save does not re-escape literal punctuation", () => {
  expect(live("see <https://example.com>").out).toBe("see <https://example.com>");
  expect(live("a [b] c").out).toBe("a [b] c");
  expect(live("2 * 3 * 4").out).toBe("2 * 3 * 4");
});

test("extension syntax is suppressed by a preceding backslash", () => {
  const cases = [
    "\\~x\\~", // sub
    "\\^x\\^", // sup
    "\\=x\\=", // highlight
    "\\:smile:", // emoji
    "\\<span>hi</span>", // html_inline
    "\\<u>hi</u>", // underline
    "\\[x](y)", // link
    "\\<http://x.com>", // autolink
  ];
  for (const text of cases) {
    const spans = parseInline(text);
    expect(
      spans.every((s) => s.type === "escape"),
      `${text} → ${JSON.stringify(spans.map((s) => s.type))}`,
    ).toBe(true);
  }
});

test("suppresses html comment and footnote ref after a backslash", () => {
  expect(parseInline("\\<!-- c -->").map((s) => s.type)).toEqual(["escape"]);
  expect(parseInline("\\[^1]").map((s) => s.type)).toEqual(["escape"]);
});

test("math still wins over escaping for \\(...\\)", () => {
  expect(parseInline("\\(x\\)").some((s) => s.type === "inline_math")).toBe(true);
  expect(parseInline("$x$").some((s) => s.type === "inline_math")).toBe(true);
  expect(parseInline("\\$100").every((s) => s.type === "escape")).toBe(true);
});

test("save → reload → save is idempotent", () => {
  const inputs = [
    "literal \\*not italic\\*",
    "\\# not a heading",
    "a \\<b\\> c",
    "snake\\_case\\_ident",
    "\\*real\\* and *em*",
    "back\\\\slash",
    "trailing\\",
    "\\~x\\~ \\^y\\^ \\=z\\=",
    "\\[not a link\\]",
  ];
  for (const md of inputs) {
    const once = live(md).out;
    const twice = live(once).out;
    expect(twice, `not idempotent for ${JSON.stringify(md)}`).toBe(once);
  }
});
