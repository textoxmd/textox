import { markExtRanges } from "../inline-parse.ts";
import type { FeatureSpec } from "./_types.ts";

// strike: source `~~text~~`. The positioning layer (`inline-derive.ts`)
// locates the fences from markdown-it's `s_open` / `s_close` tokens.

export const strike: FeatureSpec = {
  name: "strike",

  marks: {
    strike: {
      parseDOM: [{ tag: "s" }, { tag: "del" }],
      toDOM: () => ["s", 0],
    },
  },

  // markdown-it ships a strikethrough rule but the commonmark preset disables it.
  mdItPlugins: [(md) => md.enable("strikethrough")],

  parserTokens: {
    s_open: (state, _tok, schema) => {
      state.addText("~~");
      state.openMark(schema.marks.strike.create());
    },
    s_close: (state, _tok, schema) => {
      state.closeMarkType(schema.marks.strike);
      state.addText("~~");
    },
  },

  markDelims: {
    strike: { open: "", close: "" },
  },

  inline: {
    markNames: ["strike"],
    extRanges: (parent) => markExtRanges(parent, "strike", 2),
  },

};
