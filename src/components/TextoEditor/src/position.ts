import type { Node as PMNode } from "prosemirror-model";
import { serialize } from "./serializer.ts";

// IR/SV 之间位置映射的统一实现。
//
// 核心原语：PM 文档位置 <-> 序列化 markdown 字符偏移。
// 所有方向（enterSource/exitSource、IR<->SV 光标保持、大纲行号）共用同一对
// posToMdOffset / mdOffsetToPos，保证双向一致。
// 与 parse(md.slice(0, offset)).content.size（旧 exitSource 方案）相比，
// mdOffsetToPos 是 posToMdOffset 的精确逆，块边界处不再错位。

// 整篇 canonical markdown 按 doc 身份缓存：一次按键里 posToLineCol 会先要全文、
// 再要前缀，而 serialize 是 O(全文)；doc 不可变、每次编辑都是新对象，身份缓存
// 不会读到过期内容。以前一次按键要整篇序列化 3~6 次（大文档可见卡顿）。
let mdCache: { doc: PMNode; md: string } | null = null;

export function docMarkdown(doc: PMNode): string {
  if (mdCache && mdCache.doc === doc) return mdCache.md;
  const md = serialize(doc);
  mdCache = { doc, md };
  return md;
}

/** PM 文档位置 → 序列化 markdown 字符偏移（精确，含代码块） */
export function posToMdOffset(doc: PMNode, pos: number): number {
  return posToMdOffsetIn(doc, pos, docMarkdown(doc));
}

function posToMdOffsetIn(doc: PMNode, pos: number, fullMd: string): number {
  const docSize = doc.content.size;
  const clamped = Math.max(0, Math.min(pos, docSize));
  const fullLen = fullMd.length;
  // 文档末尾的前缀就是全文，不必再序列化一遍 cut。
  let len = clamped === docSize ? fullLen : serialize(doc.cut(0, clamped)).length;
  try {
    const $r = doc.resolve(clamped);
    if ($r.parent.type.name === "code_block") {
      const textLen = $r.parent.textContent.length;
      const rel = clamped - $r.start($r.depth) - 1;
      if (rel < textLen) len -= 4; // 截断代码块时 serializer 会补全闭合围栏 "\n```"
    } else if ($r.parent.isTextblock && $r.parentOffset === 0 && clamped > 0 && clamped < docSize) {
      // 文本块内容起点：cut 出来的前缀会把「上一块之后、本块之前的空行分隔」丢掉
      // （空块在整篇序列化里不占长度），导致该位置少算到上一块末尾。
      // 全文里这段分隔只可能是换行，补回到下一条真实的字符为止。
      while (len < fullLen && fullMd.charCodeAt(len) === 10) len += 1;
    }
  } catch {
    // fall through
  }
  return Math.min(len, fullLen);
}

/** markdown 字符偏移 → PM 文档位置（posToMdOffset 的单调逆，二分求最小 pos） */
export function mdOffsetToPos(doc: PMNode, offset: number): number {
  const docSize = doc.content.size;
  const fullLen = docMarkdown(doc).length;
  const target = Math.max(0, Math.min(offset, fullLen));
  let lo = 0;
  let hi = docSize;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (posToMdOffset(doc, mid) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** PM 文档位置 → markdown 行（1 起）与列（0 起） */
export function posToLineCol(doc: PMNode, pos: number): { line: number; col: number } {
  const md = docMarkdown(doc);
  const off = posToMdOffsetIn(doc, pos, md);
  // 单趟扫到目标偏移即可：原来的 md.slice(0, off).split("\n") 会为整段前缀
  // 分配一个子串 + 一个行数组，长文档下纯粹是 GC 压力。
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < off; i += 1) {
    if (md.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, col: off - lineStart };
}

/** markdown 行（1 起）与列（0 起）→ PM 文档位置 */
export function lineColToPos(doc: PMNode, line: number, col: number): number {
  const md = docMarkdown(doc);
  let start = 0;
  for (let i = 1; i < line; i++) {
    const nl = md.indexOf("\n", start);
    if (nl === -1) break;
    start = nl + 1;
  }
  const target = Math.min(start + Math.max(0, col), md.length);
  return mdOffsetToPos(doc, target);
}

/** 标题节点位置 → 所在 markdown 行号（1 起）。pos+1 进入标题块，落在标题行而非前一块。 */
export function headingPosToLine(doc: PMNode, pos: number): number {
  return posToLineCol(doc, pos + 1).line;
}
