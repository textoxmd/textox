import { useLayoutEffect, useState } from 'react';

/**
 * 测量一个（通常是隐藏的）元素的内容宽度，并在其变化时返回新值。
 *
 * `enabled` MUST 与测量元素的挂载状态保持一致：元素随 `enabled` 条件渲染时，
 * 关闭 → 开启必须重新附加测量（否则首帧 `ref.current` 为空，宽度会永久停留在 0，
 * 元素退回内容自适应，宽度随内容变化）。
 */
export function useMeasuredWidth(
  ref: { readonly current: HTMLElement | null },
  enabled: boolean,
): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    const update = () => setWidth(el.scrollWidth);
    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, enabled]);

  return width;
}
