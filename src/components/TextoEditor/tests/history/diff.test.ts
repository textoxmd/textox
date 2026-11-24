import { describe, expect, it } from "vitest";
import { applyPatch, diffPatch } from "../../src/history/diff";

function isHigh(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLow(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function splitsPair(text: string, index: number): boolean {
  return (
    index > 0 &&
    index < text.length &&
    isHigh(text.charCodeAt(index - 1)) &&
    isLow(text.charCodeAt(index))
  );
}

describe("diffPatch / applyPatch", () => {
  it("相同字符串返回空补丁", () => {
    expect(diffPatch("abc", "abc")).toEqual({ from: 0, to: 0, insert: "" });
  });

  it("末尾插入", () => {
    const p = diffPatch("abc", "abcd");
    expect(p).toEqual({ from: 3, to: 3, insert: "d" });
    expect(applyPatch("abc", p)).toBe("abcd");
  });

  it("中间删除", () => {
    const p = diffPatch("abcdef", "abef");
    expect(applyPatch("abcdef", p)).toBe("abef");
  });

  it("中间删除返回最小单区间", () => {
    expect(diffPatch("abcdef", "abef")).toEqual({ from: 2, to: 4, insert: "" });
  });

  it("整体替换", () => {
    const p = diffPatch("old", "new");
    expect(applyPatch("old", p)).toBe("new");
  });

  it("不切断 surrogate pair", () => {
    const from = "a😀b";
    const to = "a😃b";
    const p = diffPatch(from, to);
    expect(applyPatch(from, p)).toBe(to);
    expect(p.insert).toBe("😃");
  });

  it.each([
    ["abc😀", "abc𝈀"],
    ["😀", "𝈀"],
    ["🀀", "🐀"],
    ["x🀀y", "x🐀y"],
  ])("高位代理不同、低位相同时也可逆：%s → %s", (from, to) => {
    const patch = diffPatch(from, to);
    expect(applyPatch(from, patch)).toBe(to);
    expect(patch.from).toBeLessThanOrEqual(patch.to);
  });

  it("空串两侧", () => {
    expect(diffPatch("", "abc")).toEqual({ from: 0, to: 0, insert: "abc" });
    expect(diffPatch("abc", "")).toEqual({ from: 0, to: 3, insert: "" });
  });

  it("CRLF 文本可逆", () => {
    const from = "# a\r\n\r\nabc";
    const to = "# a\r\n\r\nabcd";
    expect(applyPatch(from, diffPatch(from, to))).toBe(to);
  });

  it("穷举小字母表可逆且不切断代理对", () => {
    const alphabet = [
      "",
      "a",
      "b",
      "😀",
      "😃",
      "𝈀",
      "🀀",
      "🐀",
      "a😀b",
      "\r\n",
    ];
    for (const from of alphabet) {
      for (const to of alphabet) {
        const patch = diffPatch(from, to);
        expect(applyPatch(from, patch), `${from} → ${to}`).toBe(to);
        expect(splitsPair(from, patch.from), `${from} → ${to} from`).toBe(false);
        expect(splitsPair(from, patch.to), `${from} → ${to} to`).toBe(false);
        expect(patch.from).toBeLessThanOrEqual(patch.to);
        // 尾部相等：补丁之外的后缀在两侧逐字一致。
        expect(from.slice(patch.to)).toBe(to.slice(patch.from + patch.insert.length));
      }
    }
  });
});
