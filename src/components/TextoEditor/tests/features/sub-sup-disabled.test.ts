import { beforeEach, describe, expect, it } from "vitest";
import { resetExtensionPointsForTests } from "@texto/plugin-sdk";

import { resetFeaturesForTests } from "../../src/features/index.ts";
import { parseInline } from "../../src/inline-parse.ts";
import { parse, resetParserForTests } from "../../src/parser.ts";
import { resetSchemaForTests } from "../../src/schema.ts";
import { resetSerializerForTests, serialize } from "../../src/serializer.ts";

// sub-sup 支持已迁到 official-plugins/sub-sup，经 `markdown-editor:syntaxFeature`
// 贡献。全局 plugins-setup 会注册该插件；这里显式重置，验证「插件未注册」时的
// 降级：没有 `sub_*` / `sup_*` 的 md-it 规则 ⇒ 定位层没有 token 可认领 ⇒
// `~x~`/`^x^` 作为普通文本保留、往返稳定。
describe("sub-sup: disabled fallback (plugin not registered)", () => {
  beforeEach(() => {
    resetExtensionPointsForTests();
    resetFeaturesForTests();
    resetSchemaForTests();
    resetParserForTests();
    resetSerializerForTests();
  });

  it("inline scan produces no sub/sup spans without the plugin", () => {
    expect(parseInline("H~2~O")).toEqual([]);
    expect(parseInline("E=mc^2^")).toEqual([]);
  });

  it("single-tilde / single-caret stay literal text without loss", () => {
    const src = "H~2~O and E=mc^2^\n";
    const doc = parse(src);
    // 无 sub/sup 节点：内容以普通段落文本保留。
    expect(doc.firstChild!.type.name).toBe("paragraph");
    expect(doc.textContent).toContain("H~2~O");
    expect(doc.textContent).toContain("E=mc^2^");
    // round-trip 稳定、无内容丢失
    const doc2 = parse(serialize(doc));
    expect(doc.eq(doc2)).toBe(true);
  });
});
