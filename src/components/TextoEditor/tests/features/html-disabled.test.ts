import { beforeEach, describe, expect, it } from "vitest";
import { resetExtensionPointsForTests } from "@texto/plugin-sdk";

import { resetFeaturesForTests } from "../../src/features/index.ts";
import { parse, resetParserForTests } from "../../src/parser.ts";
import { resetSchemaForTests } from "../../src/schema.ts";
import { resetSerializerForTests, serialize } from "../../src/serializer.ts";

// HTML 支持已迁到 official-plugins/html，经 `markdown-editor:syntaxFeature`
// 贡献。全局 plugins-setup 会注册该插件；这里显式重置，验证「插件未注册」
// 时的降级路径：裸 HTML 作为普通段落文本保留，内容不丢、往返稳定。
describe("html-block: disabled fallback (plugin not registered)", () => {
  beforeEach(() => {
    resetExtensionPointsForTests();
    resetFeaturesForTests();
    resetSchemaForTests();
    resetParserForTests();
    resetSerializerForTests();
  });

  it("content degrades to paragraph and is not lost", () => {
    const doc = parse("<div>\ncontent\n</div>\n\npara");
    // 无 html_block 节点 → 首个块是普通段落，内容保留
    expect(doc.firstChild!.type.name).toBe("paragraph");
    expect(doc.firstChild!.textContent).toContain("<div>");
    expect(doc.textContent).toContain("content");
    // round-trip 稳定、无内容丢失
    const doc2 = parse(serialize(doc));
    expect(doc.eq(doc2)).toBe(true);
  });
});
