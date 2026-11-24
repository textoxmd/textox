import { beforeEach, describe, expect, it } from "vitest";
import { resetExtensionPointsForTests } from "@texto/plugin-sdk";

import { resetFeaturesForTests } from "../../src/features/index.ts";
import { parseInline } from "../../src/inline-parse.ts";
import { parse, resetParserForTests } from "../../src/parser.ts";
import { resetSchemaForTests } from "../../src/schema.ts";
import { resetSerializerForTests, serialize } from "../../src/serializer.ts";

// emoji 支持已迁到 official-plugins/emoji，经 `markdown-editor:syntaxFeature`
// 贡献。这里显式重置，验证「插件未注册」时的降级：没有 emoji 的 md-it 规则 ⇒
// 定位层没有 `emoji` token 可认领 ⇒ `:name:` 作为普通文本保留、往返稳定。
describe("emoji: disabled fallback (plugin not registered)", () => {
  beforeEach(() => {
    resetExtensionPointsForTests();
    resetFeaturesForTests();
    resetSchemaForTests();
    resetParserForTests();
    resetSerializerForTests();
  });

  it("inline scan produces no emoji spans without the plugin", () => {
    expect(parseInline("hello :smile: world")).toEqual([]);
  });

  it("shortcode stays literal text without loss and round-trips stably", () => {
    const src = "a :smile: b\n";
    const doc = parse(src);
    expect(doc.firstChild!.type.name).toBe("paragraph");
    expect(doc.textContent).toContain(":smile:");
    const doc2 = parse(serialize(doc));
    expect(doc.eq(doc2)).toBe(true);
  });
});
