// 标题原始 Markdown → 大纲里实际可见的纯文本。
//
// 只去语法标记，不做富文本渲染。区间来源与编辑器隐藏标记的逻辑一致：
// `parseInline` 给出的 open/close 分隔符、显式 delimRanges 都是不可见字符；
// delimRanges 与内容区间重合的部分必须保留（图片 alt、公式 LaTeX、转义字符本身），
// 严格落在内容内部的区间则整体隐藏（脚注引用 `[^1]` 的 `[^` / `]`）。
// widget 提供的 glyph 是该 token 的可见表示（如 emoji），整段替换为 glyph。
// 解析失败或未识别语法回退原文，避免误伤。
//
// 已知限制：参考式链接/图片（`[a][ref]`、`![alt][img]`）依赖文档级 ref 定义，
// 单行 `parseInline` 拿不到，因此保留原文。

import { parseInline } from './inline-parse.ts';

const CACHE_LIMIT = 1000;
const cache = new Map<string, string>();

interface Range {
  from: number;
  to: number;
}

/** 从 range 中减去 cut，返回剩下的可见片段。 */
function subtractRange(range: Range, cut: Range): Range[] {
  if (range.to <= cut.from || range.from >= cut.to) return [range];

  const parts: Range[] = [];
  if (range.from < cut.from) parts.push({ from: range.from, to: cut.from });
  if (range.to > cut.to) parts.push({ from: cut.to, to: range.to });
  return parts;
}

function cacheResult(raw: string, value: string): string {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(raw, value);
  return value;
}

export function outlinePlainText(raw: string): string {
  if (raw.length === 0) return '';

  const cached = cache.get(raw);
  if (cached !== undefined) return cached;

  let spans: ReturnType<typeof parseInline>;
  try {
    spans = parseInline(raw);
  } catch {
    return cacheResult(raw, raw);
  }

  if (spans.length === 0) return cacheResult(raw, raw);

  const invisible = new Uint8Array(raw.length);
  const hide = (from: number, to: number) => {
    const start = Math.max(0, Math.min(raw.length, from));
    const end = Math.max(0, Math.min(raw.length, to));
    for (let i = start; i < end; i += 1) invisible[i] = 1;
  };

  // widget 提供的 glyph 是该 token 的可见表示（如 emoji），不能靠「去掉分隔符」
  // 得到，这里单独记下位置并整段替换。
  const glyphAt = new Map<number, { glyph: string; to: number }>();

  for (const span of spans) {
    hide(span.openFrom, span.openTo);
    hide(span.closeFrom, span.closeTo);

    for (const range of span.delimRanges ?? []) {
      const strictlyInside =
        range.from >= span.from &&
        range.to <= span.to &&
        (range.from > span.from || range.to < span.to);
      if (strictlyInside && !range.softInside) {
        hide(range.from, range.to);
        continue;
      }
      for (const visible of subtractRange(range, span)) {
        hide(visible.from, visible.to);
      }
    }

    const glyphWidget = span.widgetDecorations?.find(
      (widget) => typeof widget.attrs?.glyph === 'string',
    );
    const glyph = glyphWidget?.attrs?.glyph;
    if (typeof glyph === 'string') {
      glyphAt.set(span.from, { glyph, to: span.to });
    }
  }

  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const glyphEntry = glyphAt.get(i);
    if (glyphEntry) {
      out += glyphEntry.glyph;
      i = Math.max(i, glyphEntry.to - 1);
      continue;
    }
    if (invisible[i] === 0) out += raw[i];
  }

  return cacheResult(raw, out);
}
