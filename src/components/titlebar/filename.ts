/**
 * 标题栏文件名的「中间省略」拆分。
 *
 * 头段交给 CSS（`overflow: hidden` + `text-overflow: ellipsis`）在空间不足时省略，
 * 尾段固定宽度始终可见，从而得到「会议记录-2026…讨论稿-v3」式的结果。
 * 纯 CSS 方案，不做 JS 宽度测量。
 */

/** 尾段保留的字符数（按 Unicode code point 计） */
const FILENAME_TAIL_KEEP = 8;

interface FilenameParts {
  head: string;
  tail: string;
}

export function splitFilename(
  stem: string,
  tailKeep: number = FILENAME_TAIL_KEEP,
): FilenameParts {
  // 用 Array.from 而非 slice：按 code point 切分，emoji 等代理对不会被截断成半个。
  const chars = Array.from(stem);
  if (chars.length <= tailKeep) {
    return { head: '', tail: stem };
  }
  return {
    head: chars.slice(0, chars.length - tailKeep).join(''),
    tail: chars.slice(chars.length - tailKeep).join(''),
  };
}
