// Shared image load-status state + span presentation decoration.
//
// Leaf module: both the legacy `image.ts` scanner and the token-based locator
// (`inline-derive.ts`) attach the same widget/delim shape to an `image` span.
// Keeping it here avoids the locator depending on the concrete image feature
// (which would be a cycle) while sharing the per-src load result.

import type { InlineSpan } from "../inline-parse.ts";

export type LoadStatus = "loading" | "ok" | "error";

/** 按 src 记录加载结果；只有 "error" 会改变展示形态（其余乐观渲染）。 */
export const imageLoadStatus = new Map<string, LoadStatus>();

/** 通知编辑器重算装饰的 meta key。 */
export const IMAGE_LOAD_META = "image-load-status-changed";

/**
 * 给 image span 挂上与既有 `image.ts` scan 完全一致的展示钩子。
 * 只读 `imageLoadStatus`，不产生副作用。
 */
export function decorateImageSpan(
  span: InlineSpan,
  info: { src: string; alt: string; title: string | null; closeFrom: number; closeTo: number },
): void {
  const status = info.src === "" ? null : (imageLoadStatus.get(info.src) ?? null);
  const editMode = info.src === "" || status === "error";
  const widgets = span.widgetDecorations ?? [];
  if (!editMode) {
    span.delimRanges = [{ from: span.openFrom, to: span.closeTo, softInside: true }];
    widgets.push({
      pos: info.closeTo,
      when: "always",
      kind: "image-render",
      attrs: { src: info.src, alt: info.alt, ...(info.title ? { title: info.title } : {}) },
    });
  } else {
    span.delimRanges = [];
    widgets.push({ pos: info.closeFrom + 2, when: "always", kind: "file-input" });
  }
  span.widgetDecorations = widgets;
}
