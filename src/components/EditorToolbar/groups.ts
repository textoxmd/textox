import type { ToolbarGroup } from './types';

// section 定义：仅决定从左到右的渲染顺序与前导分隔线归属。
// 溢出折叠按「位置」从右往左逐项进行，不再按分组优先级整组隐藏。
export const TOOLBAR_GROUPS: ToolbarGroup[] = [
  { id: 'inline', order: 0 },
  { id: 'blocks', order: 1 },
  { id: 'lists', order: 2 },
  { id: 'insert', order: 3 },
];
