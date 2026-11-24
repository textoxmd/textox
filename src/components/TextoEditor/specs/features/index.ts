// Aggregation of every feature's test/spec data. Imported by:
//   - tests/utils.ts (runFeatureCases drives assertions)
//   - specs/pretty.ts (collectRenderCases feeds the DOM→pretty projection)
//
// Lib mode never imports anything under specs/, so cases + renderCases
// stay out of the editor bundle.

import type { Case, FeatureSpecs, RenderCase } from "../_types.ts";

import { autoLinkUrlSpecs } from "./auto-link-url.specs.ts";
import { autoPairSpecs } from "./auto-pair.specs.ts";
import { autolinkSpecs } from "./autolink.specs.ts";
import { blockquoteSpecs } from "./blockquote.specs.ts";
import { codeSpecs } from "./code.specs.ts";
import { emojiSpecs } from "./emoji.specs.ts";
import { emphasisSpecs } from "./emphasis.specs.ts";
import { fencedCodeSpecs } from "./fenced-code.specs.ts";
import { frontMatterSpecs } from "./front-matter.specs.ts";
import { headingSpecs } from "./heading.specs.ts";
import { headingTypeIndicatorSpecs } from "./heading-type-indicator.specs.ts";
import { highlightSpecs } from "./highlight.specs.ts";
import { hrSpecs } from "./hr.specs.ts";
import { inlineMathSpecs } from "./inline-math.specs.ts";
import { htmlCommentSpecs } from "./html-comment.specs.ts";
import { htmlBlockSpecs } from "./html-block.specs.ts";
import { htmlInlineSpecs } from "./html-inline.specs.ts";
import { imageSpecs } from "./image.specs.ts";
import { linkSpecs } from "./link.specs.ts";
import { listSpecs } from "./list.specs.ts";
import { refDefSpecs } from "./ref-def.specs.ts";
import { strikeSpecs } from "./strike.specs.ts";
import { subSupSpecs } from "./sub-sup.specs.ts";
import { tableSpecs } from "./table.specs.ts";
import { taskSpecs } from "./task.specs.ts";
import { tocSpecs } from "./toc.specs.ts";
import { underlineSpecs } from "./underline.specs.ts";

export const ALL_SPECS: FeatureSpecs[] = [
  htmlCommentSpecs,
  htmlBlockSpecs,
  htmlInlineSpecs,
  emojiSpecs,
  emphasisSpecs,
  codeSpecs,
  strikeSpecs,
  subSupSpecs,
  highlightSpecs,
  inlineMathSpecs,
  autolinkSpecs,
  autoLinkUrlSpecs,
  linkSpecs,
  imageSpecs,
  hrSpecs,
  blockquoteSpecs,
  headingSpecs,
  headingTypeIndicatorSpecs,
  taskSpecs,
  listSpecs,
  fencedCodeSpecs,
  frontMatterSpecs,
  refDefSpecs,
  tableSpecs,
  tocSpecs,
  underlineSpecs,
  autoPairSpecs,
];

export function collectRenderCases(): Record<string, RenderCase> {
  return Object.assign({}, ...ALL_SPECS.map((s) => s.renderCases ?? {}));
}

// Cases get namespaced by feature so ids stay unique across the app.
export function collectCases(): Array<Case & { feature: string }> {
  return ALL_SPECS.flatMap((s) =>
    (s.cases ?? []).map((c) => ({ ...c, feature: s.name })),
  );
}
