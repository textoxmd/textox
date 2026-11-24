import type { FeatureSpec } from "./_types.ts";

// CommonMark autolink: `<scheme:rest>` and `<email>`. Method-B mode —
// text keeps `<` and `>` verbatim; markdown-it's own `autolink` rule decides
// what qualifies (so `<foo@bar>` is an autolink, per the spec) and the
// locator (`inline-derive.ts`) maps its `link_open`/`link_close`
// (`markup === "autolink"`) back to those delimiters.
//
// `<a>` tag rendering is handled by link.ts's renderCase (single owner
// for the tag). Autolink toDOM emits `data-autolink` so the dispatch
// can split <l:url> vs <a:url>.

export const autolink: FeatureSpec = {
  name: "autolink",

  marks: {
    autolink: {
      attrs: { href: {} },
      inclusive: false,
      parseDOM: [
        {
          tag: "a[data-autolink]",
          getAttrs: (el) => ({
            href: (el as HTMLElement).getAttribute("data-href") ?? (el as HTMLElement).getAttribute("href") ?? "",
          }),
        },
      ],
      toDOM: (mark) => [
        "a",
        { "data-href": mark.attrs.href as string, "data-autolink": "" },
        0,
      ],
    },
  },

  // markdown-it's `autolink` rule owns the `<url>` / `<email>` shapes
  // (enabled in parser.ts); the locator maps its tokens to this mark.
  markDelims: {
    autolink: { open: "", close: "" },
  },

  // No renderCase here — link.ts owns the `<a>` tag mapping and dispatches
  // on `data-autolink` to emit `<a:url>...</a>` for autolink and
  // `<l:url>...</l>` for regular links.

  inline: {
    markNames: ["autolink"],
    extRanges: (parent) => {
      // Same shape as link's extRanges but for the autolink mark: cover
      // the `<` open delim and `>` close delim plus the URI content.
      const ranges: Array<[number, number]> = [];
      const autolinkType = parent.type.schema.marks.autolink;
      if (!autolinkType) return ranges;
      let start = -1;
      let off = 0;
      const flush = (end: number): void => {
        if (start < 0) return;
        ranges.push([start - 1, end + 1]); // -1 for `<`, +1 for `>`
        start = -1;
      };
      parent.forEach((child) => {
        if (child.isText) {
          const has = child.marks.some((mk) => mk.type === autolinkType);
          if (has) {
            if (start < 0) start = off;
          } else {
            flush(off);
          }
        }
        off += child.nodeSize;
      });
      flush(off);
      return ranges;
    },
  },
};
