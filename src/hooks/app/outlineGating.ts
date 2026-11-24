import type { OutlineStyle } from '@/app/types';

/** 侧栏大纲视图是否真的可见：折叠时不可见。 */
export function isSidebarOutlineVisible(activeTab: string, sidebarCollapsed: boolean): boolean {
  return activeTab === 'outline' && !sidebarCollapsed;
}

/** 大纲只在需要时计算：悬浮面板打开、侧栏大纲可见，或命令面板处于 `#` 模式。 */
export function shouldComputeOutline(
  outlineStyle: OutlineStyle,
  isOutlineMode: boolean,
  sidebarOutlineVisible: boolean,
): boolean {
  return outlineStyle !== 'off' || isOutlineMode || sidebarOutlineVisible;
}
