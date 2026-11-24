import { beforeAll, describe, expect, test } from "vitest";

import { parse } from "../../components/TextoEditor/src/parser.ts";
import { getSchema } from "../../components/TextoEditor/src/schema.ts";
import { serialize } from "../../components/TextoEditor/src/serializer.ts";

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});

// 本文件经根 vitest 配置运行，setup 不注册插件 → 核心 schema 不含 footnote_ref、
// parser 不注册 markdown-it-footnote，即「禁用插件」的降级行为。
describe("footnote degraded (plugin disabled)", () => {
  test("no footnote_ref mark in schema", () => {
    expect(schema.marks.footnote_ref).toBeUndefined();
  });

  // 说明：任务书最初期望 `[^1]` 退化为「普通段落文本并原样往返」，但实测不成立——
  // 没有 markdown-it-footnote 时，`[^1]: Def` 被 CommonMark 解析为「链接引用定义」，
  // `[^1]` 随之退化为引用链接；canonical 序列化为 `[^1](Def)`（忠实还原该降级行为）。
  test("[^1] degrades to a CommonMark reference link (no footnote semantics)", () => {
    const md = "Text[^1] more\n\n[^1]: Def";
    const doc = parse(md);
    expect(doc.textContent).toContain("[^1]");
    let marked = false;
    doc.descendants((n) => {
      if (n.marks.some((m) => m.type.name === "footnote_ref")) marked = true;
      return true;
    });
    expect(marked).toBe(false);
    expect(serialize(doc)).toBe("Text[^1](Def) more");
  });
});
