import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import { getScrollParent } from "./scroll-parent.ts";

export const BUFFER_BLOCKS = 200;
export const FULL_DOC_THRESHOLD = 1000;

export type ViewportState = {
  blockStart: number;
  blockEnd: number;
  fullDoc: boolean;
};

const blockCountCache = new WeakMap<PMNode, number>();

export function countTextblocks(doc: PMNode): number {
  const cached = blockCountCache.get(doc);
  if (cached !== undefined) return cached;
  let count = 0;
  doc.descendants((node) => {
    if (node.isTextblock) count++;
    return true;
  });
  blockCountCache.set(doc, count);
  return count;
}

export function sameViewport(a: ViewportState, b: ViewportState): boolean {
  return (
    a.fullDoc === b.fullDoc &&
    a.blockStart === b.blockStart &&
    a.blockEnd === b.blockEnd
  );
}

function cursorBlockIndex(state: EditorState): number {
  const { $from } = state.selection;
  let cursorBlockPos: number | null = null;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).isTextblock) {
      cursorBlockPos = $from.before(d);
      break;
    }
  }
  if (cursorBlockPos === null) return 0;

  let index = 0;
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (pos >= cursorBlockPos!) return false;
    index++;
    return true;
  });
  return index;
}

function computeViewport(state: EditorState): ViewportState {
  const total = countTextblocks(state.doc);

  if (total <= FULL_DOC_THRESHOLD) {
    return { blockStart: 0, blockEnd: total, fullDoc: true };
  }

  const cursorIdx = cursorBlockIndex(state);

  const halfBuffer = Math.floor(BUFFER_BLOCKS / 2);
  let blockStart = Math.max(0, cursorIdx - halfBuffer);
  let blockEnd = Math.min(total, cursorIdx + halfBuffer);

  if (blockEnd - blockStart < BUFFER_BLOCKS && total > BUFFER_BLOCKS) {
    if (blockStart === 0) {
      blockEnd = Math.min(total, BUFFER_BLOCKS);
    } else if (blockEnd === total) {
      blockStart = Math.max(0, total - BUFFER_BLOCKS);
    }
  }

  return { blockStart, blockEnd, fullDoc: false };
}

function posToBlockIndex(state: EditorState, docPos: number): number {
  let idx = 0;
  let found = -1;
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (pos + node.nodeSize > docPos) {
      found = idx;
      return false;
    }
    idx++;
    return true;
  });
  return found >= 0 ? found : idx;
}

export function computeViewportFromScroll(
  view: EditorView,
  state: EditorState,
): ViewportState | null {
  try {
    const total = countTextblocks(state.doc);
    if (total <= FULL_DOC_THRESHOLD) return null;

    const scroller = getScrollParent(view);
    const container = scroller.getBoundingClientRect();
    if (container.height <= 0) return null;

    const editor = view.dom.getBoundingClientRect();
    const leftEdge = Math.max(container.left, editor.left, 0);
    const rightEdge = Math.min(container.right, editor.right, window.innerWidth);
    if (rightEdge <= leftEdge) return null;

    const left = (leftEdge + rightEdge) / 2;
    const top = Math.max(container.top, editor.top, 0) + 20;
    const bottom =
      Math.min(container.bottom, editor.bottom, window.innerHeight) - 20;
    if (bottom <= top) return null;

    const topAt = view.posAtCoords({ left, top });
    const bottomAt = view.posAtCoords({ left, top: bottom });
    if (!topAt || !bottomAt) return null;

    const topBlock = posToBlockIndex(state, topAt.pos);
    const bottomBlock = posToBlockIndex(state, bottomAt.pos);
    if (topBlock < 0 || bottomBlock < 0) return null;

    const halfBuffer = Math.floor(BUFFER_BLOCKS / 2);
    const blockStart = Math.max(0, topBlock - halfBuffer);
    const blockEnd = Math.min(total, bottomBlock + halfBuffer);

    return { blockStart, blockEnd, fullDoc: false };
  } catch {
    return null;
  }
}

const VIEWPORT_REFRESH_META = "viewport-refresh";

export const viewportPluginKey = new PluginKey<ViewportState>("viewport");

