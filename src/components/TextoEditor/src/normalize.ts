// Normalize plugin — the authoritative "text → marks" step.
//
// After every transaction, walk each textblock, run the inline locator on its
// textContent, and reconcile em/strong marks to match. Delim ranges are
// exposed via plugin state so the decorations plugin can render them as
// syntax-hint / syntax-hidden.

import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import type { Mapping } from "prosemirror-transform";

import { collectInlineFeatures } from "./features/index.ts";
import type { InlineFeatureSpec } from "./features/_types.ts";
import { takeLoadSpans } from "./features/load-derivation.ts";
import { parseInlineWith, type InlineSpan } from "./inline-parse.ts";
import { getSchema } from "./schema.ts";
import {
  getViewport,
  getViewportDocRange,
  sameViewport,
  type ViewportState,
} from "./viewport.ts";

export type DelimRange = {
  from: number;
  to: number;
  // The surrounding mark's full source range (open start .. close end).
  // Used by decoration/display to decide whether the cursor is "inside".
  spanFrom: number;
  spanTo: number;
  // When true, decorations renders this delim as `syntax-hint` regardless
  // of cursor position. Used for links whose visible content is empty —
  // hiding the delim would make the link disappear entirely.
  forceVisible?: boolean;
  // When true, the range is hidden when the cursor is outside the span
  // and rendered as plain text (no decoration) when the cursor is inside.
  // Used for soft whitespace ranges inside a code fence.
  softInside?: boolean;
  // When true, the range is hidden regardless of cursor — used for atomic
  // markers like task-list `[ ] ` whose source is not user-editable.
  forceHidden?: boolean;
  // Override the default decoration class.
  className?: string;
};

export type ExtraDecoration = {
  from: number;
  to: number;
  nodeName: string;
  attrs?: Record<string, string>;
};

export type WidgetDecoration = {
  pos: number;
  spanFrom: number;
  spanTo: number;
  when: "inside" | "outside" | "always";
  kind: string;
  attrs?: Record<string, string>;
  side?: number;
  /** 沿用内置 widget 的「吞事件」语义（见 InlineSpan.widgetDecorations）。 */
  stopEvents?: boolean;
};

export type NormalizeState = {
  viewport: ViewportState;
  delims: DelimRange[];
  extras: ExtraDecoration[];
  widgets: WidgetDecoration[];
  // Cached for appendTransaction's mark-sync pass — avoids walking the
  // whole doc twice per transaction. Populated by state.apply / init.
  blocks: BlockEntry[];
  // blocks / BlockEntry.node 对应的文档。appendTransaction 只有在它与当前
  // 文档同一时才可直接用缓存的节点，否则回退按位置查找。
  doc: PMNode;
};

type BlockPlan = { blockStart: number; spans: InlineSpan[] };

// `viewportIndex` is the block's index in the viewport plugin's space, which
// counts *every* textblock (including code_block / image_ref). Those excluded
// node types are skipped for decoration purposes but still advance the index,
// so slicing by viewport window stays aligned with the viewport state.
type BlockEntry = {
  blockPos: number;
  plan: BlockPlan;
  viewportIndex: number;
  // 该 plan 对应的文本块节点（上一次计算时的 doc 里的同一块）。下次事务复用
  // plan 时直接比对这里的节点，不必再按位置从旧 doc 里取（nodeAt 是 O(pos)，
  // 逐块调用在万级文本块的长文档上累计成 O(n²)，单次按键要两百多毫秒）。
  node: PMNode;
};

function attrsEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

// textContent 偏移 → 文本块内容偏移。
// 行内原子节点（如任务标记）占 PM 位置但不在 textContent 里，必须补上这段位移，
// 否则原子节点之后的 span 会整体左移，标记/隐藏区间压到相邻字符上。
// 文本叶子按 doc 顺序记录各自内容位置；原子节点不进 textContent，其 nodeSize
// 自然体现在后续文本叶子的位置上。末尾偏移取「最后一个文本字符之后」，
// 不吞掉尾部的原子节点。
function buildOffsetMap(node: PMNode): (offset: number) => number {
  const textLen = node.textContent.length;
  const map = new Uint32Array(textLen + 1);
  let tc = 0;
  let endPm = 0;
  node.descendants((child, pos) => {
    if (!child.isText) return true;
    const text = child.text ?? "";
    for (let i = 0; i < text.length; i++) map[tc + i] = pos + i;
    tc += text.length;
    endPm = pos + text.length;
    return false;
  });
  map[textLen] = endPm;
  return (offset) => map[Math.max(0, Math.min(offset, textLen))]!;
}

/** 行内原子布局签名（只取非文本子节点的大小序列），用于缓存复用判定。 */
function inlineAtomLayout(node: PMNode): string {
  let sig = "";
  node.forEach((child) => {
    if (!child.isText) sig += `${child.nodeSize},`;
  });
  return sig;
}

