import type { Mark } from "prosemirror-model";

import { decodeNonAscii } from "./url.ts";
import type { FeatureSpec } from "./_types.ts";

// link: source `[text](href "title")` stays verbatim in the textblock text.
// The positioning layer (`inline-derive.ts`) locates the `[` open delim and
// the `](href "title")` close delim from markdown-it's `link_open` /
// `link_close` tokens, and hands the decoded attrs to normalize.

// 实现已抽到叶子模块 `url.ts`（定位层也要用）；此处再导出保持既有 import 可用。
export { decodeNonAscii } from "./url.ts";

function closeDelimText(mark: Mark): string {
  const href = String(mark.attrs.href ?? "");
  const title = mark.attrs.title as string | null;
  return title
    ? `](${href} "${title.replace(/"/g, '\\"')}")`
    : `](${href})`;
}

export const link: FeatureSpec = {
  name: "link",

  marks: {
    link: {
      attrs: {
        href: {},
        title: { default: null },
      },
      inclusive: false,
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (el) => ({
            href: (el as HTMLElement).getAttribute("href"),
            title: (el as HTMLElement).getAttribute("title"),
          }),
        },
        {
          tag: "a[data-href]",
          getAttrs: (el) => ({
            href: (el as HTMLElement).getAttribute("data-href"),
            title: (el as HTMLElement).getAttribute("title"),
          }),
        },
      ],
      toDOM: (mark) => {
        const { href, title } = mark.attrs as { href: string; title: string | null };
        return ["a", { "data-href": href, ...(title ? { title } : {}) }, 0];
      },
    },
  },

  parserTokens: {
    link_open: (state, tok, schema) => {
      const raw = tok.attrGet("href") ?? "";
      // markdown-it's normalizeLink percent-encodes non-ASCII at parse time
      // (e.g. 中文 file paths become %E4%B8%AD...), which would otherwise be
      // baked into the serialized markdown on save. Restore the original
      // non-ASCII characters; ASCII escapes like %20 are preserved.
      const href = decodeNonAscii(raw);
      // CommonMark autolink: `<url>` / `<email>` — the source chars `<` and
      // `>` stay in the textblock, so they are emitted around the mark.
      if (tok.markup === "autolink") {
        state.addText("<");
        state.openMark(schema.marks.autolink.create({ href }));
        return;
      }
      const title = tok.attrGet("title");
      state.addText("[");
      state.openMark(schema.marks.link.create({ href, title: title || null }));
    },
    link_close: (state, tok, schema) => {
      if (tok.markup === "autolink") {
        state.closeMarkType(schema.marks.autolink);
        state.addText(">");
        return;
      }
      const mark = state.topMark(schema.marks.link);
      state.closeMarkType(schema.marks.link);
      if (mark) state.addText(closeDelimText(mark));
    },
  },

  markDelims: {
    link: { open: "", close: "" },
  },

  inline: {
    markNames: ["link"],
    extRanges: (parent) => {
      const ranges: Array<[number, number]> = [];
      const linkType = parent.type.schema.marks.link;
      if (!linkType) return ranges;
      let start = -1;
      let currentMark: Mark | null = null;
      let off = 0;
      const flush = (end: number): void => {
        if (start < 0 || !currentMark) return;
        ranges.push([start - 1, end + closeDelimText(currentMark).length]);
        start = -1;
        currentMark = null;
      };
      parent.forEach((child) => {
        if (child.isText) {
          const m = child.marks.find((mk) => mk.type === linkType) ?? null;
          if (m) {
            if (start < 0) {
              start = off;
              currentMark = m;
            } else if (currentMark && !m.eq(currentMark)) {
              flush(off);
              start = off;
              currentMark = m;
            }
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
