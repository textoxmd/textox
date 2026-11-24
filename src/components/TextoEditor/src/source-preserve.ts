import type { Node as PMNode } from "prosemirror-model";
import type Token from "markdown-it/lib/token.mjs";

import {
  alignUnits,
  endsWithEol,
  ensureEol,
  eolOf,
  lineStarts,
  toEol,
  type BlockSpan,
  type SourcePreserveReconciler,
  type SourcePreserveUnitSet,
  type SourceVerbatimReconciler,
} from "@texto/markdown-editor-runtime";

import { allFeatures, runFeatureStep } from "./features/index.ts";
import { parseTokens, tokensToPMDoc } from "./parser.ts";
import {
  lineColToPos as canonLineColToPos,
  posToLineCol as canonPosToLineCol,
} from "./position.ts";
import { getSchema } from "./schema.ts";
import { SerializerState, getMdConfig } from "./serializer.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 源文本保留序列化（canonical-diff + 原文拼接）
//
// O = 原始 markdown；B = serialize(parse(O)) 的块级 canonical 单元；
// N = 编辑后 doc 的块级 canonical 单元。
// O 被切分为交替序列：F0 C0 F1 C1 ... C{m-1} Fm，其中 C_i 是顶层块内容，
// F_i 是块间残段（空行、引用定义、verbatim 节点原文等游离内容，永远原样保留）。
// 对 B/N 求块级对齐：锚点复制 O 的 C_i，脏区段用 N canonical 文本替换。
//
// 增强（列表项子单元）：当某个顶层列表成为“脏区段”且其前后锚点唯一时，
// 在列表内部再做一次项级对齐 —— 未编辑项复制原文行，编辑项才 canonical；
// 编辑项保留原列表 marker（`*`/`+`/原编号）而不是退化为 `-`。
//
// 子单元保真（通用机制）：功能经 `SyntaxFeature.sourcePreserve` 声明
// `SourcePreserveReconciler`，核心按顶层块类型把脏块分发给对应协调器做局部
// 拼接（行/项级重写、未编辑部分原文保留）；纯段落引用块另有专用路径支持
// 子块级保真，含嵌套结构的引用块仍是原子单元；
// - 被解析器重定位的 verbatim 顶层节点（如脚注定义）经
//   `SyntaxFeature.sourceVerbatim` 声明：不参与位置对齐，其原文在 freeform
//   残段内原位保留，按 key 配对后写回；
// - 脏块相邻的纯空行残段收敛为 canonical 单空行；
// - canonical 替换文本跟随文件主导 EOL（LF/CRLF）。
//
// 调用约定：serializePreserving 无法安全拼接时返回 null，由调用方回退到
// 普通 serialize(doc)。
// ─────────────────────────────────────────────────────────────────────────────

export type { BlockSpan } from "@texto/markdown-editor-runtime";

export interface ListItemSet {
  /** 每个直接 item 的原始行区间（绝对行号） */
  spans: BlockSpan[];
  /** 项间残段（原样文本，长度 m-1；通常为空行或空串） */
  gaps: string[];
  /** 每个 item 的 canonical 签名（默认 marker，未编辑时可与 N 侧对齐） */
  sigs: string[];
  /** 每个 item 原始首行（用于 marker 继承） */
  firstLines: string[];
}

export interface QuoteChildSet {
  /** 直接段落子块的原始行区间 */
  spans: BlockSpan[];
  /** 子块间残段（`>` 空行等） */
  gaps: string[];
  /** 每个子块 canonical 文本（以单子引用块渲染，不含子块间分隔） */
  sigs: string[];
}

/** 一个 verbatim 区域在某个 free 残段内的定位信息。 */
interface VerbatimRegionInfo {
  freeIndex: number;
  at: number;
  end: number;
  key: string;
  raw: string;
  oldNode: PMNode;
}

/** 一个 verbatim 协调器及其在本文档命中的区域。 */
interface VerbatimContext {
  reconciler: SourceVerbatimReconciler;
  regions: VerbatimRegionInfo[];
  /** 本协调器收集到的全部区域 key（含未映射到 free 残段的区域）。 */
  keys: string[];
}

export interface PreservationContext {
  /** 原始 markdown 文本（整篇文档） */
  readonly src: string;
  /** 顶层块内容行区间（verbatim 节点除外） */
  readonly spans: readonly BlockSpan[];
  /** F_i 残段（i=0 为文档首部，i=m 为文档尾部） */
  readonly free: readonly string[];
  /** 基线 B 的单元 canonical 签名（不含 verbatim 节点） */
  readonly bSigs: readonly string[];
  /** 每个顶层块对应的列表项单元集（非列表为 null） */
  readonly listItems: readonly (ListItemSet | null)[];
  /** 每个顶层块的子单元保真信息（非子单元块为 null） */
  readonly subUnits: readonly (SourcePreserveUnitSet | null)[];
  /** 每个顶层块对应的协调器（无则为 null） */
  readonly reconcilerByRoot: readonly (SourcePreserveReconciler | null)[];
  /** 插件声明的 verbatim 顶层节点及其源区域（无则空数组）。 */
  readonly verbatim: readonly VerbatimContext[];
  /** 插件声明的全部 verbatim 协调器（含本文档未命中的，供新增写回）。 */
  readonly verbatimReconcilers: readonly SourceVerbatimReconciler[];
  /** 每个顶层块对应的引用块子单元集（非纯段落引用为 null） */
  readonly quotes: readonly (QuoteChildSet | null)[];
  /** 文件主导 EOL */
  readonly eol: "\n" | "\r\n";
  /** parse(src) 得到的 doc（与 parse() 等价） */
  readonly doc: PMNode;
  /** 结构是否被完整覆盖；false 时调用方应回退 canonical serialize */
  readonly supported: boolean;
}

/** 全部 verbatim 顶层节点协调器（按功能清单缓存，清单身份变化时重算）。 */
let verbatimReconSource: ReturnType<typeof allFeatures> | undefined;
let verbatimReconCache: SourceVerbatimReconciler[] | undefined;
function verbatimReconcilers(): SourceVerbatimReconciler[] {
  const features = allFeatures();
  if (verbatimReconSource !== features) {
    verbatimReconSource = features;
    verbatimReconCache = features
      .map((f) => f.sourceVerbatim)
      .filter((r): r is SourceVerbatimReconciler => !!r);
  }
  return verbatimReconCache!;
}

/** 某顶层节点是否由插件声明为 verbatim（不参与位置对齐）。 */
function isVerbatimRoot(node: PMNode): boolean {
  for (const rec of verbatimReconcilers()) {
    const hit = runFeatureStep("sourceVerbatim.matches", () => rec.matches(node));
    if (hit) return true;
  }
  return false;
}

