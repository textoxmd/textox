import { inputRules } from "prosemirror-inputrules";
import { Plugin } from "prosemirror-state";

import { collectInputRules } from "./features/index.ts";
import { getSchema } from "./schema.ts";

export function markdownInputRules(): Plugin {
  return inputRules({ rules: collectInputRules(getSchema()) });
}

// Blocks handleTextInput when locked so the inputRules plugin (which
// converts patterns like "- " → bullet_list) never fires.
export function editableInputRulesGuard(): Plugin {
  return new Plugin({
    props: {
      handleTextInput(view) {
        if (view.editable === false) return true;
        return false;
      },
    },
  });
}

// Space breaks out of storedMarks — matches Typora's UX: right after a mark
// is created, a space should land outside the mark. This does not affect
// typing a space inside an existing mark range (e.g. `*hello world*`),
// because then the space sits inside an existing text node and PM computes
// marks by position, bypassing storedMarks.
export function spaceBreaksStoredMarks(): Plugin {
  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        if (view.editable === false) return true;
        if (view.composing) return false;
        if (text !== " ") return false;
        const stored = view.state.storedMarks;
        if (!stored || stored.length === 0) return false;
        // Clear stored marks first, then insert the space via the standard
        // insertText path so that PM's text-composition machinery (IME,
        // selection replacement, decorations) is fully engaged.  Using
        // replaceWith directly skips that path and can leave the DOM out of
        // sync with the ProseMirror state.
        const tr = view.state.tr
          .setStoredMarks([])
          .insertText(" ", from, to);
        view.dispatch(tr);
        return true;
      },
    },
  });
}
