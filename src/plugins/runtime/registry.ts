import { toDisposable, type ContributionKind, type Disposable } from '@textox/plugin-sdk';

interface Entry {
  id: string;
  owner: string;
  value: unknown;
}

/**
 * 插件贡献注册表：按 `owner`（插件 id）登记，可整体释放；同一 `kind + id` 后注册覆盖先注册。
 * `get` 返回只读快照（按 kind 缓存，变更时失效）。
 *
 * 覆盖是「先摘除同 id 条目再追加」，因此被覆盖的条目会移动到该 kind 末尾（影响按注册序的排序 tiebreak）。
 * 释放按 `owner + id` 双键匹配：被覆盖者的 disposable 不会误删覆盖者的条目；
 * 但同一 owner 重复注册同一 id 后，旧 disposable 仍会删掉新条目（本实现不跟踪注册标识）。
 * 监听器回调内不要写本注册表：`register` 会递归 `emit`，最坏栈溢出，且该错误会被 `emit` 的 try/catch 吞掉。
 */
export class PluginRegistry {
  private readonly entries = new Map<ContributionKind, Entry[]>();
  private readonly listeners = new Set<(kind: ContributionKind) => void>();
  private readonly cache = new Map<ContributionKind, unknown[]>();

  register(owner: string, kind: ContributionKind, id: string, value: unknown): Disposable {
    const next = (this.entries.get(kind) ?? []).filter((entry) => entry.id !== id);
    next.push({ id, owner, value });
    this.entries.set(kind, next);
    this.emit(kind);
    return toDisposable(() => this.remove(owner, kind, id));
  }

  disposeOwner(owner: string): void {
    for (const [kind, list] of this.entries) {
      const next = list.filter((entry) => entry.owner !== owner);
      if (next.length === list.length) continue;
      this.entries.set(kind, next);
      this.emit(kind);
    }
  }

  get<T>(kind: ContributionKind): readonly T[] {
    const cached = this.cache.get(kind);
    if (cached) return cached as readonly T[];
    const snapshot = (this.entries.get(kind) ?? []).map((entry) => entry.value);
    this.cache.set(kind, snapshot);
    return snapshot as readonly T[];
  }

  /**
   * 某插件登记的贡献（按注册序）。用于按 owner 收窄的查找（设置项 `action` 按命令 id
   * 分派时必须确认命令属于同一个插件）。不经缓存：调用频率低，且要保留 owner 信息。
   */
  owned<T>(kind: ContributionKind, owner: string): readonly T[] {
    return (this.entries.get(kind) ?? [])
      .filter((entry) => entry.owner === owner)
      .map((entry) => entry.value as T);
  }

  count(kind: ContributionKind): number {
    return this.entries.get(kind)?.length ?? 0;
  }

  onDidChange(listener: (kind: ContributionKind) => void): Disposable {
    this.listeners.add(listener);
    return toDisposable(() => {
      this.listeners.delete(listener);
    });
  }

  private remove(owner: string, kind: ContributionKind, id: string): void {
    const list = this.entries.get(kind) ?? [];
    const next = list.filter((entry) => !(entry.owner === owner && entry.id === id));
    if (next.length === list.length) return;
    this.entries.set(kind, next);
    this.emit(kind);
  }

  private emit(kind: ContributionKind): void {
    this.cache.delete(kind);
    for (const listener of this.listeners) {
      try {
        listener(kind);
      } catch (error) {
        console.error('[plugin] registry listener failed', error);
      }
    }
  }
}
