// FeatureSpec — one file per Typora syntax.
//
// The contract itself lives in `@texto/markdown-editor-runtime` as the public
// `SyntaxFeature`; this module re-exports it under the editor's historical
// name so existing feature modules keep their import path unchanged.
//
// `TokenHandler` / `BlockHandler` / `SerializerMarkSpec` are the runtime
// handler-facing contracts, re-exported here for the same reason.

export type {
  SyntaxFeature as FeatureSpec,
  InlineFeatureSpec,
  InlineDecorationWidgetBuilder,
} from "@texto/markdown-editor-runtime";

export type { BlockHandler, SerializerMarkSpec, TokenHandler } from "@texto/markdown-editor-runtime";

export type {
  InlineDeriveContext,
  InlineDeriveFeature,
  PositionedToken,
  TokenAdvance,
} from "@texto/markdown-editor-runtime";
