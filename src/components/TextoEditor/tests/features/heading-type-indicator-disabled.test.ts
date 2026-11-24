import { beforeEach, describe, expect, it } from "vitest";
import { resetExtensionPointsForTests } from "@texto/plugin-sdk";

import { allFeatures, resetFeaturesForTests } from "../../src/features/index.ts";
import { resetParserForTests } from "../../src/parser.ts";
import { resetSchemaForTests } from "../../src/schema.ts";
import { resetSerializerForTests } from "../../src/serializer.ts";

// heading-type-indicator 已迁到 official-plugins/heading-type-indicator，经
// `markdown-editor:syntaxFeature` 贡献。它只贡献装饰，无解析/序列化足迹；这里
// 显式重置，验证「插件未注册」时该 feature 不存在（故无 H1–H6 指示）。
describe("heading-type-indicator: disabled fallback (plugin not registered)", () => {
  beforeEach(() => {
    resetExtensionPointsForTests();
    resetFeaturesForTests();
    resetSchemaForTests();
    resetParserForTests();
    resetSerializerForTests();
  });

  it("no heading-type-indicator feature is registered without the plugin", () => {
    expect(allFeatures().some((f) => f.name === "heading-type-indicator")).toBe(false);
  });
});
