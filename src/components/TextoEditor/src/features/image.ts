import type { Mark } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import { getDocumentDir } from "../doc-info.ts";
import { getEditorHost } from "../host.ts";
import { decodeNonAscii } from "./link.ts";
import {
  imageLoadStatus,
  IMAGE_LOAD_META,
  type LoadStatus,
} from "./image-load-status.ts";
import type { FeatureSpec } from "./_types.ts";

// Re-exported so existing importers / the `__getImageLoadStatus` test hook keep
// the same path; the map itself lives in the shared leaf module.
export { imageLoadStatus };

// image: source `![alt](src "title")` stays verbatim in the textblock text:
//   open delim  = `![`            (2 chars)
//   content     = alt             (image mark covers this range)
//   close delim = `](src "title")` or `](src)`
//
// The positioning layer (`inline-derive.ts`) locates the delimiters and the
// render hooks; this feature owns schema / token wiring.
//
// Visibility model (different from link, matches Typora):
//   - cursor outside span: source chars hidden, an <img> widget at closeTo
//     renders the loaded image below the source text
//   - cursor inside span:  source chars visible (plain); if src is empty, a
//     <file-input/> widget sits between `(` and `)` so the user can pick a file
//
// We piggy-back on the existing softInside delim path to flip the source
// chars on and off, and on widgetDecorations to render the img/file-input UI.

// Per-src load result lives in `image-load-status.ts` (shared with the
// locator). We only need to remember confirmed errors — "loading" and "ok"
// both render as a loaded image (optimistic), so we track only the negative
// case explicitly.
//
// Keyed by src string. Module-level so the probe plugin can write it. setMeta
// on a state-only tr tells PM to re-run state.apply / appendTransaction so
// decorations re-emit.

// Lazy load-status probing.
//
// We no longer scan the whole doc and probe every image on mount — that fired
// a request per image (off-screen or broken included) the instant a document
// opened. Instead the image-render widget (decorations.ts) registers its <img>
// DOM element via registerImageProbe, and an IntersectionObserver runs probe()
// only when that image nears the viewport. Combined with the widget's native
// `loading="lazy"`, text renders first and images load progressively on scroll.
//
// Per-src result is remembered in the shared imageLoadStatus map ("loading" and
// "ok" both render optimistically; only confirmed "error" flips the span to
// edit-mode/file-input). setMeta-only tx tells PM to re-run state.apply /
// appendTransaction so normalize + decorations re-emit with the new status.

// Current editor used by probe() (fired from decoration IO callbacks) to
// dispatch its status meta. Single active editor at a time.
let activeView: EditorView | null = null;
let probeObserver: IntersectionObserver | null = null;

function getProbeObserver(): IntersectionObserver | null {
  if (probeObserver) return probeObserver;
  if (typeof IntersectionObserver === "undefined") return null;
  probeObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const img = entry.target as HTMLImageElement;
        if (!img.isConnected) {
          probeObserver?.unobserve(img);
          continue;
        }
        if (entry.isIntersecting) {
          const src = img.dataset.probeSrc;
          if (src) probe(src);
          probeObserver?.unobserve(img);
        }
      }
    },
    { root: null, rootMargin: "200px", threshold: 0 },
  );
  return probeObserver;
}

// Called from decorations.buildWidget for each rendered image widget.
// Observes the <img>; once it nears the viewport (or on first paint for an
// already-visible image) it probes that src once, then unobserves.
export function registerImageProbe(img: HTMLElement): void {
  getProbeObserver()?.observe(img);
}

function probe(src: string): void {
  if (imageLoadStatus.has(src)) return;
  imageLoadStatus.set(src, "loading");
  const probeImg = new Image();
  const finish = (status: LoadStatus): void => {
    if (!activeView) return;
    imageLoadStatus.set(src, status);
    // setMeta-only tx: nothing in doc changes, but state.apply runs
    // for normalize+decorations and the per-span editMode flag re-
    // evaluates with the new status.
    activeView.dispatch(activeView.state.tr.setMeta(IMAGE_LOAD_META, status));
  };
  probeImg.onload = (): void => finish("ok");
  probeImg.onerror = (): void => finish("error");
  // Resolve relative paths to asset protocol URLs so the probe actually
  // loads the image, but track status by original src so normalize's scan
  // can look it up correctly.
  const documentDir = activeView ? getDocumentDir(activeView.state) : null;
  const resolved = getEditorHost().resolveImageSrc(src, documentDir);
  probeImg.src = resolved ?? src;
}

