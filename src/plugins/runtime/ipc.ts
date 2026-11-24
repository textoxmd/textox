import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { PluginManifest } from '@textox/plugin-sdk';

/** `plugin_scan` 的条目：Rust 侧只保证 manifest 是合法 JSON 且 `id` 与目录名一致，
 * 业务字段（name / version / minAppVersion …）由 `validateManifest` 在加载时校验。 */
export interface InstalledPluginDto {
  id: string;
  dir: string;
  manifest: PluginManifest | null;
  enabled: boolean;
  error: string | null;
}

export interface PluginStateDto {
  safe_mode: boolean;
  enabled: string[];
  /** 插件目录的来源记录（`plugins.json`）：`seed` = 应用出厂播种，`user` = 本地导入。 */
  seeded?: Record<string, { version: string; origin: 'seed' | 'user' }>;
  /** 被卸载的出厂插件墓碑：清除后可重新播种。 */
  uninstalled?: string[];
}

/** 插件私有数据（`data.json` 的两个命名空间）。 */
export interface PluginData {
  settings: Record<string, unknown>;
  plugin: Record<string, unknown>;
}

export const pluginIpc = {
  /**
   * 出厂预装（播种）：把应用资源目录 `resources/plugins/<id>/` 里的出厂插件复制到
   * `<appData>/plugins/<id>/`，返回**本轮真实复制**的插件 id（已存在且同版本的跳过）。
   * 重复调用幂等；调用方负责随后重扫（新目录要重扫才可见）。
   */
  seedBundled: () => invoke<string[]>('plugin_seed_bundled'),
  scan: () => invoke<InstalledPluginDto[]>('plugin_scan'),
  getState: () => invoke<PluginStateDto>('plugin_get_state'),
  setEnabled: (id: string, enabled: boolean) =>
    invoke<PluginStateDto>('plugin_set_enabled', { id, enabled }),
  setSafeMode: (safeMode: boolean) =>
    invoke<PluginStateDto>('plugin_set_safe_mode', { safeMode }),
  readAsset: (pluginId: string, path: string) =>
    invoke<string>('plugin_read_asset', { pluginId, path }),
  readData: (pluginId: string) => invoke<PluginData>('plugin_read_data', { pluginId }),
  writeData: (pluginId: string, data: unknown) =>
    invoke<void>('plugin_write_data', { pluginId, data }),
  installFromFile: (path: string) =>
    invoke<InstalledPluginDto[]>('plugin_install_from_file', { path }),
  installFromUrl: (url: string) =>
    invoke<InstalledPluginDto[]>('plugin_install_from_url', { url }),
  uninstall: (pluginId: string) =>
    invoke<InstalledPluginDto[]>('plugin_uninstall', { pluginId }),
  /**
   * 恢复出厂插件：清墓碑 + 播种记录后立即重播。
   * Rust 侧返回本轮播种成功的插件 id（`Vec<String>`），调用方随后自行重扫。
   */
  restoreBuiltin: (pluginId: string) =>
    invoke<string[]>('plugin_restore_builtin', { pluginId }),
};

/** 插件数据变更广播的事件名（`plugin_write_data` 落盘后由 Rust 广播给所有窗口）。 */
export const PLUGIN_DATA_CHANGED_EVENT = 'plugin:data-changed';

/**
 * 订阅插件数据变更。返回的函数可以立即调用：`listen` 是异步的，
 * 在它 resolve 之前取消时会在 resolve 后立刻 unlisten，不留下泄漏的监听。
 */
export function subscribePluginDataChanged(handler: (pluginId: string) => void): () => void {
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  void listen<{ pluginId: string }>(PLUGIN_DATA_CHANGED_EVENT, (event) =>
    handler(event.payload.pluginId),
  )
    .then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    })
    .catch((error: unknown) => {
      // 非 Tauri 环境（浏览器 dev / 单测）没有事件后端：静默降级为「无热更新」
      console.warn('[plugin] subscribe plugin:data-changed failed', error);
    });
  return () => {
    cancelled = true;
    unlisten?.();
    unlisten = null;
  };
}
