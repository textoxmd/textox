import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';

import { setPluginConfigSnapshot, type TextoPlugin } from '@texto/plugin-sdk';
import { APP_SETTINGS_SECTION, applySettingsDefaults, type SettingsField } from '@texto/app-api';

const CONFIG_EVENT = 'plugin-config-changed';

let manifests = new Map<string, TextoPlugin>();

/** 登记插件清单，供配置写入/预热按 id 查声明。应在 registerPlugins 之后调用一次。 */
export function registerPluginManifests(plugins: TextoPlugin[]): void {
  manifests = new Map(plugins.map((plugin) => [plugin.id, plugin]));
}

function settingsFieldsOf(plugin: TextoPlugin): SettingsField[] {
  return (plugin.contributes?.[APP_SETTINGS_SECTION] ?? []).flatMap((section) => section.fields);
}

/** 由清单声明直接计算有效配置，不依赖全局 manifests。 */
function effectiveConfigFor(
  plugin: TextoPlugin,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  return applySettingsDefaults(settingsFieldsOf(plugin), stored);
}

/** 某插件的「有效配置」= 已存值 ⊕ 设置段字段 default。 */
export function effectivePluginConfig(
  pluginId: string,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  const plugin = manifests.get(pluginId);
  if (!plugin) return { ...stored };
  return effectiveConfigFor(plugin, stored);
}

/** 启动预热：把每个启用插件的有效配置写入实时快照（早于编辑器创建）。 */
export async function primePluginConfigs(plugins: TextoPlugin[]): Promise<void> {
  const ids = plugins.map((plugin) => plugin.id);
  let stored: Record<string, Record<string, unknown>> = {};
  if (ids.length > 0) {
    try {
      stored = await invoke<Record<string, Record<string, unknown>>>('get_plugin_configs', {
        pluginIds: ids,
      });
    } catch (error) {
      console.error('[plugins] 批量预热配置失败，使用默认值：', error);
    }
  }
  for (const plugin of plugins) {
    setPluginConfigSnapshot(plugin.id, effectiveConfigFor(plugin, stored[plugin.id] ?? {}));
  }
}

/**
 * 配置写入的唯一通道：写盘后按插件的 `settingsApply` 决定是否即时生效。
 * `immediate` → 更新本窗口快照并广播；`restart` → 不广播、不更新快照。
 */
export async function writePluginConfig(
  pluginId: string,
  config: Record<string, unknown>,
): Promise<void> {
  await invoke('set_plugin_config', { pluginId, config });
  const plugin = manifests.get(pluginId);
  if (plugin?.settingsApply !== 'immediate') return;
  setPluginConfigSnapshot(pluginId, effectivePluginConfig(pluginId, config));
  void emit(CONFIG_EVENT, { pluginId, config }).catch(() => {});
}

/** 订阅跨窗口配置变更；仅 `immediate` 插件会命中。返回取消订阅函数。 */
export function subscribePluginConfigChanges(): () => void {
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  void listen<{ pluginId: string; config: Record<string, unknown> }>(CONFIG_EVENT, (event) => {
    const { pluginId, config } = event.payload;
    if (manifests.get(pluginId)?.settingsApply !== 'immediate') return;
    setPluginConfigSnapshot(pluginId, effectivePluginConfig(pluginId, config));
  })
    .then((fn) => {
      // 取消发生在 listen 落地之前时，立即注销，避免监听泄漏。
      if (cancelled) fn();
      else unlisten = fn;
    })
    .catch((error) => {
      // 非 Tauri 运行时（如测试环境）监听不可用：记录并降级为「本窗口内即时生效」。
      console.warn('[plugins] 订阅配置变更失败：', error);
    });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}
