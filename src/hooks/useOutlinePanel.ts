import { useState, useCallback, useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

// 各窗口独立持久化：localStorage key 按窗口 label 后缀区分。
// 浏览器环境（无 Tauri）下 getCurrentWindow 不可用，回退到共享 key。
let windowStorageSuffix = '';
try {
  const label = getCurrentWindow().label;
  if (label) windowStorageSuffix = `:${label}`;
} catch {
  windowStorageSuffix = '';
}

const OUTLINE_PANEL_WIDTH_KEY = `texto:outline-panel-width${windowStorageSuffix}`;
const DEFAULT_OUTLINE_PANEL_WIDTH = 260;
const MIN_OUTLINE_PANEL_WIDTH = 200;
const MAX_OUTLINE_PANEL_WIDTH = 420;
const OUTLINE_PANEL_ID = 'outline-panel';
const OUTLINE_PANEL_INSET = 12;

export function useOutlinePanel() {
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(OUTLINE_PANEL_WIDTH_KEY);
    const parsed = saved ? parseInt(saved, 10) : DEFAULT_OUTLINE_PANEL_WIDTH;
    return Math.max(MIN_OUTLINE_PANEL_WIDTH, Math.min(MAX_OUTLINE_PANEL_WIDTH, parsed));
  });

  const [isResizing, setIsResizing] = useState(false);
  const finalWidthRef = useRef(width);

  useEffect(() => {
    if (!isResizing) return;

    const panelEl = document.getElementById(OUTLINE_PANEL_ID);
    const parent = panelEl?.parentElement;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = parent?.getBoundingClientRect();
      const right = rect ? rect.right : window.innerWidth;
      const containerWidth = rect ? rect.width : window.innerWidth;
      // 面板两侧各留 OUTLINE_PANEL_INSET 边距，宽度不得超过容器可用空间，
      // 否则面板左边缘（含 resize 把手）会被编辑器容器 overflow:hidden 裁剪而无法再拖回
      const availableMax = containerWidth - OUTLINE_PANEL_INSET * 2;
      const newWidth = right - OUTLINE_PANEL_INSET - e.clientX;
      const clamped = Math.min(
        Math.max(MIN_OUTLINE_PANEL_WIDTH, newWidth),
        MAX_OUTLINE_PANEL_WIDTH,
        availableMax,
      );
      finalWidthRef.current = clamped;
      if (panelEl) panelEl.style.width = `${clamped}px`;
    };

    const handleMouseUp = () => {
      document.body.classList.remove('is-resizing');
      setWidth(finalWidthRef.current);
      setIsResizing(false);
      localStorage.setItem(OUTLINE_PANEL_WIDTH_KEY, finalWidthRef.current.toString());
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.classList.remove('is-resizing');
    };
  }, [isResizing]);

  const handleResizeStart = useCallback(() => {
    setIsResizing(true);
    document.body.classList.add('is-resizing');
  }, []);

  return {
    width,
    isResizing,
    handleResizeStart,
  };
}
