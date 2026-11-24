import type { TextPatch } from "./types";

const GROUP_MS = 500;
export { GROUP_MS };

function isHigh(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLow(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** index 是否落在一对 surrogate 之间。 */
function splitsPair(text: string, index: number): boolean {
  return (
    index > 0 &&
    index < text.length &&
    isHigh(text.charCodeAt(index - 1)) &&
    isLow(text.charCodeAt(index))
  );
}

/**
 * 返回把 from 变成 to 的最小单区间替换。
 * 前缀按 UTF-16 代理对边界回退；后缀按码点对齐比较，
 * 保证补丁两端都不落在一个代理对中间，`applyPatch` 结果始终合法。
 */
export function diffPatch(from: string, to: string): TextPatch {
  if (from === to) return { from: 0, to: 0, insert: "" };

  const max = Math.min(from.length, to.length);
  let start = 0;
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) {
    start += 1;
  }

  let endFrom = from.length;
  let endTo = to.length;
  while (endFrom > start && endTo > start) {
    const fromWidth =
      endFrom >= 2 &&
      isLow(from.charCodeAt(endFrom - 1)) &&
      isHigh(from.charCodeAt(endFrom - 2))
        ? 2
        : 1;
    const toWidth =
      endTo >= 2 &&
      isLow(to.charCodeAt(endTo - 1)) &&
      isHigh(to.charCodeAt(endTo - 2))
        ? 2
        : 1;
    if (fromWidth !== toWidth) break;
    if (
      from.slice(endFrom - fromWidth, endFrom) !==
      to.slice(endTo - toWidth, endTo)
    ) {
      break;
    }
    endFrom -= fromWidth;
    endTo -= toWidth;
  }

  while (start > 0 && (splitsPair(from, start) || splitsPair(to, start))) {
    start -= 1;
  }

  return { from: start, to: endFrom, insert: to.slice(start, endTo) };
}

export function applyPatch(md: string, patch: TextPatch): string {
  return md.slice(0, patch.from) + patch.insert + md.slice(patch.to);
}