export function viewportPlugin(): Plugin<ViewportState> {
  let attachedView: EditorView | null = null;

  return new Plugin<ViewportState>({
    key: viewportPluginKey,
    state: {
      init: (_, state) => computeViewport(state),
      apply: (tr, prev, oldState, newState) => {
        if (tr.docChanged) {
          const total = countTextblocks(newState.doc);
          // 仍是小文档：整篇都在装饰范围内，重算不改变任何消费者看到的结果。
          if (prev.fullDoc && total <= FULL_DOC_THRESHOLD) return prev;
          // 打字不该让窗口先退回「光标窗口」：块数没变、光标仍在原窗口内时
          // 保持窗口不变。否则同一次事务里 normalize / decorations 会按新
          // 窗口重建，边缘装饰要等下一帧滚动刷新才补回来。
          if (!prev.fullDoc && total === countTextblocks(oldState.doc)) {
            const cursor = cursorBlockIndex(newState);
            if (cursor >= prev.blockStart && cursor < prev.blockEnd) return prev;
          }
          return computeViewport(newState);
        }

        // 刷新事务已由调用方算好窗口，直接用，不重复测量（`true` 为兼容回退）。
        const meta = tr.getMeta(VIEWPORT_REFRESH_META) as
          | ViewportState
          | true
          | undefined;
        if (meta) {
          return typeof meta === "object" ? meta : computeViewport(newState);
        }

        const fromScroll = attachedView
          ? computeViewportFromScroll(attachedView, newState)
          : null;
        if (fromScroll) return fromScroll;

        if (
          oldState.selection.from === newState.selection.from &&
          oldState.selection.to === newState.selection.to
        ) {
          return prev;
        }
        return computeViewport(newState);
      },
    },
    view(view) {
      attachedView = view;
      let raf = 0;
      let destroyed = false;
      let lastScrollTop = Number.NaN;
      let forcePending = false;

      const refresh = (force = false) => {
        if (destroyed) return;
        if (force) forcePending = true;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (destroyed) return;
          const forced = forcePending;
          forcePending = false;
          const scroller = getScrollParent(view);
          if (!forced && Number.isFinite(lastScrollTop)) {
            // 200 块缓冲约十几屏：几十像素的滚动不会改变采样到的窗口，
            // 没必要为它派发元事务（decoration 会跟着重建）。
            const step = Math.max(64, scroller.clientHeight / 8);
            if (Math.abs(scroller.scrollTop - lastScrollTop) < step) return;
          }
          lastScrollTop = scroller.scrollTop;

          const next =
            computeViewportFromScroll(view, view.state) ??
            computeViewport(view.state);
          const cur = viewportPluginKey.getState(view.state);
          if (cur && sameViewport(cur, next)) return;
          view.dispatch(view.state.tr.setMeta(VIEWPORT_REFRESH_META, next));
        });
      };

      const scroller = getScrollParent(view);
      const onScroll = () => refresh(false);
      scroller.addEventListener("scroll", onScroll, { passive: true });

      const resizeObserver =
        typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(() => refresh(true))
          : null;
      resizeObserver?.observe(scroller);

      refresh(true);

      return {
        update(_view, prevState) {
          if (prevState.doc !== view.state.doc) refresh(true);
        },
        destroy() {
          destroyed = true;
          attachedView = null;
          scroller.removeEventListener("scroll", onScroll);
          resizeObserver?.disconnect();
          if (raf !== 0) cancelAnimationFrame(raf);
        },
      };
    },
  });
}

export function getViewport(state: EditorState): ViewportState {
  return viewportPluginKey.getState(state) ?? { blockStart: 0, blockEnd: 0, fullDoc: true };
}

export function getViewportDocRange(
  state: EditorState,
): { from: number; to: number } | null {
  const vp = getViewport(state);
  if (vp.fullDoc) return null;

  let blockIdx = 0;
  let from = -1;
  let to = -1;
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (blockIdx === vp.blockStart) from = pos;
    if (blockIdx === vp.blockEnd - 1) {
      to = pos + node.nodeSize;
      return false;
    }
    blockIdx++;
    return blockIdx < vp.blockEnd;
  });

  if (from === -1 || to === -1) return null;
  return { from, to };
}
