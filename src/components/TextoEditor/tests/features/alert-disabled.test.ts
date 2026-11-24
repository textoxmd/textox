import { beforeEach, describe, expect, it } from "vitest";
import { resetExtensionPointsForTests } from "@texto/plugin-sdk";

import { resetFeaturesForTests } from "../../src/features/index.ts";
import { parse, resetParserForTests } from "../../src/parser.ts";
import { resetSchemaForTests } from "../../src/schema.ts";
import { resetSerializerForTests, serialize } from "../../src/serializer.ts";

// alert 已迁到 official-plugins/alert，经 `markdown-editor:syntaxFeature` 贡献。
// 全局 plugins-setup 会注册该插件；这里显式重置，验证「插件未注册」时的降级
// 路径：`[!NOTE]` 作为普通引用块文本保留，内容不丢、往返稳定。
describe("alert: disabled fallback (plugin not registered)", () => {
  beforeEach(() => {
    resetExtensionPointsForTests();
    resetFeaturesForTests();
    resetSchemaForTests();
    resetParserForTests();
    resetSerializerForTests();
  });

  it("degrades to a plain blockquote without losing content", () => {
    const doc = parse("> [!NOTE]\n> Hello\n");
    expect(doc.firstChild!.type.name).toBe("blockquote");
    expect(doc.textContent).toContain("[!NOTE]");
    expect(doc.textContent).toContain("Hello");
    const doc2 = parse(serialize(doc));
    expect(doc.eq(doc2)).toBe(true);
  });
});
