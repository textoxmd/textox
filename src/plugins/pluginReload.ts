import { emit, listen } from '@tauri-apps/api/event';

/** 插件启用状态变更广播的事件名（设置窗口发出，非设置窗口据此重载）。 */
export const PLUGIN_ENABLED_CHANGED_EVENT = 'plugin-enabled-changed';

export interface PluginEnabledChanged {
  pluginId: string;
  enabled: boolean;
}

export interface PluginReloadOptions {
  /** 重载前的未保存守卫：返回 true 表示可安全重载。 */
  beforeReload: () => Promise<boolean>;
  /** 触发本窗口重载。 */
  reload: () => void;
}

/** 广播插件启用状态变更；失败静默，不阻断设置窗口自身状态。 */
export function broadcastPluginEnabledChanged(payload: PluginEnabledChanged): void {
  void emit(PLUGIN_ENABLED_CHANGED_EVENT, payload).catch(() => {});
}

/**
 * 订阅插件启用变更，守卫通过后重载本窗口。返回取消订阅函数。
 * 仅主窗口/编辑器窗口调用（设置窗口不订阅，保持停留在二级页）。
 */
export function subscribePluginReload(opts: PluginReloadOptions): () => void {
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  // 串行化：前一次守卫/重载尚未结束（尤其用户正处理未保存对话框）时忽略后续事件。
  let reloading = false;

  void listen(PLUGIN_ENABLED_CHANGED_EVENT, () => {
    void (async () => {
      if (reloading) return;
      reloading = true;
      try {
        const ok = await opts.beforeReload();
        if (!ok) {
          reloading = false;
          return;
        }
        opts.reload();
      } catch (error) {
        reloading = false;
        console.error('[plugins] reload guard failed:', error);
      }
    })();
  })
    .then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    })
    .catch((error) => {
      console.warn('[plugins] subscribe reload failed:', error);
    });

  return () => {
    cancelled = true;
    unlisten?.();
  };
}
