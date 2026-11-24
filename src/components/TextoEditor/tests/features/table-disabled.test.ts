import { beforeEach, describe, expect, it } from "vitest";
import { resetExtensionPointsForTests } from "@texto/plugin-sdk";

import { resetFeaturesForTests } from "../../src/features/index.ts";
import { parse, resetParserForTests } from "../../src/parser.ts";
import { resetSchemaForTests } from "../../src/schema.ts";
import { resetSerializerForTests, serialize } from "../../src/serializer.ts";

// 表格支持已迁到 official-plugins/table，经 `markdown-editor:syntaxFeature`
// 贡献。全局 plugins-setup 会注册该插件；这里显式重置，验证「插件未注册」
// 时的降级路径：裸管道表格作为普通段落文本保留，内容不丢、往返稳定。
describe("table: disabled fallback (plugin not registered)", () => {
  beforeEach(() => {
    resetExtensionPointsForTests();
    resetFeaturesForTests();
    resetSchemaForTests();
    resetParserForTests();
    resetSerializerForTests();
  });

  it("bare pipe table degrades to paragraph text without loss", () => {
    const src = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    const doc = parse(src);
    // 无 table 节点 → 首个块是普通段落；内容（含正文行）全部保留。
    expect(doc.firstChild!.type.name).toBe("paragraph");
    expect(doc.textContent).toContain("a");
    expect(doc.textContent).toContain("b");
    expect(doc.textContent).toContain("1");
    expect(doc.textContent).toContain("2");
    // round-trip 稳定、无内容丢失
    const doc2 = parse(serialize(doc));
    expect(doc.eq(doc2)).toBe(true);
  });
});
