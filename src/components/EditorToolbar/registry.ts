import { editorFormatToolbarItems, editorInsertCommands } from '../TextoEditor/src/extension/registry';
import { formatToolbarItemIncludesSurface } from '@texto/markdown-editor-api';
import { BUILTIN_TOOLBAR_ITEMS, contributedFormatToolbarItem, contributedToolbarItem } from './items';
import { TOOLBAR_GROUPS } from './groups';
import type { ToolbarItem } from './types';

// 运行时注册项（后续插件化入口）。冲突策略与插件扩展点一致：后注册优先。
const extraItems: ToolbarItem[] = [];

const VALID_GROUPS = new Set(TOOLBAR_GROUPS.map((g) => g.id));

/** 注册期基本校验。返回错误描述，合法则返回 null。 */
function validate(item: ToolbarItem): string | null {
  if (!item.id || typeof item.id !== 'string') return 'id 必须为非空字符串';
  if (!VALID_GROUPS.has(item.group)) return `未知分组：${String(item.group)}`;
  if (!Number.isFinite(item.order)) return 'order 必须为有限数';
  if (!item.labelKey || typeof item.labelKey !== 'string') return 'labelKey 必须为非空字符串';
  if (typeof item.run !== 'function') return 'run 必须为函数';
  if (!item.icon) return 'icon 缺失';
  return null;
}

/**
 * 注册额外工具栏项。
 * 注册期做基本校验，非法项仅 DEV 告警并忽略（不阻断）。
 * 同 id 时后注册者覆盖先注册者（含覆盖同名内置项）；DEV 下打印告警。
 */
export function registerToolbarItem(item: ToolbarItem): void {
  const problem = validate(item);
  if (problem) {
    if (import.meta.env.DEV) {
      console.warn(`[toolbar] 忽略非法 item（${item?.id ?? 'unknown'}）：${problem}`);
    }
    return;
  }

  const index = extraItems.findIndex((existing) => existing.id === item.id);
  if (index >= 0) {
    if (import.meta.env.DEV) {
      console.warn(`[toolbar] item id 冲突，后者覆盖前者：${item.id}`);
    }
    extraItems[index] = item;
    return;
  }

  if (BUILTIN_TOOLBAR_ITEMS.some((builtin) => builtin.id === item.id) && import.meta.env.DEV) {
    console.warn(`[toolbar] item id 覆盖同名内置项：${item.id}`);
  }
  extraItems.push(item);
}

/** 全部工具栏项（内置 + 运行时注册 + 插件贡献插入项 + 插件贡献格式项）。 */
export function listToolbarItems(): ToolbarItem[] {
  const contributed = editorInsertCommands().map(contributedToolbarItem);
  const contributedFormat = editorFormatToolbarItems()
    .filter((m) => formatToolbarItemIncludesSurface(m, 'toolbar'))
    .map(contributedFormatToolbarItem);

  // 按 id 去重，后来源覆盖先前项（贡献 > 运行时 > 内置）；同 id 保持原有位置，新 id 追加在后。
  const byId = new Map<string, ToolbarItem>();
  const order: string[] = [];
  const merge = (item: ToolbarItem) => {
    if (!byId.has(item.id)) order.push(item.id);
    byId.set(item.id, item);
  };
  for (const item of BUILTIN_TOOLBAR_ITEMS) merge(item);
  for (const item of extraItems) merge(item);
  for (const item of contributed) merge(item);
  for (const item of contributedFormat) merge(item);
  return order.map((id) => byId.get(id)!);
}

/** 仅供测试：清空运行时注册项。 */
export function resetToolbarItemsForTests(): void {
  extraItems.length = 0;
}