// 大文档每键都要遍历全部文本块：`node.textContent` 会为每块分配一个新字符串，
// 原子布局签名也是逐块拼出来的——而未改动的块内容其实完全没变。两者都只依赖
// 块节点本身，按节点身份缓存后，ProseMirror 的结构共享让它们零成本命中。
const blockTextCache = new WeakMap<PMNode, string>();
const atomLayoutCache = new WeakMap<PMNode, string>();

function cachedTextContent(node: PMNode): string {
  const hit = blockTextCache.get(node);
  if (hit !== undefined) return hit;
  const text = node.textContent;
  blockTextCache.set(node, text);
  return text;
}

function cachedAtomLayout(node: PMNode): string {
  const hit = atomLayoutCache.get(node);
  if (hit !== undefined) return hit;
  const sig = inlineAtomLayout(node);
  atomLayoutCache.set(node, sig);
  return sig;
}

/** 就地把 span（含 delimRanges / extraDecorations / widget pos）偏移映射到内容空间。 */
function mapSpanOffsets(spans: InlineSpan[], toPm: (o: number) => number): void {
  for (const s of spans) {
    s.from = toPm(s.from);
    s.to = toPm(s.to);
    s.openFrom = toPm(s.openFrom);
    s.openTo = toPm(s.openTo);
    s.closeFrom = toPm(s.closeFrom);
    s.closeTo = toPm(s.closeTo);
    if (s.delimRanges) {
      for (const d of s.delimRanges) {
        d.from = toPm(d.from);
        d.to = toPm(d.to);
      }
    }
    if (s.extraDecorations) {
      for (const e of s.extraDecorations) {
        e.from = toPm(e.from);
        e.to = toPm(e.to);
      }
    }
    if (s.widgetDecorations) {
      for (const w of s.widgetDecorations) w.pos = toPm(w.pos);
    }
  }
}

type Projection = {
  delims: DelimRange[];
  extras: ExtraDecoration[];
  widgets: WidgetDecoration[];
};

/** 把单个块的 spans（内容空间偏移）投影成绝对位置的装饰数据。 */
function collectSpanDecorations(
  blockStart: number,
  spans: InlineSpan[],
  delims: DelimRange[],
  extras: ExtraDecoration[],
  widgets: WidgetDecoration[],
): void {
  for (const s of spans) {
    const spanFrom = blockStart + s.openFrom;
    const spanTo = blockStart + s.closeTo;
    if (s.delimRanges) {
      for (const dr of s.delimRanges) {
        delims.push({
          from: blockStart + dr.from,
          to: blockStart + dr.to,
          spanFrom,
          spanTo,
          forceVisible: dr.forceVisible,
          softInside: dr.softInside,
          forceHidden: dr.forceHidden,
          className: dr.className,
        });
      }
    } else {
      delims.push({
        from: blockStart + s.openFrom,
        to: blockStart + s.openTo,
        spanFrom,
        spanTo,
      });
      delims.push({
        from: blockStart + s.closeFrom,
        to: blockStart + s.closeTo,
        spanFrom,
        spanTo,
      });
    }
    if (s.extraDecorations) {
      for (const ex of s.extraDecorations) {
        extras.push({
          from: blockStart + ex.from,
          to: blockStart + ex.to,
          nodeName: ex.nodeName,
          attrs: ex.attrs,
        });
      }
    }
    if (s.widgetDecorations) {
      for (const w of s.widgetDecorations) {
        widgets.push({
          pos: blockStart + w.pos,
          spanFrom,
          spanTo,
          when: w.when,
          kind: w.kind,
          attrs: w.attrs,
          side: w.side,
          stopEvents: w.stopEvents,
        });
      }
    }
  }
}

/** 按窗口的 viewport 索引切片，O(log n + 窗口块数)。`blocks` 与文档顺序一一对应。 */
function projectDecorations(
  blocks: BlockEntry[],
  viewport: ViewportState,
): Projection {
  const result: Projection = { delims: [], extras: [], widgets: [] };
  const start = viewport.fullDoc
    ? 0
    : lowerBound(blocks, Math.max(0, viewport.blockStart));
  const end = viewport.blockEnd;
  for (let i = start; i < blocks.length; i += 1) {
    const entry = blocks[i]!;
    if (!viewport.fullDoc && entry.viewportIndex >= end) break;
    collectSpanDecorations(
      entry.plan.blockStart,
      entry.plan.spans,
      result.delims,
      result.extras,
      result.widgets,
    );
  }
  return result;
}

