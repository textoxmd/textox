import { describe, expect, it } from "vitest";
import {
  cursorToOffset,
  offsetRangeToCursor,
  offsetToCursor,
  rangeToOffsets,
} from "../../src/history/cursor";

describe("光标换算", () => {
  const md = "# a\n\nhello\nworld";

  it("offset → 行/列", () => {
    expect(offsetToCursor(md, 0)).toEqual({ line: 1, col: 0 });
    expect(offsetToCursor(md, 5)).toEqual({ line: 3, col: 0 });
    expect(offsetToCursor(md, md.length)).toEqual({ line: 4, col: 5 });
  });

  it("offset 负值/超长夹取", () => {
    expect(offsetToCursor(md, -5)).toEqual({ line: 1, col: 0 });
    expect(offsetToCursor(md, md.length + 99)).toEqual({ line: 4, col: 5 });
  });

  it("行/列 → offset", () => {
    expect(cursorToOffset(md, { line: 3, col: 2 })).toBe(7);
    expect(cursorToOffset(md, { line: 4, col: 99 })).toBe(md.length);
    expect(cursorToOffset(md, { line: 99, col: 0 })).toBe(md.length);
  });

  it("范围换算", () => {
    const md2 = "a\r\nb";
    // 约定：\r 也计入列宽，行边界只由 \n 决定。
    expect(offsetToCursor(md2, 0)).toEqual({ line: 1, col: 0 });
    expect(offsetToCursor(md2, 1)).toEqual({ line: 1, col: 1 });
    expect(offsetToCursor(md2, 3)).toEqual({ line: 2, col: 0 });
    expect(offsetRangeToCursor(md2, 0, 3)).toEqual({
      anchor: { line: 1, col: 0 },
      head: { line: 2, col: 0 },
    });
    expect(
      rangeToOffsets(md2, {
        anchor: { line: 1, col: 0 },
        head: { line: 2, col: 0 },
      }),
    ).toEqual({ anchor: 0, head: 3 });
  });
});