// Keeps the module-level activeView in sync so probe() can dispatch its status
// meta to the right editor.
function imageLoadProbePlugin(): Plugin {
  return new Plugin({
    view(editorView) {
      activeView = editorView;
      return {
        destroy: () => {
          if (activeView === editorView) activeView = null;
        },
      };
    },
  });
}

function imageFileInputPlugin(): Plugin {
  return new Plugin({
    view(editorView) {
      const onPick = (e: Event): void => {
        const evt = e as CustomEvent<{ files: FileList | null }>;
        const trigger = evt.target as HTMLElement | null;
        if (!trigger?.classList?.contains("file-input")) return;
        const file = evt.detail?.files?.[0];
        if (!file) return;
        const posStr = trigger.getAttribute("data-pos");
        if (!posStr) return;
        const pos = Number(posStr);
        if (!Number.isFinite(pos)) return;
        // Use a blob URL instead of a base64 data URL — base64 dumps tens
        // of KB into the doc text per image, which is unreadable in the
        // source view and bloats the transaction. blob URLs are short,
        // session-scoped, and load directly into <img>. (Persisting across
        // reloads is a separate problem — out of scope for the pilot.)
        const url = URL.createObjectURL(file);
        editorView.dispatch(editorView.state.tr.insertText(url, pos));
      };
      editorView.dom.addEventListener("file-input-pick", onPick);
      return {
        destroy(): void {
          editorView.dom.removeEventListener("file-input-pick", onPick);
        },
      };
    },
  });
}

function closeDelimText(mark: Mark): string {
  const src = String(mark.attrs.src ?? "");
  const title = mark.attrs.title as string | null;
  return title
    ? `](${src} "${title.replace(/"/g, '\\"')}")`
    : `](${src})`;
}

export const image: FeatureSpec = {
  name: "image",

  marks: {
    image: {
      attrs: {
        src: { default: "" },
        title: { default: null },
      },
      inclusive: false,
      // toDOM/parseDOM must be a stable round-trip: PM's mutation observer
      // re-reads the DOM after every transaction, and if a toDOM-produced
      // element doesn't match any parseDOM rule, the mark is silently
      // dropped — normalize then re-applies it next tick, infinite loop.
      // We use a distinct `data-image-mark` marker so it can't collide
      // with anything else.
      parseDOM: [
        {
          tag: "span[data-image-mark]",
          getAttrs: (el) => ({
            src: (el as HTMLElement).getAttribute("data-src") ?? "",
            title: (el as HTMLElement).getAttribute("data-title"),
          }),
        },
      ],
      toDOM: (mark) => {
        const { src, title } = mark.attrs as { src: string; title: string | null };
        const attrs: Record<string, string> = { "data-image-mark": "" };
        if (src) attrs["data-src"] = src;
        if (title) attrs["data-title"] = title;
        return ["span", attrs, 0];
      },
    },
  },

  parserTokens: {
    image: (state, tok, schema) => {
      // Same as links: markdown-it percent-encodes non-ASCII in src at parse
      // time; decode it back so Chinese file paths survive the save round-trip.
      const src = decodeNonAscii(tok.attrGet("src") ?? "");
      const title = tok.attrGet("title");
      // tok.content is the alt text (md-it joins child token text).
      const alt = tok.content;
      state.addText("![");
      state.openMark(schema.marks.image.create({ src, title: title || null }));
      state.addText(alt);
      state.closeMarkType(schema.marks.image);
      state.addText(
        title ? `](${src} "${title}")` : `](${src})`,
      );
    },
  },

  markDelims: {
    image: { open: "", close: "" },
  },

  plugins: () => [imageFileInputPlugin(), imageLoadProbePlugin()],

  inline: {
    markNames: ["image"],
    extRanges: (parent) => {
      const ranges: Array<[number, number]> = [];
      const imageType = parent.type.schema.marks.image;
      if (!imageType) return ranges;
      let start = -1;
      let currentMark: Mark | null = null;
      let off = 0;
      const flush = (end: number): void => {
        if (start < 0 || !currentMark) return;
        // open delim is `![` (2 chars), close varies.
        ranges.push([start - 2, end + closeDelimText(currentMark).length]);
        start = -1;
        currentMark = null;
      };
      parent.forEach((child) => {
        if (child.isText) {
          const m = child.marks.find((mk) => mk.type === imageType) ?? null;
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

// Test hook — lets tests assert the probe stays idle until an image nears the
// viewport (regression guard: no eager full-doc probing on mount).
export function __getImageLoadStatus(): ReadonlyMap<string, LoadStatus> {
  return imageLoadStatus;
}