/** 第一个 `viewportIndex >= target` 的下标；全部小于 target 时返回 length。 */
function lowerBound(blocks: BlockEntry[], target: number): number {
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (blocks[mid]!.viewportIndex < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Walk the doc, return per-textblock parse plan + absolute-pos delim list.
// When oldDoc/prevBlocks/mapping are provided, reuse locator results for
// textblocks whose content + attrs are unchanged from the previous state.
// When viewport is provided and fullDoc is false, only store delim/extra/widget
// entries for textblocks within the viewport range (blocks list always includes all).
function computePlan(
  doc: PMNode,
  prevBlocks?: BlockEntry[],
  mapping?: Mapping,
  viewport?: ViewportState,
): {
  blocks: BlockEntry[];
  delims: DelimRange[];
  extras: ExtraDecoration[];
  widgets: WidgetDecoration[];
} {
  const blocks: BlockEntry[] = [];
  const delims: DelimRange[] = [];
  const extras: ExtraDecoration[] = [];
  const widgets: WidgetDecoration[] = [];

  // Build lookup: old block plan by its mapped-new position
  const cache = new Map<number, { plan: BlockPlan; oldNode: PMNode }>();
  if (prevBlocks && mapping) {
    for (const b of prevBlocks) {
      cache.set(mapping.map(b.blockPos), { plan: b.plan, oldNode: b.node });
    }
  }

  const storeDecos = !viewport || viewport.fullDoc;

  let viewportIndex = 0;
  doc.descendants((node, pos, parent) => {
    if (!node.isTextblock) return true;
    const currentViewportIndex = viewportIndex;
    viewportIndex += 1;
    if (node.type.name === "code_block" || node.type.name === "image_ref") {
      return false;
    }

    const text = cachedTextContent(node);
    const blockStart = pos + 1;
    let spans: InlineSpan[] | null = null;

    const cached = cache.get(pos);
    if (
      cached &&
      cachedTextContent(cached.oldNode) === text &&
      // 行内原子节点的数量/大小决定 textContent 偏移到内容偏移的位移，
      // 布局一变（例如任务标记被移除）就必须重新解析映射，不能复用缓存。
      cachedAtomLayout(cached.oldNode) === cachedAtomLayout(node) &&
      attrsEqual(cached.oldNode.attrs as Record<string, unknown>, node.attrs as Record<string, unknown>)
    ) {
      spans = cached.plan.spans;
    }

    if (spans === null) {
      // 加载期已对同一文本派生过：克隆后直接做偏移映射，避免重复 derive。
      const loaded = takeLoadSpans(node, text);
      if (loaded) {
        // 登记守卫保证命中块没有行内原子（硬换行等）：此时 textContent
        // 偏移就是节点内容偏移，无需再做偏移映射。
        spans = loaded;
      } else {
        const parsed = parseInlineWith(text, parent).spans;
        // 只在首次解析后映射一次：缓存分支里的 spans 已是内容空间偏移。
        mapSpanOffsets(parsed, buildOffsetMap(node));
        spans = parsed;
      }
    }

    blocks.push({
      blockPos: pos,
      plan: { blockStart, spans },
      viewportIndex: currentViewportIndex,
      node,
    });

    const inViewport =
      storeDecos ||
      (currentViewportIndex >= viewport!.blockStart &&
        currentViewportIndex < viewport!.blockEnd);

    if (inViewport) {
      collectSpanDecorations(blockStart, spans, delims, extras, widgets);
    }

    return false;
  });
  return { blocks, delims, extras, widgets };
}

const normalizeKey = new PluginKey<NormalizeState>("normalize-inline");

// markNames 是静态声明（插件贡献在启动后不变），每次事务 flatMap 一遍纯属浪费。
// 用 features 数组的身份做失效判据：`resetFeaturesForTests` 后 collectInlineFeatures()
// 会返回新数组，缓存随之重建（避免测试之间串味）。
let _managedNamesSource: readonly InlineFeatureSpec[] | undefined;
let _managedNames: string[] = [];

function managedMarkNames(): string[] {
  const features = collectInlineFeatures();
  if (features !== _managedNamesSource) {
    _managedNamesSource = features;
    _managedNames = features.flatMap((f) => f.markNames);
  }
  return _managedNames;
}

export function normalizeInlinePlugin(): Plugin<NormalizeState> {
  return new Plugin<NormalizeState>({
    key: normalizeKey,

    state: {
      init: (_, state) => {
        const viewport = getViewport(state);
        return {
          viewport,
          doc: state.doc,
          ...computePlan(state.doc, undefined, undefined, viewport),
        };
      },
      apply: (tr, prev, _oldState, newState) => {
        const viewport = getViewport(newState);
        if (!tr.docChanged) {
          if (sameViewport(prev.viewport, viewport)) return prev;
          return { ...prev, viewport, ...projectDecorations(prev.blocks, viewport) };
        }
        return {
          viewport,
          doc: newState.doc,
          ...computePlan(newState.doc, prev.blocks, tr.mapping, viewport),
        };
      },
    },

    appendTransaction(_transactions, _oldState, newState) {
      // Reuse the plan computed in state.apply rather than walking the
      // doc a second time. (Caching cut a 50-blocks doc's per-tx
      // overhead roughly in half.)
      const planState = normalizeKey.getState(newState);
      if (!planState) return null;
      const { blocks } = planState;
      const tr = newState.tr;
      const schema = getSchema();
      const managedNames = managedMarkNames();
      const managedTypes = managedNames
        .map((n) => schema.marks[n])
        .filter((t): t is NonNullable<typeof t> => !!t);
      let changed = false;

      // Viewport-limited reconciliation: only process blocks within viewport range
      const docRange = getViewportDocRange(newState);

      // 计划缓存来自同一份文档时直接用缓存的节点：doc.nodeAt(pos) 每次都要
      // 从文档头走到 pos（O(pos)），逐块调用在万级文本块的长文档上是 O(n²)，
      // 单次按键会为这一行多花两百多毫秒。
      const planDocMatches = planState.doc === newState.doc;

      for (const entry of blocks) {
        const { blockPos, plan } = entry;
        const blockNode = planDocMatches ? entry.node : newState.doc.nodeAt(blockPos);
        if (!blockNode || !blockNode.isTextblock) continue;

        // Viewport filtering: skip blocks outside visible range
        if (docRange && (blockPos >= docRange.to || blockPos + blockNode.nodeSize <= docRange.from)) {
          continue;
        }

        const { blockStart, spans } = plan;
        const blockEnd = blockStart + blockNode.content.size;
        const size = blockNode.content.size;

        // Fast skip: if this block has no spans for ANY managed type AND
        // no existing managed marks on its text, there's nothing to
        // reconcile — the most common case for plain prose paragraphs.
        if (spans.length === 0) {
          let hasManaged = false;
          blockNode.content.forEach((child) => {
            for (const mk of child.marks)
              if (managedTypes.includes(mk.type)) { hasManaged = true; return; }
          });
          if (!hasManaged) continue;
        }

        for (const markType of managedTypes) {
          const name = markType.name;

          // Per-name fast skip: if no span of this type AND no existing
          // mark of this type on the block, nothing to do.
          let spansOfType = false;
          for (const s of spans) if (s.type === name) { spansOfType = true; break; }
          let hasMarkOfType = false;
          if (!spansOfType) {
            blockNode.content.forEach((child) => {
              if (hasMarkOfType) return;
              if (child.marks.some((mk) => mk.type === markType)) hasMarkOfType = true;
            });
            if (!hasMarkOfType) continue;
          }

          // For attr-bearing marks (link, image) coverage equality isn't
          // enough — attrs (href / src / title) can change while coverage
          // stays the same. Build a per-position mark map and compare with
          // mark.eq() so we don't keep re-emitting identical removeMark+
          // addMark steps every transaction (PM would re-fire
          // appendTransaction on those steps and we'd loop).
          const targetMarks = new Array<import("prosemirror-model").Mark | null>(
            size,
          ).fill(null);
          for (const s of spans) {
            if (s.type !== name) continue;
            const m = markType.create(s.attrs);
            for (let i = s.from; i < s.to; i++) targetMarks[i] = m;
          }
          const currentMarks = new Array<import("prosemirror-model").Mark | null>(
            size,
          ).fill(null);
          {
            let cOff = 0;
            blockNode.content.forEach((child) => {
              const m = child.marks.find((mk) => mk.type === markType) ?? null;
              for (let i = 0; i < child.nodeSize; i++) currentMarks[cOff + i] = m;
              cOff += child.nodeSize;
            });
          }
          let same = true;
          for (let i = 0; i < size; i++) {
            const a = targetMarks[i];
            const b = currentMarks[i];
            if (a === b) continue;
            if (!a || !b || !a.eq(b)) {
              same = false;
              break;
            }
          }
          if (same) continue;

          tr.removeMark(blockStart, blockEnd, markType);
          for (const s of spans) {
            if (s.type === name)
              tr.addMark(blockStart + s.from, blockStart + s.to, markType.create(s.attrs));
          }
          changed = true;
        }
      }

      return changed ? tr : null;
    },
  });
}

export function getDelims(state: EditorState): DelimRange[] {
  return normalizeKey.getState(state)?.delims ?? [];
}

export function getExtras(state: EditorState): ExtraDecoration[] {
  return normalizeKey.getState(state)?.extras ?? [];
}

export function getWidgets(state: EditorState): WidgetDecoration[] {
  return normalizeKey.getState(state)?.widgets ?? [];
}
