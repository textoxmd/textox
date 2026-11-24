import { useState, useCallback, useEffect, useRef } from 'react';

const SIDEBAR_COLLAPSED_KEY = 'texto:sidebar-collapsed';
const SIDEBAR_WIDTH_KEY = 'texto:sidebar-width';
const SIDEBAR_POSITION_KEY = 'texto:sidebar-position';
const DEFAULT_SIDEBAR_WIDTH = 250;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 500;

export function useSidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return saved ? JSON.parse(saved) : false;
  });

  const [position] = useState<'left' | 'right'>(() => {
    const saved = localStorage.getItem(SIDEBAR_POSITION_KEY);
    return (saved as 'left' | 'right') || 'left';
  });

  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_SIDEBAR_WIDTH;
  });

  const [isResizing, setIsResizing] = useState(false);
  const finalWidthRef = useRef(width);

  useEffect(() => {
    if (!isResizing) return;

    const sidebarEl = document.getElementById('sidebar');

    const handleMouseMove = (e: MouseEvent) => {
      let newWidth: number;
      if (position === 'right') {
        newWidth = window.innerWidth - e.clientX;
      } else {
        newWidth = e.clientX;
      }
      const clamped = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, newWidth));
      finalWidthRef.current = clamped;
      if (sidebarEl) sidebarEl.style.width = `${clamped}px`;
    };

    const handleMouseUp = () => {
      document.body.classList.remove('is-resizing');
      setWidth(finalWidthRef.current);
      setIsResizing(false);
      localStorage.setItem(SIDEBAR_WIDTH_KEY, finalWidthRef.current.toString());
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.classList.remove('is-resizing');
    };
  }, [isResizing, position]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev: boolean) => {
      const newValue = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, JSON.stringify(newValue));
      return newValue;
    });
  }, []);

  const setCollapsedValue = useCallback(
    (value: boolean, options?: { animate?: boolean }) => {
      // 程序化切换（如打开文件夹）可要求「直接显示布局」：
      // 先压制 CSS transition，等 React 把新宽度写进 DOM 后再恢复，
      // 避免侧边栏从旧宽度滑到新宽度。
      const animate = options?.animate ?? true;
      const el = animate ? null : document.getElementById('sidebar');
      // 用 data 属性而不是 className：Sidebar 的 className 由 React 托管，
      // 状态更新时会整体重写，手写的 class 会被覆盖掉。
      if (el) el.setAttribute('data-suppress-transition', '');

      setCollapsed(value);
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, JSON.stringify(value));

      if (el) {
        // 两帧：第一帧等 React 提交新宽度，第二帧再恢复过渡。
        requestAnimationFrame(() => {
          requestAnimationFrame(() => el.removeAttribute('data-suppress-transition'));
        });
      }
    },
    [],
  );

  const handleResize = useCallback((newWidth: number) => {
    const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, newWidth));
    setWidth(clampedWidth);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, clampedWidth.toString());
  }, []);

  const handleResizeStart = useCallback(() => {
    setIsResizing(true);
    document.body.classList.add('is-resizing');
  }, []);

  return {
    collapsed,
    position,
    width,
    isResizing,
    toggleCollapsed,
    setCollapsed: setCollapsedValue,
    handleResize,
    handleResizeStart,
  };
}