function isListType(type: string): boolean {
  return type === "bullet_list" || type === "ordered_list";
}

interface RootScan {
  spans: BlockSpan[];
  /** root 序号 → 该列表的直接 item 行区间 */
  listItems: Map<number, BlockSpan[]>;
  /** root 序号 → 顶层引用块的 paragraph 子块行区间 */
  quoteChildren: Map<number, BlockSpan[]>;
}

function rootSpans(tokens: readonly Token[]): RootScan {
  const spans: BlockSpan[] = [];
  const listItems = new Map<number, BlockSpan[]>();
  const quoteChildren = new Map<number, BlockSpan[]>();
  let depth = 0;
  let listDepth = 0;
  let quoteDepth = 0;
  let lastRoot = -1;
  let lastQuoteRoot = -1;
  for (const t of tokens) {
    const isListOpen = t.type === "bullet_list_open" || t.type === "ordered_list_open";
    const isListClose = t.type === "bullet_list_close" || t.type === "ordered_list_close";
    if (isListOpen) listDepth++;
    const isQuoteOpen = t.type === "blockquote_open";
    const isQuoteClose = t.type === "blockquote_close";
    if (isQuoteOpen) quoteDepth++;
    if (depth === 0 && t.map) {
      const atomicRoot =
        t.nesting === 0 &&
        (t.block === true ||
          t.type === "fence" ||
          t.type === "code_block" ||
          t.type === "hr");
      if (t.nesting === 1 || atomicRoot) {
        const rootIdx = spans.length;
        spans.push({ start: t.map[0], end: t.map[1] });
        if (isListOpen) {
          listItems.set(rootIdx, []);
          lastRoot = rootIdx;
        } else if (isQuoteOpen) {
          quoteChildren.set(rootIdx, []);
          lastQuoteRoot = rootIdx;
        }
      }
    }
    if (listDepth === 1 && t.type === "list_item_open" && t.map && lastRoot >= 0) {
      const arr = listItems.get(lastRoot);
      if (arr) arr.push({ start: t.map[0], end: t.map[1] });
    }
    if (quoteDepth === 1 && listDepth === 0 && t.type === "paragraph_open" && t.map && lastQuoteRoot >= 0) {
      const arr = quoteChildren.get(lastQuoteRoot);
      if (arr) arr.push({ start: t.map[0], end: t.map[1] });
    }
    depth += t.nesting;
    if (isListClose) listDepth--;
    if (isQuoteClose) quoteDepth--;
  }
  return { spans, listItems, quoteChildren };
}

/** F_i：块间残段（空行、引用定义、verbatim 节点原文行等）。 */
function partitionFree(src: string, spans: readonly BlockSpan[]): string[] {
  if (spans.length === 0) return [src];
  const starts = lineStarts(src);
  const off = (line: number): number => (line < starts.length ? starts[line]! : src.length);
  const free: string[] = [];
  free.push(src.slice(0, off(spans[0]!.start)));
  for (let i = 1; i < spans.length; i++) {
    free.push(src.slice(off(spans[i - 1]!.end), off(spans[i]!.start)));
  }
  free.push(src.slice(off(spans[spans.length - 1]!.end), src.length));
  return free;
}

// 顶层块 canonical 文本按「节点身份」缓存：PM 文档结构共享，未改动的块在每次
// 编辑后仍是同一个 Node 实例，因此一次按键只需重渲染真正变脏的块。大文档下
// canonicalUnits 是保真输出（序列化 + 行号映射）的主要开销，缓存后与文档长度
// 解耦。序列化配置在启动后不再变化（see serializer.getMdConfig 的惰性单例），
// 缓存不会读到过期配置。
const blockCanonCache = new WeakMap<PMNode, string>();

function renderBlockCanon(node: PMNode): string {
  const cached = blockCanonCache.get(node);
  if (cached !== undefined) return cached;
  const s = new SerializerState(getMdConfig());
  s.renderBlock(node);
  blockCanonCache.set(node, s.out);
  return s.out;
}

/** 统计换行数（等价于 text.split("\n").length - 1，但不分配行数组）。 */
function countNewlines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) n += 1;
  }
  return n;
}

// 行首偏移表按源串身份缓存：一次按键里拼接要跑 2~3 遍，重复整篇扫描属于纯浪费。
let lineStartsCache: { src: string; value: number[] } | null = null;

function cachedLineStarts(src: string): number[] {
  if (lineStartsCache && lineStartsCache.src === src) return lineStartsCache.value;
  const value = lineStarts(src);
  lineStartsCache = { src, value };
  return value;
}

/** 让写回文本的尾随 EOL 与原区域 raw 的尾随 EOL 一致（原文末行无换行则不加）。 */
function matchRawTrailingEol(text: string, raw: string): string {
  const body = text.replace(/\r?\n$/, "");
  if (raw.endsWith("\r\n")) return body + "\r\n";
  if (raw.endsWith("\n")) return body + "\n";
  return body;
}

interface VerbatimEntry {
  node: PMNode;
  rec: SourceVerbatimReconciler;
  key: string;
}

/** 逐个顶层节点解析 verbatim 协调器与 key（插件抛错只跳过自身）。 */
function verbatimEntries(
  doc: PMNode,
  reconcilers: readonly SourceVerbatimReconciler[],
): VerbatimEntry[] {
  const out: VerbatimEntry[] = [];
  if (reconcilers.length === 0) return out;
  doc.forEach((child) => {
    for (const rec of reconcilers) {
      const hit = runFeatureStep("sourceVerbatim.matches", () => rec.matches(child));
      if (!hit) continue;
      const key = runFeatureStep("sourceVerbatim.keyOf", () => rec.keyOf(child));
      if (key) out.push({ node: child, rec, key });
      break;
    }
  });
  return out;
}

