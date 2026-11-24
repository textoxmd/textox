import type { MutableRefObject, ReactNode, Ref } from 'react';
import { useLayoutEffect } from 'react';
import { TitleBar } from '@/components/TitleBar';
import { SidebarResizeHandle } from './SidebarResizeHandle';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface SidebarProps {
  collapsed: boolean;
  position: 'left' | 'right';
  width: number;
  isResizing: boolean;
  isMobileLayout: boolean;
  sidebarRef: Ref<HTMLDivElement>;
  onToggleCollapsed: () => void;
  onResizeStart: () => void;
  children: ReactNode;
}

export function Sidebar({
  collapsed,
  position,
  width,
  isResizing,
  isMobileLayout,
  sidebarRef,
  onToggleCollapsed,
  onResizeStart,
  children,
}: SidebarProps) {
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, a, .tree-node, .tree-tab, .resize-handle')) return;
    if (!(e.target as HTMLElement).closest('.title-bar')) return;
    getCurrentWindow().startDragging().catch(() => {});
  };

  useLayoutEffect(() => {
    if (isMobileLayout) return;
    const el = (sidebarRef as MutableRefObject<HTMLDivElement | null>).current;
    if (el) el.style.width = collapsed ? '0px' : `${width}px`;
  }, [width, collapsed, isMobileLayout]);

  return (
    <div
      ref={sidebarRef}
      id="sidebar"
      className={`sidebar-area ${position} ${collapsed ? 'collapsed' : ''} ${isResizing ? 'resizing' : ''} ${isMobileLayout ? 'mobile' : ''}`}
      onMouseDown={handleMouseDown}
    >
      <TitleBar
        title=""
        hasSidebar={!collapsed}
        isSidebarHeader
        sidebarPosition={position}
        onToggleSidebar={onToggleCollapsed}
      />
      {children}
      <SidebarResizeHandle position={position} onResizeStart={onResizeStart} />
    </div>
  );
}
