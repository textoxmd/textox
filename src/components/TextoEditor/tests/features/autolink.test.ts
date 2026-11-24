import { describe, expect, it } from "vitest";
import type { Node as PMNode } from "prosemirror-model";

// 先以 schema 为入口加载特性图，再直接引入特性模块。反过来（特性模块作为
// 入口）会踩到 `features/index` ↔ 特性模块的循环初始化，`BUILTIN_FEATURES`
// 捕获到尚未初始化的 `undefined`。
import { getSchema } from "../../src/schema.ts";
import { autoLink } from "../../src/features/auto-link.ts";
import { runFeatureCases } from "../utils.ts";
import { autolinkSpecs } from "../../specs/features/autolink.specs.ts";

runFeatureCases(autolinkSpecs);

function deriveOf(
  text: string,
  consumed = new Uint8Array(text.length),
  parentBlock: PMNode | null = null,
) {
  return autoLink.inline!.derive!({
    text,
    tokens: [],
    parentBlock,
    consumed,
    isConsumed: () => false,
    warn: () => {},
  });
}

/** A `link_def` block; its `ref_url` text must not become a bare link. */
function linkDef(): PMNode {
  const schema = getSchema();
  return schema.nodes.link_def.createChecked(null, [
    schema.nodes.ref_label.create(null, [schema.text("s")]),
    schema.nodes.ref_url.create(null, [schema.text("http://x.com")]),
    schema.nodes.ref_title.create(null),
  ]);
}

describe("auto-link derive", () => {
  it("goes through the v2 derive seam at order 3.1", () => {
    expect(autoLink.inline?.order).toBe(3.1);
    expect(typeof autoLink.inline?.derive).toBe("function");
  });

  it("claims a bare URL as an opaque span (whole range consumed)", () => {
    const text = "see https://x.com. ok";
    const consumed = new Uint8Array(text.length);

    const spans = deriveOf(text, consumed);

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      type: "autolink",
      from: 4,
      to: 17,
      openFrom: 4,
      openTo: 4,
      closeFrom: 17,
      closeTo: 17,
      attrs: { href: "https://x.com" },
      opaque: true,
    });
    // 旧 scan 整段 markConsumed；derive 由 `opaque` 表达同一占用。
    expect(consumed.slice(4, 17)).toEqual(new Uint8Array(13).fill(1));
    expect(consumed[3]).toBe(0);
    expect(consumed[17]).toBe(0);
  });

  it("yields nothing inside a link_def block", () => {
    const text = "http://x.com";
    expect(deriveOf(text, new Uint8Array(text.length), linkDef())).toEqual([]);
  });

  it("yields nothing for a `[label]: url` draft paragraph", () => {
    const text = "[s]: http://x.com";
    expect(deriveOf(text)).toEqual([]);
  });
});
