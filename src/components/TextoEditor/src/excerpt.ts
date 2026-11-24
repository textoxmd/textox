/** 摘要最大长度（软上限，优先在块/行/词边界截断） */
const EXCERPT_MAX_CHARS = 160;

/**
 * 智能截断：优先在块边界（空行）截断，其次行边界、词边界，避免截断半个词/块；
 * 截断后追加省略号，并确保不在代理对（emoji）中间切断。
 *
 * 纯函数、零依赖：骨架的大纲模块也要用它，避免把编辑器依赖链拉进纯文本路径。
 */
export function truncateExcerpt(md: string): string {
  // 统一去掉 CRLF 的 `\r`：调用方可能传入未经归一的原文（大纲扫描）。
  const clean = md.replace(/\r/g, '');
  if (clean.length <= EXCERPT_MAX_CHARS) return clean;
  const budget = EXCERPT_MAX_CHARS;
  let cut = clean.lastIndexOf('\n\n', budget);
  if (cut < budget * 0.5) cut = clean.lastIndexOf('\n', budget);
  if (cut < budget * 0.5) cut = clean.lastIndexOf(' ', budget);
  if (cut < budget * 0.5) cut = budget;
  // 避免在代理对中间切断（emoji 等）
  if (cut > 0 && cut < clean.length) {
    const c = clean.charCodeAt(cut - 1);
    if (c >= 0xd800 && c <= 0xdbff) cut -= 1;
  }
  return clean.slice(0, cut).trimEnd() + '…';
}
