import { Menu, PredefinedMenuItem, type MenuItemOptions } from '@tauri-apps/api/menu';
import { LogicalPosition } from '@tauri-apps/api/window';

import type { ContextMenuModelEntry } from './build.ts';

/** 非 Tauri 环境（网页演示 / 单测）没有原生菜单后端。 */
function hasNativeMenu(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let warnedNoBackend = false;

/** 降级路径只提示一次，避免刷屏（真机冒烟时也能据此判断为何没弹出）。 */
function warnNoBackendOnce(): void {
  if (warnedNoBackend) return;
  warnedNoBackend = true;
  console.warn('[context-menu] no native menu backend; skip popup');
}

/**
 * 用 Tauri 原生菜单弹出右键菜单。
 * 非 Tauri 环境跳过（仅提示一次）；创建/弹出异常只记录，不外溢到调用方。
 */
export async function openContextMenu(
  entries: ContextMenuModelEntry[],
  x: number,
  y: number,
): Promise<void> {
  if (!hasNativeMenu()) {
    warnNoBackendOnce();
    return;
  }
  try {
    const items: Array<PredefinedMenuItem | MenuItemOptions> = [];
    for (const entry of entries) {
      if (entry.separator) {
        items.push(await PredefinedMenuItem.new({ item: 'Separator' }));
        continue;
      }
      items.push({
        id: entry.id,
        text: entry.text,
        enabled: entry.enabled,
        action: () => entry.run?.(),
      });
    }
    const menu = await Menu.new({ items });
    await menu.popup(new LogicalPosition(x + 1, y + 1));
  } catch (err) {
    console.error('[context-menu] failed to open native menu:', err);
  }
}
