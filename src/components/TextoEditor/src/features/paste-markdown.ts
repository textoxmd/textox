// paste-markdown — paste Markdown source text as rendered nodes.
//
// Typing Markdown renders via input rules / leave-line drafts / normalize,
// but ProseMirror's default paste inserts clipboard text verbatim, so block
// syntax (headings, lists, fenced code, …) pasted from another editor stays
// as literal text. This feature intercepts plain-text paste and re-parses it
// through the same markdown-it pipeline as document load.

import { Plugin } from "prosemirror-state";
import { Slice } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";

import { parse } from "../parser.ts";

// Heuristic: does this text plausibly contain Markdown worth rendering?
// Plain prose is left to the default paste handler so its behavior is
// unchanged. Inline markers first (bold, strike, code, display math, links,
// images), then block markers at the start of a line. Single `$` and `__`
// are deliberately NOT triggers — dollar amounts ("$5") and Python dunders
// ("__init__") are common in prose and would be mangled into math/emphasis.
function looksLikeMarkdown(text: string): boolean {
  if (!text) return false;
  if (/(\*\*|~~|`|\$\$|!\[[^\]]*\]\(|\[[^\]]*\]\([^)]*\))/.test(text)) return true;
  return text.split("\n").some((line) =>
    /^\s{0,3}(#{1,6}\s|>\s?|[-*+]\s|\d+[.)]\s|```|~~~|---|\|.*\|.*\||\[[ xX]\]\s|<!--)/.test(line),
  );
}

function hasImageType(types: string[]): boolean {
  return types.some((t) => t.startsWith("image/"));
}

export function pasteMarkdownPlugin(): Plugin {
  return new Plugin({
    props: {
      handlePaste(view: EditorView, event: ClipboardEvent) {
        if (view.editable === false) return false;
        const cd = event.clipboardData;
        if (!cd) return false;

        const types = Array.from(cd.types as unknown as string[]);
        // Images are handled by paste-image; rich text keeps PM's default
        // HTML parsing so web/Word content isn't treated as Markdown source.
        if (hasImageType(types) || types.includes("text/html")) return false;

        const text = cd.getData("text/plain");
        if (!text || !looksLikeMarkdown(text)) return false;

        event.preventDefault();
        const doc = parse(text);
        // Open a lone plain paragraph so its inline content merges into the
        // surrounding textblock when pasted mid-paragraph (matching PM's
        // DOM-paste behavior). Block constructs (heading, list, code fence,
        // …) keep open depth 0 so they stay blocks.
        let openStart = 0;
        let openEnd = 0;
        if (doc.content.childCount === 1 && doc.content.firstChild?.type.name === "paragraph") {
          openStart = 1;
          openEnd = 1;
        }
        const tr = view.state.tr.replaceSelection(new Slice(doc.content, openStart, openEnd));
        view.dispatch(tr);
        return true;
      },
    },
  });
}
