import { describe, expect, test } from "vitest";

import { apply, pretty, setup } from "../utils.ts";

/** 从 seed 开始逐字符输入，返回最终 pretty。 */
function type(seed: string, chars: string): string {
  return pretty(apply(setup(seed), chars.split("")));
}

describe("emoji completion and escaped colons", () => {
  test("普通 `:sm` 打开补全", () => {
    expect(type("", ":sm")).toContain("<select />");
  });

  test("转义的 `\\:sm` 不打开补全", () => {
    expect(type("\\", ":sm")).not.toContain("<select />");
    expect(type("a \\", ":sm")).not.toContain("<select />");
  });

  test("偶数个反斜杠（`\\\\:sm`）冒号未转义，仍打开补全", () => {
    expect(type("\\\\", ":sm")).toContain("<select />");
  });

  test("转义冒号完整输入后不产生 emoji 字形", () => {
    expect(type("\\", ":smile:")).not.toContain("😄");
  });
});
