import { openUrl } from '@tauri-apps/plugin-opener';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:/i;

/**
 * 结果正文里的链接是否应该呈现为可点击。
 *
 * 只接受能解析成绝对 URL 且协议为 http(s)/mailto 的链接；无显式 scheme 的
 * 相对链接（`#anchor` / `/docs` / `foo.md`）与其它协议（`javascript:` /
 * `file:` / `tel:` / `irc:` 等）一律忽略。点击与渲染共用这一判定，避免
 * 出现「看起来可点、点下去什么都不发生」的死链接。
 */
export function isClickableAgentLink(href: string): boolean {
  const value = href.trim();
  if (!ABSOLUTE_URL.test(value)) return false;
  try {
    return ALLOWED_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * 结果正文里的链接：只放行 http(s)/mailto，交给系统浏览器。
 * 其它协议与无法解析的 URL 静默忽略。
 */
export function openAgentLink(href: string): void {
  const value = href.trim();
  if (!isClickableAgentLink(value)) return;
  const url = new URL(value);
  void openUrl(url.toString()).catch(() => {});
}
