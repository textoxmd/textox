import type { InstalledPluginDto, PluginStateDto } from './ipc';

export type PluginStatus = 'installed' | 'enabled' | 'blocked' | 'load-failed';

export interface RuntimeEntry extends InstalledPluginDto {
  readonly status: PluginStatus;
  readonly errorMessage?: string;
}

/** 插件运行时状态：由 IPC 快照填充，加载失败可单独标记；变更通过 `subscribe` 通知。 */
export class PluginStateStore {
  private entries: RuntimeEntry[] = [];
  private safeMode = true;
  private initialized = false;
  private readonly listeners = new Set<() => void>();

  setSnapshot(plugins: InstalledPluginDto[], state: PluginStateDto): void {
    const enabled = new Set(state.enabled);
    this.safeMode = state.safe_mode;
    this.initialized = true;
    this.entries = plugins.map((plugin) => ({
      ...plugin,
      status: enabled.has(plugin.id) ? 'enabled' : 'installed',
    }));
    this.emit();
  }

  list(): readonly RuntimeEntry[] {
    return this.entries;
  }

  isSafeMode(): boolean {
    return this.safeMode;
  }

  /** 启动期是否已经拿到过第一次快照（面板用它区分「加载中」与「没有插件」）。 */
  isInitialized(): boolean {
    return this.initialized;
  }

  markFailed(id: string, message: string): void {
    this.update(id, (entry) => ({ ...entry, status: 'load-failed', errorMessage: message }));
  }

  markStatus(id: string, status: PluginStatus): void {
    this.update(id, (entry) => ({ ...entry, status, errorMessage: undefined }));
  }

  /** 持久化开关变化后同步内存快照，避免面板与实际落盘状态分叉。 */
  markEnabled(pluginId: string, enabled: boolean): void {
    this.update(pluginId, (entry) => ({ ...entry, enabled }));
  }

  /**
   * 仅测试用：复位「是否已拿到首次快照」这一个启动期标记。
   * 不清空 `entries` / `safeMode`，需要它们保持真实形态的用例请自行 `setSnapshot`。
   */
  resetForTests(): void {
    this.initialized = false;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 不可变更新：只替换命中的那条，整体换新数组，保证 `list()` 引用变化能触发订阅方重渲染。 */
  private update(id: string, patch: (entry: RuntimeEntry) => RuntimeEntry): void {
    let changed = false;
    const next = this.entries.map((entry) => {
      if (entry.id !== id) return entry;
      changed = true;
      return patch(entry);
    });
    if (!changed) {
      console.warn(`[plugin] state: unknown plugin id ${id}`);
      return;
    }
    this.entries = next;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error('[plugin] state listener failed', error);
      }
    }
  }
}
