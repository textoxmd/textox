/**
 * URL 解码工具函数
 * 统一处理 URL 解码和 Punycode 域名解码
 */

import { toUnicode } from 'punycode.js';

/**
 * 解码 URL，包括 URL 编码和 Punycode 域名
 * @param encodedUrl - 编码后的 URL 字符串
 * @returns 解码后的 URL 字符串
 */
export function decodeUrl(encodedUrl: string): string {
  try {
    // 先解码 % 编码
    let decoded = decodeURIComponent(encodedUrl);
    // 再解码 Punycode 域名（如 xn--fiq228c -> 中文）
    const punycodePattern = /xn--[a-zA-Z0-9-]+/g;
    const punycodeMatches = decoded.match(punycodePattern);
    if (punycodeMatches) {
      for (const punycode of punycodeMatches) {
        try {
          const decodedPart = toUnicode(punycode);
          decoded = decoded.replace(punycode, decodedPart);
        } catch {
          // 解码失败，保留原样
        }
      }
    }
    return decoded;
  } catch {
    // 解码失败，返回原始值
    return encodedUrl;
  }
}
