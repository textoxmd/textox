// Typora-flavoured inline parser — thin orchestration layer.
//
// Inline spans come entirely from two sources:
//
//   1. the core token walk in `features/inline-derive.ts` — the authority for
//      text / em / strong / strike / code / link / image / autolink / breaks;
//   2. each feature's `derive(ctx)` — plugins map positioned tokens (or the raw
//      text) to spans without touching the engine's ownership map.
//
// Shared utilities (`markConsumed`, `markExtRanges`) live in
// `@texto/markdown-editor-runtime`; this module re-exports them so feature
// modules keep importing them from here.

import type { Node as PMNode } from "prosemirror-model";

import {
  markConsumed,
  markExtRanges,
  type InlineSpan,
} from "@texto/markdown-editor-runtime";
import {
  collectDeriveFeatures,
  collectTokenAdvances,
} from "./features/index.ts";
import { deriveInline, type InlineDerivation } from "./features/inline-derive.ts";

// Re-export the migrated primitives to preserve this module's public API.
export { markConsumed, markExtRanges };
export type { InlineSpan };

// Orchestration. `parentBlock` is the textblock's parent node (e.g. a
// list_item or doc) — passed through so block-context-sensitive derives
// can introspect (e.g. auto-link skips `link_def` blocks).
export function parseInlineWith(
  text: string,
  parentBlock: PMNode | null = null,
): { spans: InlineSpan[]; atoms: InlineDerivation["atoms"]; consumed: Uint8Array } {
  return deriveInline(text, {
    tokenAdvances: collectTokenAdvances(),
    features: collectDeriveFeatures(),
    parentBlock,
  });
}

export function parseInline(
  text: string,
  parentBlock: PMNode | null = null,
): InlineSpan[] {
  return parseInlineWith(text, parentBlock).spans;
}
