import { markConsumed, type InlineSpan } from "../inline-parse.ts";
import type { FeatureSpec } from "./_types.ts";
import { ESCAPABLE_PUNCTUATION } from "./escapable.ts";

// Backslash escapes (CommonMark §2.3) under method-B.
//
// The parser keeps `\X` verbatim in the textblock text (see
// `escapePreserveBackslash` in parser.ts). This feature derives before the
// mark-producing inline features that would otherwise re-read the escaped char
// as syntax, so the pair is claimed before they look at them: an escaped
// `*` / `~` / `^` / `=` / `[` / `<` therefore yields no mark. Its `order` 0.2
// puts it ahead of the other derives (the next one starts at 0.3).
//
// The backslash itself is left visible (plain text); only the *following*
// char is protected from the inline scanners. `extRanges` marks the `\X`
// pairs as "already source", so a serializer that escapes would leave them
// untouched.

const scanEscapes = (text: string, consumed: Uint8Array): InlineSpan[] => {
  const out: InlineSpan[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "\\" || consumed[i]) {
      i++;
      continue;
    }
    const next = i + 1;
    // Only `\` + ASCII punctuation is an escape. A trailing `\`, a `\` before
    // a newline (hard break), or `\` + letter (literal backslash, e.g. LaTeX
    // `\frac`) is left alone.
    if (
      next >= text.length ||
      text[next] === "\n" ||
      consumed[next] ||
      !ESCAPABLE_PUNCTUATION.includes(text[next]!)
    ) {
      i++;
      continue;
    }
    markConsumed(consumed, i, next + 1);
    // v2 span 的不变式：openFrom <= openTo <= from <= to <= closeFrom <= closeTo。
    // 反斜杠是开分隔符（内容前的 1 字符），被转义的字符是内容，没有闭分隔符。
    // 旧 scan 把 `from..to` 写成整对 `\X`（openTo > from），derive 引擎会以
    // 「跨度违约」丢弃，因此这里按契约拆分。
    out.push({
      type: "escape",
      from: next,
      to: next + 1,
      openFrom: i,
      openTo: i + 1,
      closeFrom: next + 1,
      closeTo: next + 1,
      // 反斜杠按 method-B 的分隔符处理：光标在 span 外时隐藏（看到的是字面字符），
      // 光标进入时显示源码，便于编辑转义本身。
      delimRanges: [{ from: i, to: i + 1, softInside: true }],
    });
    i = next + 1;
  }
  return out;
};

export const escape: FeatureSpec = {
  name: "escape",

  inline: {
    order: 0.2,
    derive: (ctx) => scanEscapes(ctx.text, ctx.consumed),
    // No PM mark: the escape only protects the pair from the scanners.
    markNames: [],
    extRanges: (parent) => {
      const text = parent.textContent;
      const ranges: Array<[number, number]> = [];
      for (let i = 0; i + 1 < text.length; i++) {
        if (text[i] === "\\" && ESCAPABLE_PUNCTUATION.includes(text[i + 1]!)) {
          ranges.push([i, i + 2]);
          i++;
        }
      }
      return ranges;
    },
  },
};
