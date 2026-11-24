import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { MOBILE_BREAKPOINT } from '@/app/constants';

/**
 * 窗口布局检测：窗口宽度、移动端断点判定、侧边栏 DOM ref。
 * 进入移动端布局时抑制侧边栏 CSS transition，避免展开动画。
 */
export function useAppLayout(sidebarCollapsed: boolean) {
  // 窗口宽度检测状态
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const isMobileLayout = windowWidth < MOBILE_BREAKPOINT;

  const sidebarRef = useRef<HTMLDivElement>(null);
  const prevMobileLayoutRef = useRef(isMobileLayout);

  // 监听窗口大小变化：合并到一帧并跳过同值，避免拖动窗口时逐事件重渲染整棵树
  useEffect(() => {
    let rafId: number | null = null;
    const handleResize = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const width = window.innerWidth;
        setWindowWidth((prev) => (prev === width ? prev : width));
      });
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  // 进入移动端布局时，如果侧边栏已经折叠，抑制 CSS transition 动画
  useLayoutEffect(() => {
    const prev = prevMobileLayoutRef.current;
    if (isMobileLayout && !prev && sidebarCollapsed && sidebarRef.current) {
      const el = sidebarRef.current;
      el.setAttribute('data-suppress-transition', '');
      void el.offsetWidth;
      requestAnimationFrame(() => {
        el.removeAttribute('data-suppress-transition');
      });
    }
    prevMobileLayoutRef.current = isMobileLayout;
  }, [isMobileLayout, sidebarCollapsed]);

  return { windowWidth, isMobileLayout, sidebarRef };
}
