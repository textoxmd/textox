import { markExtRanges } from "../inline-parse.ts";
import type { FeatureSpec } from "./_types.ts";

// Code spans are located by the positioning layer (`inline-derive.ts`), which
// pairs the backtick fences and folds the CommonMark padding spaces. This
// feature keeps only the schema / token / serializer wiring.

export const code: FeatureSpec = {
  name: "code",

  marks: {
    code: {
      parseDOM: [{ tag: "code" }],
      toDOM: () => ["code", 0],
    },
  },

  parserTokens: {
    code_inline: (state, tok, schema) => {
      // tok.markup is the actual fence (e.g. `` ` ``, `` `` ``, `` ``` ``).
      // For multi-char fences, CommonMark renders content with a single
      // leading + trailing space stripped if present on both sides; we
      // need to put those spaces back so the doc carries the verbatim
      // source. md-it doesn't expose the original spaces directly, but
      // we can detect the case: any fence longer than 1 char that wraps
      // content containing the same fence char needs the surrounding
      // space to disambiguate.
      const fence = tok.markup;
      let content = tok.content;
      if (fence.length > 1 && content.includes(fence[0]!)) {
        content = ` ${content} `;
      }
      state.addText(fence);
      state.openMark(schema.marks.code.create());
      state.addText(content);
      state.closeMarkType(schema.marks.code);
      state.addText(fence);
    },
  },

  markDelims: {
    code: { open: "", close: "" },
  },

  inline: {
    markNames: ["code"],
    // For round-trip: ext-range covers the full source span — open run +
    // optional folded space + content + optional folded space + close run.
    // We can't know the original delim length from the doc alone, but we
    // can find each contiguous code-mark run and walk left/right past
    // backticks (and at most one adjacent space if both sides have one).
    extRanges: (parent) => {
      const ranges: Array<[number, number]> = [];
      const codeType = parent.type.schema.marks.code;
      if (!codeType) return ranges;
      const text = parent.textContent;
      // Use markExtRanges with delim length 0 to get raw mark ranges,
      // then expand each side past backticks (and optional fold-space).
      const baseRanges = markExtRanges(parent, "code", 0);
      for (const [from, to] of baseRanges) {
        let left = from;
        // Optional folded space immediately before the mark.
        if (left > 0 && text[left - 1] === " ") left -= 1;
        while (left > 0 && text[left - 1] === "`") left -= 1;
        let right = to;
        if (right < text.length && text[right] === " ") right += 1;
        while (right < text.length && text[right] === "`") right += 1;
        ranges.push([left, right]);
      }
      return ranges;
    },
  },

};
