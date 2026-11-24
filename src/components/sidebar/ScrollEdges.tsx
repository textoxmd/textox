import { useCallback, useEffect, useState } from 'react';

export interface ScrollEdgeState {
  /** 上方还有内容（滚动过，顶部需要渐隐） */
  canScrollUp: boolean;
  /** 下方还有内容（底部需要渐隐） */
  canScrollDown: boolean;
}

const HIDDEN: ScrollEdgeState = { canScrollUp: false, canScrollDown: false };

/**
 * 跟踪滚动容器上下是否还有内容，驱动滚动边缘渐隐（参考 macOS 26 的 scroll edge effect）。
 *
 * 返回 callback ref：容器被替换时（大纲空态 ↔ 树、搜索结果渲染）会自动重新观察。
 * 除滚动外还监听容器尺寸与内容增删：侧栏改宽、节点展开、结果追加都会改变可滚动范围。
 */
export function useScrollEdges<T extends HTMLElement = HTMLDivElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [state, setState] = useState<ScrollEdgeState>(HIDDEN);
  const ref = useCallback((next: T | null) => setNode(next), []);

  useEffect(() => {
    if (!node) {
      setState((prev) => (prev === HIDDEN ? prev : HIDDEN));
      return;
    }

    let frame = 0;
    const sync = () => {
      const canScrollUp = node.scrollTop > 0;
      const canScrollDown = node.scrollTop + node.clientHeight < node.scrollHeight - 1;
      setState((prev) =>
        prev.canScrollUp === canScrollUp && prev.canScrollDown === canScrollDown
          ? prev
          : { canScrollUp, canScrollDown },
      );
    };
    // 尺寸/内容变化可能连续触发，合并到下一帧，避免反复同步布局
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    };

    sync();
    node.addEventListener('scroll', sync, { passive: true });

    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    // 内容高度变化（节点展开/收起、结果追加）不一定改变容器尺寸，同时观察首个子元素
    const observeContent = () => {
      if (!resize) return;
      resize.disconnect();
      resize.observe(node);
      const content = node.firstElementChild;
      if (content) resize.observe(content);
    };
    observeContent();

    const mutation =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver((records) => {
            // 直接子节点增删后重新绑定内容观察目标；子树高度变化（大纲收起）只需重算
            if (records.some((record) => record.type === 'childList' && record.target === node)) {
              observeContent();
            }
            schedule();
          });
    mutation?.observe(node, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      node.removeEventListener('scroll', sync);
      resize?.disconnect();
      mutation?.disconnect();
    };
  }, [node]);

  return { ref, canScrollUp: state.canScrollUp, canScrollDown: state.canScrollDown };
}

interface ScrollEdgesProps extends ScrollEdgeState {
  /** 只渲染某一侧（默认两侧） */
  sides?: 'both' | 'top' | 'bottom';
}

/**
 * 滚动边缘渐隐层。必须放在滚动容器的父级（不滚动的定位容器）里，
 * 直接放进滚动容器会跟着内容一起滚走。
 */
export function ScrollEdges({ canScrollUp, canScrollDown, sides = 'both' }: ScrollEdgesProps) {
  return (
    <>
      {sides !== 'bottom' && (
        <div
          className={`scroll-edge scroll-edge-top${canScrollUp ? ' is-visible' : ''}`}
          aria-hidden="true"
        />
      )}
      {sides !== 'top' && (
        <div
          className={`scroll-edge scroll-edge-bottom${canScrollDown ? ' is-visible' : ''}`}
          aria-hidden="true"
        />
      )}
    </>
  );
}
