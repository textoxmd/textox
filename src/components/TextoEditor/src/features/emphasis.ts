import type { Command } from "prosemirror-state";

import { markExtRanges } from "../inline-parse.ts";
import { toggleInlineDelim, type ToggleView } from "./inline-toggle.ts";
import type { FeatureSpec } from "./_types.ts";

// em + strong share one source construct family: `*` / `_` runs. The
// positioning layer (`inline-derive.ts`) pairs the runs from markdown-it's
// own delimiter stack, so this feature only owns the schema / token /
// serializer wiring plus the Mod-b command.

export const emphasis: FeatureSpec = {
  name: "emphasis",

  marks: {
    em: {
      parseDOM: [{ tag: "em" }, { tag: "i" }],
      toDOM: () => ["em", 0],
    },
    strong: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
      toDOM: () => ["strong", 0],
    },
  },

  parserTokens: {
    // `tok.markup` preserves the source delim char (`*` vs `_`) so that
    // round-trip keeps the user's original markdown verbatim.
    em_open: (state, tok, schema) => {
      state.addText(tok.markup);
      state.openMark(schema.marks.em.create());
    },
    em_close: (state, tok, schema) => {
      state.closeMarkType(schema.marks.em);
      state.addText(tok.markup);
    },
    strong_open: (state, tok, schema) => {
      state.addText(tok.markup);
      state.openMark(schema.marks.strong.create());
    },
    strong_close: (state, tok, schema) => {
      state.closeMarkType(schema.marks.strong);
      state.addText(tok.markup);
    },
  },

  markDelims: {
    em: { open: "", close: "" },
    strong: { open: "", close: "" },
  },

  inline: {
    markNames: ["em", "strong"],
    extRanges: (parent) => [
      ...markExtRanges(parent, "em", 1),
      ...markExtRanges(parent, "strong", 2),
    ],
  },

  keymap: (_schema) => ({
    "Mod-b": toggleBold(),
  }),

};

const OPEN = "**";

// Mod-b. Delegates to toggleInlineDelim so the keyboard shortcut, the top
// toolbar and the floating toolbar all unwrap via the same mark-based
// decision (a boundary drifted onto a hidden delim still unwraps correctly,
// and nested marks unwrap one layer at a time).
function toggleBold(): Command {
  return (state, dispatch, view) => {
    if (dispatch && view) {
      toggleInlineDelim(view as unknown as ToggleView, OPEN);
      return true;
    }
    if (!dispatch) {
      // Query-only: report whether the selection is fully bold (so callers
      // like keymap checks can decide). toggleInlineDelim doesn't expose
      // this, so fall back to a mark scan.
      return isSelectionBold(state);
    }
    return false;
  };
}

function isSelectionBold(state: import("prosemirror-state").EditorState): boolean {
  const { from, to, empty } = state.selection;
  if (empty) return false;
  const strong = state.schema.marks.strong;
  let found = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText && !node.marks.some((m) => m.type === strong)) {
      found = true;
      return false;
    }
  });
  return !found;
}