/** 把 verbatim 区域按新旧文档 key 配对，替换/追加进 free 残段。 */
function resolveVerbatimFree(
  ctx: PreservationContext,
  doc: PMNode,
  eol: "\n" | "\r\n",
  anchors: readonly (readonly [number, number])[],
): string[] {
  const free = ctx.free.slice();
  const reconcilers = ctx.verbatimReconcilers;
  if (reconcilers.length === 0) return free;

  const newEntries = verbatimEntries(doc, reconcilers);
  const newByKey = new Map<string, VerbatimEntry>();
  for (const e of newEntries) newByKey.set(e.key, e);

  // 原文已存在的 verbatim key：含已定位区域与未映射到 free 残段的区域，
  // 避免它们被误判为“新增”而重复追加。
  const oldKeys = new Set<string>();
  for (const v of ctx.verbatim) for (const key of v.keys) oldKeys.add(key);
  for (const e of verbatimEntries(ctx.doc, reconcilers)) oldKeys.add(e.key);

  const edits: Array<{ freeIndex: number; at: number; end: number; text: string }> = [];
  for (const v of ctx.verbatim) {
    for (const r of v.regions) {
      oldKeys.add(r.key);
      const n = newByKey.get(r.key);
      let text: string;
      if (!n) {
        text = "";
      } else {
        const oldCanon =
          runFeatureStep("sourceVerbatim.render", () => v.reconciler.render(r.oldNode, renderBlockCanon)) ??
          r.raw;
        const newCanon =
          runFeatureStep("sourceVerbatim.render", () => n.rec.render(n.node, renderBlockCanon)) ?? r.raw;
        // 替换文本统一为文件主导 EOL，再对齐原区域的尾随 EOL。
        text = oldCanon === newCanon ? r.raw : matchRawTrailingEol(toEol(newCanon, eol), r.raw);
      }
      edits.push({ freeIndex: r.freeIndex, at: r.at, end: r.end, text });
    }
  }

  const byFree = new Map<number, typeof edits>();
  for (const e of edits) {
    const arr = byFree.get(e.freeIndex) ?? [];
    arr.push(e);
    byFree.set(e.freeIndex, arr);
  }
  for (const [fi, arr] of byFree) {
    arr.sort((a, b) => b.at - a.at);
    let s = free[fi]!;
    for (const e of arr) {
      if (e.text === "") {
        // 删除区域：区域左右各有一个换行（占据一整行）时收敛为一个空行。
        let pre = s.slice(0, e.at);
        const post = s.slice(e.end);
        if (pre.endsWith(eol) && post.startsWith(eol)) pre = pre.slice(0, -eol.length);
        s = pre + post;
      } else {
        s = s.slice(0, e.at) + e.text + s.slice(e.end);
      }
    }
    free[fi] = s;
  }

  const appended: string[] = [];
  for (const e of newEntries) {
    if (oldKeys.has(e.key)) continue;
    const text = runFeatureStep("sourceVerbatim.render", () =>
      e.rec.render(e.node, renderBlockCanon),
    );
    if (text) appended.push(text);
  }
  if (appended.length) {
    const last = free.length - 1;
    const cur = free[last]!;
    let sep: string;
    if (cur === "") {
      // 无尾随残段：仅当最后一个顶层块的输出尚未以 EOL 结尾时才补两个换行，
      // 否则补一个（形成恰好一个空行）。锚点块复制原文（取决于源文末尾是否有
      // 换行）；被替换块走 canonical（ensureEol 已带尾随 EOL）。
      const lastB = ctx.spans.length - 1;
      const lastIsRaw = lastB >= 0 && anchors.some(([b]) => b === lastB);
      const precedingHasEol = lastIsRaw ? ctx.src.endsWith(eol) : true;
      sep = precedingHasEol ? eol : eol + eol;
    } else {
      // cur 非空：前块必带 EOL，仅需看 cur 自身是否已以 EOL 收尾。
      sep = cur.endsWith(eol) ? "" : eol + eol;
    }
    const body = appended.map((t) => ensureEol(t, eol)).join(eol);
    free[last] = cur + sep + body;
  }
  return free;
}

/** 顶层列表每个直接 item 的 canonical 文本（不含 item 间分隔前缀）。 */
function listItemCanons(list: PMNode): string[] {
  const s = new SerializerState(getMdConfig());
  const texts: string[] = [];
  s.onListItem = (_item, out, start) => {
    texts.push(out.slice(start));
  };
  s.renderBlock(list);
  return texts;
}

/**
 * 引用块直接段落子块的 canonical 文本：每个子块用“仅含该子块的引用块”
 * 渲染，得到不含子块间分隔（`>` 空行）的自身文本。
 */
function quoteChildCanons(quote: PMNode): string[] {
  const out: string[] = [];
  let supported = true;
  quote.forEach((child) => {
    if (child.type.name !== "paragraph") {
      supported = false;
      return;
    }
    const wrap = getSchema().nodes.blockquote.create(null, child);
    const s = new SerializerState(getMdConfig());
    s.renderBlock(wrap);
    out.push(s.out);
  });
  return supported ? out : [];
}

function canonicalUnits(doc: PMNode): string[] {
  const out: string[] = [];
  doc.forEach((child) => {
    if (!isVerbatimRoot(child)) out.push(renderBlockCanon(child));
  });
  return out;
}

/**
 * 编辑项继承原 marker：把 canonical 首行 marker 换成该项原文首行 marker。
 * 仅在两种写法长度/缩进一致时替换，避免破坏结构。
 */
function itemMarkerSwap(canon: string, rawFirstLine: string): string {
  const re = /^(\s*)([-+*]|\d+[.)])(\s+)/;
  const c = re.exec(canon);
  const r = re.exec(rawFirstLine);
  if (!c || !r || c[1] !== r[1]) return canon;
  return canon.slice(0, c.index! + c[1]!.length) + r[2] + canon.slice(c.index! + c[1]!.length + c[2]!.length);
}

type Piece =
  | { kind: "raw"; i: number; heading?: boolean }
  | { kind: "canon"; text: string; idx: number; heading?: boolean }
  | { kind: "free"; text: string };

type UnitLine = { nIdx: number | null; bIdx: number | null; line: number };

