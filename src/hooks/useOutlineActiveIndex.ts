import { useEffect, useState, type RefObject } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { TextoEditorRef } from '@/components/TextoEditor/TextoEditorRef';

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';
/** 视口顶部判定偏移：标题顶部越过此线即视为「当前」 */
const TOP_OFFSET = 16;

function headingElementAt(view: EditorView, pos: number): Element | null {
  try {
    const dom = view.domAtPos(pos + 1);
    const el = dom.node instanceof Element ? dom.node : dom.node.parentElement;
    if (!el) return null;
    return el.closest(HEADING_SELECTOR);
  } catch {
    return null;
  }
}

/** 从 view.dom 向上找到第一个可滚动的祖先（真正的编辑器滚动容器） */
function findScrollParent(el: Element | null): HTMLElement | null {
  let node: HTMLElement | null = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * 根据编辑器滚动位置计算「当前标题」在 outline 数组中的下标。
 * 仅支持 IR 模式（标题是 DOM 元素）；SV 模式返回 -1（无高亮）。
 */
export function useOutlineActiveIndex(
  editorRef: RefObject<TextoEditorRef | null>,
  outline: { pos?: number }[],
  editorMode: 'ir' | 'sv',
  enabled = true,
): number {
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (!enabled || editorMode !== 'ir' || outline.length === 0) {
      setActiveIndex(-1);
      return;
    }
    const view = editorRef.current?.editorView;
    const scrollParent = findScrollParent(view?.dom ?? null);
    if (!view || !scrollParent) return;

    const els = outline.map((h) => (h.pos != null ? headingElementAt(view, h.pos) : null));

    const compute = () => {
      const containerTop = scrollParent.getBoundingClientRect().top + TOP_OFFSET;
      let active = -1;
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (el && el.getBoundingClientRect().top <= containerTop) {
          active = i;
        }
      }
      // 顶部还没有任何标题越过判定线时，默认第 1 条为当前
      if (active === -1 && els.length > 0) active = 0;
      setActiveIndex(active);
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        compute();
      });
    };

    compute();
    scrollParent.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      scrollParent.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [editorRef, outline, editorMode, enabled]);

  return activeIndex;
}
