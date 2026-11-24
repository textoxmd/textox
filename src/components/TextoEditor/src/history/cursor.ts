import type { CursorPoint, CursorRange } from "./types";

export function offsetToCursor(md: string, offset: number): CursorPoint {
  const clamped = Math.max(0, Math.min(offset, md.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i += 1) {
    if (md.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, col: clamped - lineStart };
}

export function cursorToOffset(md: string, point: CursorPoint): number {
  let line = 1;
  let offset = 0;
  while (line < point.line && offset < md.length) {
    const next = md.indexOf("\n", offset);
    if (next < 0) return md.length;
    offset = next + 1;
    line += 1;
  }
  const lineEnd = md.indexOf("\n", offset);
  const end = lineEnd < 0 ? md.length : lineEnd;
  return Math.min(offset + Math.max(0, point.col), end);
}

export function rangeToOffsets(
  md: string,
  range: CursorRange,
): { anchor: number; head: number } {
  return {
    anchor: cursorToOffset(md, range.anchor),
    head: cursorToOffset(md, range.head),
  };
}

export function offsetRangeToCursor(
  md: string,
  anchor: number,
  head: number,
): CursorRange {
  return {
    anchor: offsetToCursor(md, anchor),
    head: offsetToCursor(md, head),
  };
}
