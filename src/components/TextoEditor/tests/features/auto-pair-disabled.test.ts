import { beforeEach, describe, expect, it } from "vitest";
import { resetExtensionPointsForTests } from "@texto/plugin-sdk";
import { EditorState, TextSelection } from "prosemirror-state";

import {
  allFeatures,
  collectKeymaps,
  resetFeaturesForTests,
} from "../../src/features/index.ts";
import { resetParserForTests } from "../../src/parser.ts";
import { getSchema, resetSchemaForTests } from "../../src/schema.ts";
import { resetSerializerForTests } from "../../src/serializer.ts";

// auto-pair 支持已迁到 official-plugins/auto-pair，经 `markdown-editor:syntaxFeature`
// 贡献。这里显式重置，验证「插件未注册」时的降级：没有 auto_pair feature，
// 且 Backspace 不会把空配对 `[]` 作为一个整体删除。
describe("auto-pair: disabled fallback (plugin not registered)", () => {
  beforeEach(() => {
    resetExtensionPointsForTests();
    resetFeaturesForTests();
    resetSchemaForTests();
    resetParserForTests();
    resetSerializerForTests();
  });

  it("no auto_pair feature is registered without the plugin", () => {
    expect(allFeatures().some((f) => f.name === "auto_pair")).toBe(false);
  });

  it("Backspace does not clear an empty [] pair without the plugin", () => {
    const schema = getSchema();
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("[]")]),
    ]);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 2) });
    let next = state;
    const backspace = collectKeymaps(schema).Backspace;
    backspace?.(state, (tr) => {
      next = state.apply(tr);
    });
    // No auto-pair → the pair is not deleted as a unit.
    expect(next.doc.textContent).toBe("[]");
  });
});
