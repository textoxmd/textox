import type Token from "markdown-it/lib/token.mjs";
import {
  alignUnits,
  endsWithEol,
  ensureEol,
  lineStarts,
  type BlockSpan,
  type SourcePreserveCollected,
  type SourcePreserveReconciler,
} from "@texto/markdown-editor-runtime";

import { tableCanonicalRows } from "./serialize";

// 表格行级源保真协调器。逐字迁移自核心
// `src/components/TextoEditor/src/source-preserve.ts` 的 `spliceTableRows` /
// `rowCellSplice` 与 `parseWithSource` 的 dividerRaw 算法；canonical 渲染由
// 核心注入的 `renderBlockCanon` 提供（插件不可 import 编辑器序列化器）。
//
// 语义：未编辑行复制原文，编辑行用整表 canonical 行替换，分隔行保持原文；
// 行内再做格级拼接，未变化的格保留原文对齐空格。无法安全拼接时返回 null，
// 由核心回退整块 canonical。

/**
 * 行内格级拼接：原始行与 canonical 行按 `|` 切分，未变化的格保留原文
 * 对齐空格，只有内容变化的格替换为 canonical 段。结构不一致时回退整行。
 */
function rowCellSplice(rawRow: string, canonRow: string): string {
  const rawTrim = rawRow.replace(/\r?\n$/, "");
  const eol = rawRow.slice(rawTrim.length);
  const rawCells = rawTrim.split("|").slice(1, -1);
  const canonCells = canonRow.split("|").slice(1, -1);
  if (rawCells.length !== canonCells.length || rawCells.length < 1) return canonRow;
  const out = rawCells.slice();
  for (let i = 0; i < rawCells.length; i++) {
    if (rawCells[i]!.trim() !== canonCells[i]!.trim()) out[i] = canonCells[i];
  }
  return "|" + out.join("|") + "|" + eol;
}

type Piece =
  | { kind: "raw"; i: number }
  | { kind: "canon"; text: string; idx: number }
  | { kind: "free"; text: string };

export const tableSourcePreserve: SourcePreserveReconciler = {
  nodeTypes: ["table"],

  collect(tokens, _rootSpans, matches) {
    const out: Array<SourcePreserveCollected | null> = new Array(matches.length).fill(null);
    let depth = 0;
    let tableDepth = 0;
    let idx = -1;
    let cur: BlockSpan[] | null = null;
    for (const t of tokens as readonly Token[]) {
      const isTableOpen = t.type === "table_open";
      const isTableClose = t.type === "table_close";
      if (isTableOpen) tableDepth++;
      // 仅顶层（depth===0）表格进入收集；嵌套在 blockquote/list 内的表格
      // 不参与子单元保真（对照核心 rootSpans 的 lastTableRoot 判定）。
      if (depth === 0 && isTableOpen) {
        idx++;
        cur = [];
      }
      if (tableDepth === 1 && t.type === "tr_open" && t.map && cur) {
        cur.push({ start: t.map[0], end: t.map[1] });
      }
      depth += t.nesting;
      if (isTableClose) {
        tableDepth--;
        if (tableDepth === 0 && cur && idx >= 0 && idx < out.length) {
          out[idx] = { spans: cur };
          cur = null;
        }
      }
    }
    return out;
  },

  canonicalUnits(node, renderBlockCanon) {
    return tableCanonicalRows(renderBlockCanon, node);
  },

  splice(src, eol, oSet, nTable, renderBlockCanon) {
    const nRows = tableCanonicalRows(renderBlockCanon, nTable);
    if (oSet.spans.length === 0 || nRows.length !== oSet.spans.length) return null;
    const m = oSet.spans.length;
    const n = nRows.length;
    const starts = lineStarts(src);
    const off = (line: number): number => (line < starts.length ? starts[line]! : src.length);
    const rawOf = (sp: BlockSpan): string => src.slice(off(sp.start), off(sp.end));
    const anchors = alignUnits(oSet.sigs, nRows);
    // 分隔行原文：header 行与首行 body 之间的残段（无 body 行为空），
    // 与核心 parseWithSource 的算法一致。
    const dividerRaw =
      m > 1 ? src.slice(off(oSet.spans[0]!.end), off(oSet.spans[1]!.start)) : "";

    // 脏行内做格级拼接：未变化的格保留原文对齐空格。
    const texts = nRows.slice();
    const splicePair = (bIdx: number, nIdx: number): void => {
      const rawRow = rawOf(oSet.spans[bIdx]!);
      texts[nIdx] = rowCellSplice(rawRow, texts[nIdx]!);
    };
    let prevB = -1;
    let prevN = -1;
    for (const [bi, ni] of anchors) {
      const bLen = bi - (prevB + 1);
      const nLen = ni - (prevN + 1);
      if (bLen === nLen) {
        for (let k = 0; k < bLen; k++) splicePair(prevB + 1 + k, prevN + 1 + k);
      }
      prevB = bi;
      prevN = ni;
    }
    const bTail = m - (prevB + 1);
    const nTail = n - (prevN + 1);
    if (bTail === nTail) {
      for (let k = 0; k < bTail; k++) splicePair(prevB + 1 + k, prevN + 1 + k);
    }
    const gapOf = (i: number): string => {
      if (i === 0) return dividerRaw;
      if (i >= m - 1) return "";
      return src.slice(off(oSet.spans[i]!.end), off(oSet.spans[i + 1]!.start));
    };

    const pieces: Piece[] = [];
    let nPtr = 0;
    let suppressGap = false;
    let regionFlushed = false;
    let aPtr = 0;
    for (let i = 0; i < m; i++) {
      const isAnchor = aPtr < anchors.length && anchors[aPtr]![0] === i;
      if (isAnchor) {
        const ni = anchors[aPtr]![1];
        if (!regionFlushed) {
          for (let j = nPtr; j < ni; j++) pieces.push({ kind: "canon", text: texts[j]!, idx: j });
          nPtr = ni;
        }
        pieces.push({ kind: "raw", i });
        nPtr = ni + 1;
        aPtr++;
        suppressGap = false;
        regionFlushed = false;
      } else {
        if (!regionFlushed && aPtr < anchors.length) {
          const ni = anchors[aPtr]![1];
          if (nPtr < ni) {
            for (let j = nPtr; j < ni; j++) pieces.push({ kind: "canon", text: texts[j]!, idx: j });
            nPtr = ni;
          }
          regionFlushed = true;
        }
        suppressGap = true;
      }
      const gap = gapOf(i);
      if (gap.trim() !== "" || !suppressGap) {
        pieces.push({ kind: "free", text: gap });
        if (gap.trim() !== "") suppressGap = false;
      }
    }
    for (let j = nPtr; j < n; j++) pieces.push({ kind: "canon", text: texts[j]!, idx: j });

    let P = "";
    let pendingGap = false;
    for (const piece of pieces) {
      if (piece.kind === "free") {
        P += piece.text;
        pendingGap = piece.text !== "";
        continue;
      }
      const text = piece.kind === "raw" ? rawOf(oSet.spans[piece.i]!) : ensureEol(piece.text, eol);
      if (P === "" || pendingGap) {
        P += text;
      } else if (!endsWithEol(P, eol)) {
        P += eol;
        P += text;
      } else {
        P += text;
      }
      pendingGap = false;
    }
    return P.endsWith(eol) ? P : P + eol;
  },
};