/** 顶层块拼接（canonical 文本由调用方传入，含列表项级替换结果）。 */
function spliceTopLevel(
  src: string,
  spans: readonly BlockSpan[],
  free: readonly string[],
  anchors: readonly (readonly [number, number])[],
  nTexts: readonly string[],
  bTypes: readonly string[],
  nTypes: readonly string[],
  eol: "\n" | "\r\n",
  onUnit?: (u: UnitLine) => void,
  /** false 时只做行号统计（不拼出整篇字符串），供行号映射用。 */
  build = true,
): string {
  const starts = cachedLineStarts(src);
  const off = (line: number): number => (line < starts.length ? starts[line]! : src.length);
  const rawOf = (sp: BlockSpan): string => src.slice(off(sp.start), off(sp.end));

  const m = spans.length;
  const n = nTexts.length;
  // slotN[i]：B 槽 i 在最终输出中对应的 N 单元（-1 = 删除；anchor 也在此表）。
  const slotN = new Array<number>(m).fill(-1);
  const pendingInsert: number[][] = Array.from({ length: m + 1 }, () => []);
  const assignRange = (bLo: number, bHi: number, nLo: number, nHi: number): void => {
    const dirty = Math.max(0, bHi - bLo);
    const avail = Math.max(0, nHi - nLo);
    const replaced = Math.min(dirty, avail);
    for (let k = 0; k < replaced; k++) slotN[bLo + k] = nLo + k;
    for (let j = nLo + replaced; j < nHi; j++) pendingInsert[bHi]!.push(j);
  };
  let prevB = -1;
  let prevN = -1;
  for (const [bi, ni] of anchors) {
    assignRange(prevB + 1, bi, prevN + 1, ni);
    slotN[bi] = ni;
    prevB = bi;
    prevN = ni;
  }
  assignRange(prevB + 1, m, prevN + 1, n);

  const pieces: Piece[] = [];
  pieces.push({ kind: "free", text: free[0]! });

  // 锚点自查用查表：原实现每块 `anchors.some(...)`，块与锚点都是千级时是 O(n²)，
  // 长文档每次按键在拼接阶段多花上百毫秒。
  const anchorAt = new Uint8Array(m);
  for (const [bi] of anchors) {
    if (bi >= 0 && bi < m) anchorAt[bi] = 1;
  }

  for (let i = 0; i < m; i++) {
    for (const j of pendingInsert[i]!)
      pieces.push({ kind: "canon", text: nTexts[j]!, idx: j, heading: nTypes[j] === "heading" });
    const isAnchorHere = anchorAt[i] === 1;
    if (slotN[i]! >= 0) {
      if (isAnchorHere) {
        pieces.push({ kind: "raw", i, heading: bTypes[i] === "heading" });
      } else {
        pieces.push({
          kind: "canon",
          text: nTexts[slotN[i]!]!,
          idx: slotN[i]!,
          heading: nTypes[slotN[i]!] === "heading",
        });
      }
    }
    const f = free[i + 1] ?? "";
    const hasContent = f.trim() !== "";
    // 删除槽：紧随纯空行收敛；替换/锚点槽保留原文空行；
    // 例外：最后一个块被替换时文末多空行按 canonical 收尾。
    // 删除槽：其后纯空行收敛；替换/锚点槽：保留原文空行（末块替换收尾除外）。
    const keepFree =
      hasContent || (slotN[i]! >= 0 && (i < m - 1 || isAnchorHere));
    if (keepFree) {
      pieces.push({ kind: "free", text: f });
    }
  }
  for (const j of pendingInsert[m]!)
    pieces.push({ kind: "canon", text: nTexts[j]!, idx: j, heading: nTypes[j] === "heading" });

  let P = "";
  // 仅保留「输出尾部 4 字符」与「是否仍为空」：上面的分隔判定只用到
  // endsWithEol(P, eol) / endsWithEol(P, eol+eol)，无需保留整篇 P，
  // 因而 build=false 时可以完全不拼字符串（大文档少一次整篇拼接与 GC）。
  let tail = "";
  let atStart = true;
  const appendText = (s: string): void => {
    if (s.length === 0) return;
    if (build) P += s;
    atStart = false;
    tail = s.length >= 4 ? s.slice(-4) : (tail + s).slice(-4);
  };
  let currentLine = 1;
  let sep: "hasFree" | "empty" | "direct" | null = null;
  let prevRaw = false;
  let prevHeading = false;
  let lastKind: "raw" | "canon" | "free" = "free";
  for (const piece of pieces) {
    if (piece.kind === "free") {
      appendText(piece.text);
      currentLine += countNewlines(piece.text);
      sep = piece.text === "" ? "empty" : "hasFree";
      lastKind = "free";
      continue;
    }
    const text = piece.kind === "raw" ? rawOf(spans[piece.i]!) : ensureEol(piece.text, eol);
    if (onUnit) {
      onUnit(
        piece.kind === "canon"
          ? { nIdx: piece.idx, bIdx: null, line: currentLine }
          : { nIdx: null, bIdx: piece.i, line: currentLine },
      );
    }
    if (atStart) {
      appendText(text);
    } else if (sep === "hasFree") {
      appendText(text);
    } else if (sep === "empty" && prevRaw && piece.kind === "raw") {
      appendText(text);
    } else {
      // 标题行可独立结束块：前块为标题且原文紧贴无空行时保持紧贴。
      const keepTight =
        sep === "empty" && prevHeading && !endsWithEol(tail, eol + eol);
      if (keepTight) {
        if (!endsWithEol(tail, eol)) {
          appendText(eol);
          currentLine += 1;
        }
      } else {
        if (!endsWithEol(tail, eol + eol)) {
          if (endsWithEol(tail, eol)) {
            appendText(eol);
            currentLine += 1;
          } else {
            appendText(eol + eol);
            currentLine += 2;
          }
        }
      }
      appendText(text);
    }
    currentLine += countNewlines(text);
    prevRaw = piece.kind === "raw";
    prevHeading = piece.heading === true;
    lastKind = piece.kind;
    sep = null;
  }

  if (build && lastKind === "canon") {
    P = P.replace(new RegExp(`${eol}+$`), "") + eol;
  }
  return P;
}

/**
 * 列表项级拼接：未编辑项复制原文行，编辑项 canonical（继承原 marker）。
 * 无法安全处理（项数/区间异常）时返回 null，调用方回退整表 canonical。
 */
function spliceListItems(
  src: string,
  eol: "\n" | "\r\n",
  oSet: ListItemSet,
  nList: PMNode,
): string | null {
  const nRaw = listItemCanons(nList);
  if (nRaw.length === 0 || oSet.spans.length === 0) return null;
  const anchors = alignUnits(oSet.sigs, nRaw);
  const m = oSet.spans.length;
  const n = nRaw.length;
  const starts = lineStarts(src);
  const off = (line: number): number => (line < starts.length ? starts[line]! : src.length);
  const rawOf = (sp: BlockSpan): string => src.slice(off(sp.start), off(sp.end));

  // marker 继承：脏区间等长替换时按顺序配对，用原文首行 marker 替换 canonical。
  const nTexts = nRaw.slice();
  const swap = (bIdx: number, nIdx: number): void => {
    const rawFirst = oSet.firstLines[bIdx];
    if (rawFirst) nTexts[nIdx] = itemMarkerSwap(nTexts[nIdx]!, rawFirst);
    // md-it 会把 item 后的终止空行计入该 item 的区间：非末项被替换时
    // 把原始尾随空行接回 canonical，保持项间多空行。
    if (bIdx < m - 1) {
      const trailing = /(\r?\n[\r\n]*)$/.exec(rawOf(oSet.spans[bIdx]!));
      if (trailing) nTexts[nIdx] = nTexts[nIdx]! + trailing[1]!;
    }
  };
  let prevB = -1;
  let prevN = -1;
  for (const [bi, ni] of anchors) {
    const bLen = bi - (prevB + 1);
    const nLen = ni - (prevN + 1);
    if (bLen === nLen) {
      for (let k = 0; k < bLen; k++) swap(prevB + 1 + k, prevN + 1 + k);
    }
    prevB = bi;
    prevN = ni;
  }
  const bTail = m - (prevB + 1);
  const nTail = n - (prevN + 1);
  if (bTail === nTail) {
    for (let k = 0; k < bTail; k++) swap(prevB + 1 + k, prevN + 1 + k);
  }

  const gapOf = (i: number): string =>
    i < m - 1 ? src.slice(off(oSet.spans[i]!.end), off(oSet.spans[i + 1]!.start)) : "";

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
        for (let j = nPtr; j < ni; j++) pieces.push({ kind: "canon", text: nTexts[j]!, idx: j });
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
          for (let j = nPtr; j < ni; j++) pieces.push({ kind: "canon", text: nTexts[j]!, idx: j });
          nPtr = ni;
        }
        regionFlushed = true;
      }
      // 该槽被替换（canonical 已就位）时保留其后原文空行；纯删除时收敛。
      suppressGap = !regionFlushed;
    }
    const gap = gapOf(i);
    if (gap.trim() !== "" || !suppressGap) {
      pieces.push({ kind: "free", text: gap });
      if (gap.trim() !== "") suppressGap = false;
    }
  }
  for (let j = nPtr; j < n; j++) pieces.push({ kind: "canon", text: nTexts[j]!, idx: j });

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
}

