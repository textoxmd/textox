import { expect, it } from "vitest";

import { parseInline } from "../../src/inline-parse.ts";
import { runFeatureCases } from "../utils.ts";
import { underlineSpecs } from "../../specs/features/underline.specs.ts";

runFeatureCases(underlineSpecs);

// `<u>…</u>` 是包裹式构造（`wrap`）：内容整体不再解析，但可以包住已有 mark ——
// 冲突检查只看 `<u>` / `</u>` 分隔符，故 `**b**` / `*x*` / `` `c` `` / `~x~` 都不
// 会挤掉下划线本身。
it("wraps existing inline marks without losing the underline", () => {
  for (const [src, inner] of [
    ["<u>**b**</u>", "strong"],
    ["<u>*x*</u>", "em"],
    ["<u>`c`</u>", "code"],
    ["<u>~x~</u>", "sub"],
  ] as const) {
    const spans = parseInline(src);
    expect(spans.some((s) => s.type === "underline"), src).toBe(true);
    expect(spans.some((s) => s.type === inner), src).toBe(true);
  }
});

it("wrap 记账挡住后续的脚注引用", () => {
  // underline（1.0）先于 footnote（1.1）；没有 `wrap` 的整段记账，脚注会
  // 钻进 `<u>` 内容里把它当成自己的引用。
  const spans = parseInline("<u>a[^1]</u>");
  expect(spans.some((s) => s.type === "underline")).toBe(true);
  expect(spans.some((s) => s.type === "footnote_ref")).toBe(false);
});
