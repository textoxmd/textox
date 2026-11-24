import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';

import { serializeWithHeadingLines } from './serializer.ts';
import { truncateExcerpt } from './excerpt.ts';

export interface OutlineHeading {
  id: string;
  level: number;
  text: string;
  /** 去 Markdown 标记后的可见文本；由 app 层派生，编辑器提取时不填。 */
  displayText?: string;
  pos: number;
  line?: number; // 行号，用于源码模式跳转
  excerpt?: string; // 标题下方内容摘要（markdown，最多 160 字），用于悬浮预览渲染
}

/**
 * 从 markdown 按标题行号切出每个标题下方的内容摘要。
 * 保留完整块结构（列表/引用/段落等），供预览按 markdown 渲染。
 * headingLines 为每个标题在 markdown 中的 1 起行号。
 */
export function sliceExcerpts(md: string, headingLines: number[]): string[] {
  if (headingLines.length === 0) return [];
  // 行号 → 字符偏移用单调扫描求，避免 md.split('\n') 为每一行分配字符串
  // （长文档下这是大纲提取的主要开销之一）。headingLines 严格递增，因此
  // 下面按 (startLine + 1, nextLine) 顺序推进的行号也是非降的。
  let line = 1;
  let pos = 0;
  const offsetOf = (target: number): number => {
    while (line < target) {
      const nl = md.indexOf('\n', pos);
      if (nl === -1) {
        pos = md.length;
        line = target;
        break;
      }
      pos = nl + 1;
      line += 1;
    }
    return pos;
  };
  return headingLines.map((startLine, i) => {
    const nextLine = i + 1 < headingLines.length ? headingLines[i + 1]! : null;
    const from = offsetOf(startLine + 1);
    const to = nextLine === null ? md.length : offsetOf(nextLine);
    const content = md.slice(from, Math.max(from, to)).trim();
    return truncateExcerpt(content);
  });
}

/**
 * 从 ProseMirror 编辑器中提取标题列表。
 * 行号统一基于 serialize(doc) 计算（与 IR/SV 光标位置保持同一映射），
 * 避免用 markdown 行长度逼近 PM 位置导致的错位。
 */
export function extractHeadings(
  editorView: EditorView | null,
  headingLinesOverride?: number[] | null,
  markdownSource?: string,
): OutlineHeading[] {
  if (!editorView) return [];

  const doc = editorView.state.doc;

  // 保真模式：markdownSource 为 preserved 源，headingLinesOverride 与其行号一致，
  // 直接复用即可，避免 canonical 二次序列化。否则 canonical 单趟序列化同时取
  // md + 所有标题行号（与 doc 中标题同序），避免对每个标题各自 posToLineCol
  // 触发整篇序列化（O(n²)，标题多时大纲提取可达数百毫秒）。
  let md: string;
  let lines: number[];
  if (markdownSource !== undefined && headingLinesOverride) {
    md = markdownSource;
    lines = headingLinesOverride;
  } else {
    const result = serializeWithHeadingLines(doc);
    md = result.md;
    lines = result.lines;
  }

  const headings: OutlineHeading[] = [];
  let i = 0;
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      headings.push({
        id: `heading-${pos}`,
        level: node.attrs.level,
        text: node.textContent,
        pos: pos,
        line: lines[i] ?? 1,
        excerpt: '',
      });
      i++;
    }
    return true; // 继续遍历
  });

  // 摘要基于与行号同一份 md 切片（保真模式下即 preserved 源）。
  const excerpts = sliceExcerpts(md, lines);
  headings.forEach((heading, index) => {
    heading.excerpt = excerpts[index];
  });

  return headings;
}

/**
 * 事务是否可能影响标题（标题集合 / 层级 / 文本）。用于跳过「正文打字」时的
 * 整篇大纲重算：大文档下每次按键都会全文序列化 + 摘要切片，是可见卡顿。
 *
 * 判定保守：多步事务里 step 区间的坐标会漂移，直接按「可能影响」处理。
 */
export function transactionTouchesHeading(tr: Transaction): boolean {
  if (!tr.docChanged) return false;
  if (tr.steps.length !== 1) return true;
  const map = tr.mapping.maps[0];
  if (!map) return true;
  let hit = false;
  map.forEach((oldStart, oldEnd, newStart, newEnd) => {
    if (hit) return;
    // 旧文档侧覆盖「删除/合并/改文本」，新文档侧覆盖「段落被输入规则转成标题」。
    hit = rangeHasHeading(tr.before, oldStart, oldEnd) || rangeHasHeading(tr.doc, newStart, newEnd);
  });
  return hit;
}

function rangeHasHeading(doc: PMNode, from: number, to: number): boolean {
  const max = doc.content.size;
  // 折叠区间（打字）也要命中所在块：nodesBetween 会访问区间起点所在的子节点。
  const start = Math.max(0, Math.min(from, max));
  const end = Math.max(start, Math.min(to, max));
  let hit = false;
  doc.nodesBetween(start, end, (node) => {
    if (hit) return false;
    if (node.type.name === 'heading') {
      hit = true;
      return false;
    }
    return true;
  });
  return hit;
}

/** 链接/图片语法还原成标签文本：参考式链接会被解析器规范化为行内形式。 */
function normalizeHeadingText(text: string): string {
  const label = String.raw`((?:\\.|[^\]])*)`;
  const target = String.raw`\((?:[^()]|\([^()]*\))*\)`;
  return text
    .replace(/\r/g, '')
    .replace(new RegExp(String.raw`!\[${label}\]${target}`, 'g'), '$1')
    .replace(new RegExp(String.raw`\[${label}\]${target}`, 'g'), '$1')
    .replace(new RegExp(String.raw`!\[${label}\]\[[^\]]*\]`, 'g'), '$1')
    .replace(new RegExp(String.raw`\[${label}\]\[[^\]]*\]`, 'g'), '$1')
    .replace(/\[([^\]\n]+)\]/g, '$1')
    .trim();
}

/**
 * 找标题在文档中的位置：先原文精确匹配，再规范化精确匹配，最后规范化包含。
 * 供「按大纲跳转」使用（调用方只有标题文本、没有 ProseMirror pos）。
 */
export function findHeadingPosition(doc: PMNode, text: string): number | null {
  if (!text.trim()) return null;
  const headings: Array<{ pos: number; text: string }> = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') headings.push({ pos, text: node.textContent });
    return true;
  });
  const exact = headings.find((h) => h.text === text);
  if (exact) return exact.pos;
  const target = normalizeHeadingText(text);
  const normalized = headings.find((h) => normalizeHeadingText(h.text) === target);
  if (normalized) return normalized.pos;
  if (!target) return null;
  const partial = headings.find((h) => normalizeHeadingText(h.text).includes(target));
  return partial?.pos ?? null;
}