/** 引用块内段落级拼接（仅纯段落子块；其余引用内容维持整块 canonical）。 */
function spliceQuoteChildren(
  src: string,
  eol: "\n" | "\r\n",
  oSet: QuoteChildSet,
  nQuote: PMNode,
): string | null {
  const nCanons = quoteChildCanons(nQuote);
  if (oSet.spans.length === 0 || nCanons.length !== oSet.spans.length) return null;
  const anchors = alignUnits(oSet.sigs, nCanons);
  const m = oSet.spans.length;
  const n = nCanons.length;

  const starts = lineStarts(src);
  const off = (line: number): number => (line < starts.length ? starts[line]! : src.length);
  const rawOf = (sp: BlockSpan): string => src.slice(off(sp.start), off(sp.end));
  const gapOf = (i: number): string => {
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
        for (let j = nPtr; j < ni; j++) pieces.push({ kind: "canon", text: nCanons[j]!, idx: j });
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
          for (let j = nPtr; j < ni; j++) pieces.push({ kind: "canon", text: nCanons[j]!, idx: j });
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
  for (let j = nPtr; j < n; j++) pieces.push({ kind: "canon", text: nCanons[j]!, idx: j });

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
}

/**
 * 解析原始 markdown，返回 doc 与保真上下文。
 * 与 parse(src) 行为一致（同一 token 流 + 同一批 post-processors）。
 */
export function parseWithSource(src: string): PreservationContext {
  const tokens = parseTokens(src);
  const doc = tokensToPMDoc(tokens);
  const { spans, listItems: rawItems, quoteChildren: rawQuotes } = rootSpans(tokens);
  let units = 0;
  doc.forEach((child) => {
    if (!isVerbatimRoot(child)) units++;
  });
  const supported = spans.length === units;
  const free = supported ? partitionFree(src, spans) : [];
  const bSigs = supported ? canonicalUnits(doc) : [];
  const eol = eolOf(src);

  const listItems: (ListItemSet | null)[] = new Array(spans.length).fill(null);
  const quotes: (QuoteChildSet | null)[] = new Array(spans.length).fill(null);
  if (supported) {
    const starts = lineStarts(src);
    const off = (line: number): number => (line < starts.length ? starts[line]! : src.length);
    doc.forEach((child, _off, idx) => {
      if (isListType(child.type.name)) {
        const raw = rawItems.get(idx);
        const sigs = listItemCanons(child);
        if (!raw || raw.length !== sigs.length || sigs.length === 0) return;
        const spansArr = raw;
        const gaps: string[] = [];
        for (let k = 0; k < spansArr.length - 1; k++) {
          gaps.push(src.slice(off(spansArr[k]!.end), off(spansArr[k + 1]!.start)));
        }
        const firstLines = spansArr.map((sp) => {
          const lineEnd = off(sp.start + 1) > off(sp.start) ? off(sp.start + 1) : src.length;
          return src.slice(off(sp.start), lineEnd).replace(/\r?\n$/, "");
        });
        listItems[idx] = { spans: spansArr, gaps, sigs, firstLines };
        return;
      }
      if (child.type.name === "blockquote") {
        const raw = rawQuotes.get(idx);
        const sigs = quoteChildCanons(child);
        if (!raw || sigs.length === 0 || raw.length !== sigs.length) return;
        const spansArr = raw;
        const gaps: string[] = [];
        for (let k = 0; k < spansArr.length - 1; k++) {
          gaps.push(src.slice(off(spansArr[k]!.end), off(spansArr[k + 1]!.start)));
        }
        quotes[idx] = { spans: spansArr, gaps, sigs };
      }
    });
  }

  const reconcilerByRoot: (SourcePreserveReconciler | null)[] = new Array(spans.length).fill(null);
  const subUnits: (SourcePreserveUnitSet | null)[] = new Array(spans.length).fill(null);
  const verbatim: VerbatimContext[] = [];
  const reconcilerList = verbatimReconcilers();
  if (supported) {
    const starts = lineStarts(src);
    const off = (line: number): number => (line < starts.length ? starts[line]! : src.length);
    const freeStart: number[] = [0, ...spans.map((sp) => off(sp.end))];
    const freeEnd: number[] = [...spans.map((sp) => off(sp.start)), src.length];

    for (const rec of reconcilerList) {
      const regions = runFeatureStep("sourceVerbatim.collect", () => rec.collect(src, doc)) ?? [];
      const infos: VerbatimRegionInfo[] = [];
      const keys: string[] = [];
      for (const reg of regions) {
        keys.push(reg.key);
        let freeIndex = -1;
        for (let k = 0; k < freeStart.length; k++) {
          if (reg.start >= freeStart[k]! && reg.end <= freeEnd[k]!) {
            freeIndex = k;
            break;
          }
        }
        if (freeIndex < 0) continue;
        let oldNode: PMNode | null = null;
        doc.forEach((child) => {
          if (oldNode) return;
          const hit = runFeatureStep("sourceVerbatim.matches", () => rec.matches(child));
          if (!hit) return;
          const key = runFeatureStep("sourceVerbatim.keyOf", () => rec.keyOf(child));
          if (key === reg.key) oldNode = child;
        });
        if (!oldNode) continue;
        infos.push({
          freeIndex,
          at: reg.start - freeStart[freeIndex]!,
          end: reg.end - freeStart[freeIndex]!,
          key: reg.key,
          raw: reg.raw,
          oldNode,
        });
      }
      if (keys.length) verbatim.push({ reconciler: rec, regions: infos, keys });
    }

    const childTypes: string[] = [];
    // 与 childTypes 同序的顶层子节点：下方按 rootIdx 取「旧节点」时直接索引。
    // 不能在每个匹配项里 doc.forEach 找第 k 个（表格类文档有上千个匹配块时是 O(n²)）。
    const childNodes: PMNode[] = [];
    doc.forEach((child) => {
      if (isVerbatimRoot(child)) return;
      childTypes.push(child.type.name);
      childNodes.push(child);
    });
    // 协调器为插件代码：单个抛错只跳过自身，不中断整篇解析（错误隔离）。
    const reconcilers = allFeatures()
      .map((f) => f.sourcePreserve)
      .filter((r): r is SourcePreserveReconciler => !!r);
    for (const rec of reconcilers) {
      const label = `sourcePreserve(${rec.nodeTypes.join("/")})`;
      const matches: number[] = [];
      for (let i = 0; i < spans.length; i++) {
        const type = childTypes[i];
        if (type && rec.nodeTypes.includes(type)) matches.push(i);
      }
      if (matches.length === 0) continue;
      const collected = runFeatureStep(label, () => rec.collect(tokens, spans, matches));
      if (!collected) continue;
      for (let k = 0; k < matches.length; k++) {
        const c = collected[k];
        const rootIdx = matches[k]!;
        if (!c) continue;
        const oldChild = childNodes[rootIdx] ?? null;
        if (!oldChild) continue;
        const sigs = runFeatureStep(label, () => rec.canonicalUnits(oldChild, renderBlockCanon));
        if (!sigs || sigs.length === 0 || sigs.length !== c.spans.length) continue;
        reconcilerByRoot[rootIdx] = rec;
        subUnits[rootIdx] = { spans: c.spans, sigs, meta: c.meta };
      }
    }
  }
  return { src, spans, free, bSigs, listItems, subUnits, reconcilerByRoot, quotes, eol, doc, supported, verbatim, verbatimReconcilers: reconcilerList };
}

/**
 * 源文本保留序列化：未变化单元复制原文，脏单元用 canonical 文本替换；
 * 单个脏列表在前后锚点唯一时走项级拼接。无法安全拼接时返回 null。
 */
export function serializePreserving(ctx: PreservationContext, doc: PMNode): string | null {
  if (!ctx.supported || ctx.spans.length === 0) return null;
  const { anchors, texts, free } = preservedParts(ctx, doc);
  return spliceTopLevel(
    ctx.src,
    ctx.spans,
    free,
    anchors,
    texts,
    filteredChildTypes(ctx.doc),
    filteredChildTypes(doc),
    ctx.eol,
  );
}

/** 保真输出前需要复用的对齐结果（serialize 与行号映射共用同一份）。 */
interface PreservedPartsResult {
  anchors: Array<[number, number]>;
  texts: string[];
  nodes: PMNode[];
  free: string[];
}

// 最近一次 preservedParts 结果缓存：serializePreserving / preservedHeadingLines /
// preservedUnitMaps 在同一次 doc 变更内共享同一份对齐结果。alignUnits 是 LCS
// （O(n²)）、canonicalUnits 是整篇 canonical 序列化，二者是大文档保真输出的
// 主要开销，避免每次文档变更重复计算。以 (ctx, doc) 身份为键——doc 不可变、每次
// 编辑都是新对象；ctx 每次加载才重建，二者身份稳定。
let partsCache: { ctx: PreservationContext; doc: PMNode; value: PreservedPartsResult } | null = null;

function preservedParts(
  ctx: PreservationContext,
  doc: PMNode,
): PreservedPartsResult {
  if (partsCache && partsCache.ctx === ctx && partsCache.doc === doc) {
    return partsCache.value;
  }

  const base = canonicalUnits(doc);
  const anchors = alignUnits(ctx.bSigs, base);
  const nodes: PMNode[] = [];
  doc.forEach((child) => {
    if (!isVerbatimRoot(child)) nodes.push(child);
  });
  const texts = base.slice();
  for (const [b, n] of dirtyReplacementPairs(ctx.spans.length, nodes.length, anchors)) {
    const nNode = nodes[n];
    if (!nNode) continue;
    if (isListType(nNode.type.name)) {
      const oSet = ctx.listItems[b];
      if (!oSet) continue;
      const replaced = spliceListItems(ctx.src, ctx.eol, oSet, nNode);
      if (replaced !== null) texts[n] = replaced;
    } else if (nNode.type.name === "blockquote") {
      const oSet = ctx.quotes[b];
      if (!oSet) continue;
      const replaced = spliceQuoteChildren(ctx.src, ctx.eol, oSet, nNode);
      if (replaced !== null) texts[n] = replaced;
    } else {
      const rec = ctx.reconcilerByRoot[b];
      const set = ctx.subUnits[b];
      if (rec && set && rec.nodeTypes.includes(nNode.type.name)) {
        const replaced = runFeatureStep(`sourcePreserve(${rec.nodeTypes.join("/")})`, () =>
          rec.splice(ctx.src, ctx.eol, set, nNode, renderBlockCanon),
        );
        if (replaced !== undefined && replaced !== null) texts[n] = replaced;
      }
    }
  }

  const free = resolveVerbatimFree(ctx, doc, ctx.eol, anchors);
  const value = { anchors, texts, nodes, free };
  partsCache = { ctx, doc, value };
  return value;
}

/** 按区域顺序给“被替换的脏 B 槽”配对 N 单元（纯插入/删除不在此列）。 */
function dirtyReplacementPairs(
  m: number,
  n: number,
  anchors: readonly (readonly [number, number])[],
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const assignRange = (bLo: number, bHi: number, nLo: number, nHi: number): void => {
    const dirty = Math.max(0, bHi - bLo);
    const avail = Math.max(0, nHi - nLo);
    const replaced = Math.min(dirty, avail);
    for (let k = 0; k < replaced; k++) out.push([bLo + k, nLo + k]);
  };
  let prevB = -1;
  let prevN = -1;
  for (const [bi, ni] of anchors) {
    assignRange(prevB + 1, bi, prevN + 1, ni);
    prevB = bi;
    prevN = ni;
  }
  assignRange(prevB + 1, m, prevN + 1, n);
  return out;
}

/**
 * 保真输出 P 中每个顶层标题（1 起）的行号；标题嵌套在其他容器内时无法
 * 精确映射，返回 null 由调用方回退 canonical 行号。
 */
export function preservedHeadingLines(ctx: PreservationContext, doc: PMNode): number[] | null {
  if (!ctx.supported || ctx.spans.length === 0) return null;
  let topLevelHeadings = 0;
  let allHeadings = 0;
  doc.forEach((child) => {
    if (child.type.name === "heading") topLevelHeadings++;
  });
  doc.descendants((node) => {
    if (node.type.name === "heading") allHeadings++;
    return true;
  });
  if (topLevelHeadings !== allHeadings) return null;

  const { anchors, texts, free } = preservedParts(ctx, doc);
  const anchorN = new Map<number, number>();
  for (const [b, n] of anchors) anchorN.set(n, b);
  const canonLines = new Map<number, number>();
  const rawLines = new Map<number, number>();
  spliceTopLevel(
    ctx.src,
    ctx.spans,
    free,
    anchors,
    texts,
    filteredChildTypes(ctx.doc),
    filteredChildTypes(doc),
    ctx.eol,
    (u) => {
      if (u.nIdx !== null) canonLines.set(u.nIdx, u.line);
      if (u.bIdx !== null) rawLines.set(u.bIdx, u.line);
    },
    false,
  );

  const out: number[] = [];
  let k = 0;
  doc.forEach((child) => {
    if (child.type.name === "heading") {
      const line = anchorN.has(k) ? rawLines.get(anchorN.get(k)!) : canonLines.get(k);
      out.push(line ?? 1);
    }
    k++;
  });
  return out;
}

type UnitMaps = { starts: number[]; anchorN: Map<number, number> };

// 行号映射缓存：一次按键里 dispatchTransaction 会为上、下两个光标各算一次
// pos→行号（beforeSelection），保真输出拼接与 canonical 行号表都只依赖
// (ctx, doc)，因此按身份缓存，避免同一次事务里重复整篇计算。
let unitMapsCache: { ctx: PreservationContext; doc: PMNode; value: UnitMaps | null } | null = null;
let canonStartLinesCache: { doc: PMNode; value: number[] } | null = null;

/** 每个顶层单元在保真输出 P 中的起始行（1 起）与锚点反查表。 */
function preservedUnitMaps(
  ctx: PreservationContext,
  doc: PMNode,
): UnitMaps | null {
  if (unitMapsCache && unitMapsCache.ctx === ctx && unitMapsCache.doc === doc) {
    return unitMapsCache.value;
  }
  const value = computeUnitMaps(ctx, doc);
  unitMapsCache = { ctx, doc, value };
  return value;
}

function computeUnitMaps(
  ctx: PreservationContext,
  doc: PMNode,
): UnitMaps | null {
  if (!ctx.supported || ctx.spans.length === 0) return null;
  const { anchors, texts, free } = preservedParts(ctx, doc);
  const anchorN = new Map<number, number>();
  for (const [b, n] of anchors) anchorN.set(n, b);
  const canonLines = new Map<number, number>();
  const rawLines = new Map<number, number>();
  spliceTopLevel(
    ctx.src,
    ctx.spans,
    free,
    anchors,
    texts,
    filteredChildTypes(ctx.doc),
    filteredChildTypes(doc),
    ctx.eol,
    (u) => {
      if (u.nIdx !== null) canonLines.set(u.nIdx, u.line);
      if (u.bIdx !== null) rawLines.set(u.bIdx, u.line);
    },
    false,
  );
  const starts: number[] = [];
  // 单元数量：这里只用到长度（下方按 index 取 anchor/raw/canon 行号），
  // 不必再整篇 canonical 序列化一遍。
  let unitCount = 0;
  doc.forEach((child) => {
    if (!isVerbatimRoot(child)) unitCount++;
  });
  for (let k = 0; k < unitCount; k++) {
    const line = anchorN.has(k) ? rawLines.get(anchorN.get(k)!) : canonLines.get(k);
    if (line === undefined) return null;
    starts.push(line);
  }
  return { starts, anchorN };
}

/** 每个顶层单元在保真输出 P 中的起始行（1 起）。 */
function preservedUnitStartLines(ctx: PreservationContext, doc: PMNode): number[] | null {
  return preservedUnitMaps(ctx, doc)?.starts ?? null;
}

/** 每个顶层单元在 canonical serialize 输出中的起始行（1 起，顺序匹配法）。 */
function canonicalUnitStartLines(doc: PMNode): number[] {
  if (canonStartLinesCache?.doc === doc) return canonStartLinesCache.value;
  const md = (() => {
    const s = new SerializerState(getMdConfig());
    s.renderDoc(doc);
    return s.out.replace(/\n+$/, "\n");
  })();
  const units = canonicalUnits(doc);
  const starts: number[] = [];
  let cursor = 0;
  // 单调扫描：已统计过的位置不再重复扫描（原实现每个单元都 md.slice(0, idx)
  // 再 split 一遍，单元数为千级时是 O(n²)，长文档每次按键会多花数秒）。
  let scanned = 0;
  let line = 1;
  const countNewlines = (from: number, to: number): number => {
    let n = 0;
    for (let i = from; i < to; i += 1) {
      if (md.charCodeAt(i) === 10) n += 1;
    }
    return n;
  };
  for (const unit of units) {
    if (!unit) {
      starts.push(starts[starts.length - 1] ?? 1);
      continue;
    }
    const idx = md.indexOf(unit, cursor);
    if (idx === -1) {
      starts.push(starts[starts.length - 1] ?? 1);
      continue;
    }
    line += countNewlines(scanned, idx);
    starts.push(line);
    line += countNewlines(idx, idx + unit.length);
    scanned = idx + unit.length;
    cursor = scanned;
  }
  canonStartLinesCache = { doc, value: starts };
  return starts;
}

/** 保真 pos→行（1 起）列（0 起），单元起始行平移 canonical 内部偏移。 */
export function preservedPosToLineCol(
  ctx: PreservationContext,
  doc: PMNode,
  pos: number,
): { line: number; col: number } | null {
  const maps = preservedUnitMaps(ctx, doc);
  if (!maps) return null;
  const pStarts = maps.starts;
  const k = unitIndexForPos(doc, pos);
  if (k < 0 || k >= pStarts.length) return null;
  const unit = nthFilteredChild(doc, k);
  if (!unit) return null;
  // 行号只需「单元起点 + 单元内偏移」：单元内行/列只序列化该单元即可，
  // 不再整篇 serialize(doc) 求 canonical 行号（长文档每次按键要花上百毫秒）。
  // filteredChildStart 返回单元的 content offset（doc 内容偏移，0 起）；
  // 单元内容首字符的文档位置是该偏移 + 1，因此 pos - offset 正好是「单元内偏移 + 1」，
  // 与包成单块文档后的真实位置一致（单块文档里首个子节点内容从 1 开始）。
  const unitStart = filteredChildStart(doc, k);
  const local = Math.max(0, Math.min(pos - unitStart, unit.nodeSize));
  // 只序列化该单元：把单元包成单块文档，复用整篇同一套位置换算。
  // 直接 serialize(unit) 不行——序列化器以 doc 为单位渲染子块。
  const unitDoc = getSchema().nodes.doc.create(null, unit);
  const lc = canonPosToLineCol(unitDoc, local);
  const lineWithin = lc.line;
  let line = pStarts[k]! + lineWithin - 1;

  // 松散列表项内光标：项间空行只存在于原文，用 item 原始行修正。
  if (isListType(unit.type.name)) {
    const oSet = ctx.listItems[k];
    const itemIdx = itemIndexForPos(unit, pos - unitStart);
    if (oSet && itemIdx >= 0 && itemIdx < oSet.spans.length) {
      const itemOffset = oSet.sigs
        .slice(0, itemIdx)
        .reduce((sum, t) => sum + (t.split("\n").length - (t.endsWith("\n") ? 1 : 0)), 0);
      const preservedItemStart = maps.anchorN.has(k)
        ? oSet.spans[itemIdx]!.start + 1
        : pStarts[k]! + itemOffset;
      line = preservedItemStart + (lineWithin - 1 - itemOffset);
    }
  }
  return { line, col: lc.col };
}

/** 保真行（1 起）列（0 起）→ PM 位置（单元行范围平移回 canonical）。 */
export function preservedLineColToPos(
  ctx: PreservationContext,
  doc: PMNode,
  line: number,
  col: number,
): number | null {
  const pStarts = preservedUnitStartLines(ctx, doc);
  if (!pStarts) return null;
  const cStarts = canonicalUnitStartLines(doc);
  const maps = preservedUnitMaps(ctx, doc);
  if (!maps) return null;
  const count = pStarts.length;
  let k = count - 1;
  for (let i = 0; i < count; i++) {
    if (line < pStarts[i]!) {
      k = Math.max(0, i - 1);
      break;
    }
  }
  let cl = line - pStarts[k]! + (cStarts[k] ?? 1);
  const unit = nthFilteredChild(doc, k);
  if (unit && isListType(unit.type.name) && maps.anchorN.has(k)) {
    const oSet = ctx.listItems[k];
    if (oSet) {
      for (let j = 0; j < oSet.spans.length; j++) {
        if (line >= oSet.spans[j]!.start + 1 && line <= oSet.spans[j]!.end) {
          const itemOffset = oSet.sigs
            .slice(0, j)
            .reduce((sum, t) => sum + (t.split("\n").length - (t.endsWith("\n") ? 1 : 0)), 0);
          cl = (cStarts[k] ?? 1) + itemOffset + (line - (oSet.spans[j]!.start + 1));
          break;
        }
      }
    }
  }
  const approx = canonLineColToPos(doc, cl, col);
  // canonical 映射在块内容起点会右移一个字符（cut 序列化丢掉块分隔 / 首字符），
  // 反向换算靠它就会把光标放到"首字符之后"。用正向保真映射校验邻近位置，
  // 命中的第一个文本位置才是用户请求的那一列。
  const matches = (p: number): boolean => {
    const mapped = preservedPosToLineCol(ctx, doc, p);
    return !!mapped && mapped.line === line && mapped.col === col;
  };
  if (matches(approx)) return approx;
  let fallback: number | null = null;
  for (let delta = 1; delta <= 3; delta += 1) {
    for (const p of [approx - delta, approx + delta]) {
      if (p < 1 || p >= doc.content.size) continue;
      if (!matches(p)) continue;
      if (doc.resolve(p).parent.inlineContent) return p;
      if (fallback === null) fallback = p;
    }
  }
  return fallback ?? approx;
}

/** pos 所在的顶层单元（过滤 verbatim 节点）序号。 */
function unitIndexForPos(doc: PMNode, pos: number): number {
  const { unitStarts } = docLayout(doc);
  const n = unitStarts.length;
  if (n === 0) return 0;
  // 二分最后一个 start <= pos（单元起点单调递增），避免每次按键建 sizes 数组。
  let lo = 0;
  let hi = n - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (unitStarts[mid]! <= pos) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (ans < 0) return n - 1;
  const end = ans + 1 < n ? unitStarts[ans + 1]! : doc.content.size;
  if (pos >= unitStarts[ans]! && pos < end) return ans;
  return n - 1;
}

/** 过滤 verbatim 节点后的顶层单元布局（按 doc 身份缓存，每键被多处复用）。 */
interface DocLayout {
  /** 每个单元在 doc 中的起始偏移（0 起），与单元序号对齐。 */
  unitStarts: number[];
  types: string[];
}

const docLayoutCache = new WeakMap<PMNode, DocLayout>();

function docLayout(doc: PMNode): DocLayout {
  const cached = docLayoutCache.get(doc);
  if (cached) return cached;
  const unitStarts: number[] = [];
  const types: string[] = [];
  let cursor = 0;
  doc.forEach((child) => {
    if (isVerbatimRoot(child)) return;
    unitStarts.push(cursor);
    types.push(child.type.name);
    cursor += child.nodeSize;
  });
  const value = { unitStarts, types };
  docLayoutCache.set(doc, value);
  return value;
}

/** 第 k 个（过滤 verbatim 节点后）顶层子节点。 */
function nthFilteredChild(doc: PMNode, k: number): PMNode | null {
  let idx = -1;
  let out: PMNode | null = null;
  doc.forEach((child) => {
    if (isVerbatimRoot(child)) return;
    idx++;
    if (idx === k) out = child;
  });
  return out;
}

/** 第 k 个（过滤 verbatim 节点后）顶层子节点的起始 doc 位置。 */
function filteredChildStart(doc: PMNode, k: number): number {
  return docLayout(doc).unitStarts[k] ?? 0;
}

/** 过滤 verbatim 节点后的顶层子节点类型（与 canonicalUnits/nTexts 对齐）。 */
function filteredChildTypes(doc: PMNode): string[] {
  return docLayout(doc).types;
}

/** pos 所在的顶层列表的 direct item 序号。 */
function itemIndexForPos(list: PMNode, pos: number): number {
  const sizes: number[] = [];
  list.forEach((item) => sizes.push(item.nodeSize));
  let cursor = 0;
  for (let idx = 0; idx < sizes.length; idx++) {
    const end = cursor + sizes[idx]!;
    if (pos >= cursor && pos < end) return idx;
    cursor = end;
  }
  return sizes.length - 1;
}
