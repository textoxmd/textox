import { invoke } from '@tauri-apps/api/core';

import { isFreeVersion } from '@/app/constants';
import i18n from '@/i18n';
import { listExporters } from '@/utils/export';
import { IS_MAC } from '@/utils/windowManager';

import type { MenuItemSpec, SubmenuSpec } from './types';

/**
 * 由已注册导出器 + 原生导出项组装「导出」子菜单声明。
 *
 * `label` 在前端翻好再传：插件文案只存在于 WebView 的 `plugins` 命名空间，
 * Rust 的 `i18n::translate` 只有核心 bundle，传裸 key 会原样显示成
 * `app.textox.<id>.<key>`。
 *
 * `enabled: true` 是初值：子菜单会被插件注册反复重建，而 `update_export_menu`
 * （无文档/非 IR 时置灰）只在宿主侧调用一次。不显式开启的话，后注册的插件项
 * 会按 Rust 默认值 `false` 永远置灰。
 */
export function buildExportSubmenuSpec(): SubmenuSpec {
  const items: MenuItemSpec[] = [];
  for (const exporter of listExporters()) {
    if (!exporter.menuAction) continue;
    items.push({
      kind: 'item',
      id: exporter.menuAction,
      labelKey: exporter.labelKey,
      label: i18n.t(exporter.labelKey),
      acceleratorAction: exporter.menuAction,
      enabled: true,
    });
  }
  // 原生项（非插件）：插件项之后依次 png、pdf，顺序与现状一致。
  if (IS_MAC) {
    items.push({
      kind: 'item',
      id: 'export_png',
      labelKey: 'menu.export_png',
      label: i18n.t('menu.export_png'),
      enabled: true,
    });
  }
  items.push({
    kind: 'item',
    id: 'export_pdf',
    labelKey: 'menu.export_pdf',
    label: i18n.t('menu.export_pdf'),
    acceleratorAction: 'export_pdf',
    enabled: true,
  });
  return { id: 'export_submenu', labelKey: 'menu.export', items };
}

/** 把导出子菜单声明同步给 Rust 渲染（free 版本无导出菜单，跳过）。 */
export async function syncExportMenu(): Promise<void> {
  if (isFreeVersion) return;
  await invoke('sync_submenu', { spec: buildExportSubmenuSpec() });
}
