import { invoke } from '@tauri-apps/api/core';
import { readAppConfig, writeAppConfig } from '@/utils/appConfig';

import { setPluginEnabledState } from './pluginStatus';
import type { TextoPlugin } from './types';

/**
 * 把插件清单声明的历史配置迁移到插件体系（通用，骨架不含插件字面量）：
 * - `enableWhenImageStorageMode` 命中的插件 → 启用；
 * - `appConfigKeys` 中尚未设置的键 → 从 AppConfig 复制进插件配置；
 * - 迁移完成后把 `image_storage_mode` 改写为 `alongside_document`（幂等：只触发一次）。
 */
export async function migrateLegacyPluginState(plugins: TextoPlugin[]): Promise<void> {
  let config: Record<string, unknown>;
  try {
    config = await readAppConfig<Record<string, unknown>>();
  } catch (error) {
    console.error('[plugins] legacy migration skipped:', error);
    return;
  }
  if (!config) return;

  let migrated = false;
  for (const plugin of plugins) {
    const mode = plugin.migration?.enableWhenImageStorageMode;
    if (!mode || config.image_storage_mode !== mode) continue;

    setPluginEnabledState(plugin.id, true);

    const keyMap = plugin.migration?.appConfigKeys;
    if (keyMap) {
      const current = (await invoke<Record<string, unknown>>('get_plugin_config', {
        pluginId: plugin.id,
      })) ?? {};
      const next: Record<string, unknown> = { ...current };
      let changed = false;
      for (const [pluginKey, appKey] of Object.entries(keyMap)) {
        if (next[pluginKey] !== undefined) continue;
        if (config[appKey] === undefined) continue;
        next[pluginKey] = config[appKey];
        changed = true;
      }
      if (changed) {
        await invoke('set_plugin_config', { pluginId: plugin.id, config: next });
      }
    }

    migrated = true;
  }

  if (migrated) {
    await writeAppConfig({ ...config, image_storage_mode: 'alongside_document' });
  }
}
