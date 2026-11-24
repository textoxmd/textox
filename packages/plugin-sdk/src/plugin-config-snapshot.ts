type ConfigListener = (config: Record<string, unknown>) => void;

const snapshots = new Map<string, Record<string, unknown>>();
const listeners = new Map<string, Set<ConfigListener>>();

/** 写入某插件的实时配置快照（骨架 configSync 维护，插件只读），并通知订阅者。 */
export function setPluginConfigSnapshot(
  pluginId: string,
  config: Record<string, unknown>,
): void {
  const next = { ...config };
  snapshots.set(pluginId, next);

  const subs = listeners.get(pluginId);
  if (!subs || subs.size === 0) return;
  // 拷贝后再遍历：订阅者回调中可能取消订阅。
  for (const listener of [...subs]) listener({ ...next });
}

/** 读取某插件的实时配置快照（不可变拷贝）；未知插件返回空对象。 */
export function getPluginConfigSnapshot(pluginId: string): Record<string, unknown> {
  return { ...(snapshots.get(pluginId) ?? {}) };
}

/**
 * 订阅某插件「有效配置」的实时变更；仅在清单声明 `settingsApply: 'immediate'`
 * 时，宿主才会更新快照并触发。返回取消订阅函数。
 */
export function subscribePluginConfig(
  pluginId: string,
  listener: ConfigListener,
): () => void {
  let subs = listeners.get(pluginId);
  if (!subs) {
    subs = new Set();
    listeners.set(pluginId, subs);
  }
  subs.add(listener);

  return () => {
    const current = listeners.get(pluginId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(pluginId);
  };
}

/** 仅供测试：清空全部快照与订阅。 */
export function resetPluginConfigSnapshotsForTests(): void {
  snapshots.clear();
  listeners.clear();
}
