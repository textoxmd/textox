// 链接/图片目标的百分号解码工具。
//
// markdown-it 在解析目标时会把非 ASCII 字符 percent-encode（`中文.md` →
// `%E4%B8%AD...`），若原样写回文档会污染源文。这里把「整段都是百分号编码」
// 的片段还原成原文；纯 ASCII 转义（如 `%20`）保持不动。
//
// 独立成叶子模块：`link.ts` 与定位层（`inline-derive.ts`）都要用，放在
// link.ts 里会让定位层依赖具体的行内 feature。

export function decodeNonAscii(text: string): string {
  return text.replace(/(%[0-9A-Fa-f]{2})+/g, (match) => {
    const bytes = match.split("%").filter(Boolean).map((s) => parseInt(s, 16));
    if (bytes.some((b) => b > 127)) {
      try { return decodeURIComponent(match); } catch { return match; }
    }
    return match;
  });
}
