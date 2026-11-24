import type { Contributes, ExtensionPointMap, ExtensionPointSpec } from './types';

const DEV = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV ?? false;

interface PointRecord {
  ownerId: string;
  spec: ExtensionPointSpec;
}

interface ContributionRecord {
  ownerId: string;
  value: unknown;
}

const points = new Map<string, PointRecord>();
const contributions = new Map<string, ContributionRecord[]>();
const listeners = new Set<(pointId: string) => void>();

/** 逐个通知订阅者；单个订阅者抛错只告警，不影响其余订阅者与调用方。 */
function notify(pointId: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(pointId);
    } catch (error) {
      console.warn('[plugin-sdk] contribution listener threw', error);
    }
  }
}

/** 声明一个扩展点。重复声明时后者覆盖并告警。 */
export function declareExtensionPoint(spec: ExtensionPointSpec, ownerId: string): void {
  if (points.has(spec.id)) {
    if (DEV) console.warn(`[plugin-sdk] 扩展点重复声明，后者覆盖：${spec.id}`);
  }
  points.set(spec.id, { ownerId, spec });
}

export function hasExtensionPoint(pointId: string): boolean {
  return points.has(pointId);
}

export function ownerOfExtensionPoint(pointId: string): string | null {
  return points.get(pointId)?.ownerId ?? null;
}

/**
 * 贡献的去重键：`id` 优先，缺省用 `name`（Agent 工具等以 name 为标识）。
 * 两者都没有的贡献不去重。
 */
function contributionKey(value: unknown): string | undefined {
  const record = value as { id?: string; name?: string } | null;
  return record?.id ?? record?.name;
}

/**
 * 登记某插件的全部贡献。指向未声明扩展点的贡献被忽略并告警。
 * 同一扩展点内按贡献键去重，后者覆盖前者。
 */
export function registerContributions(
  ownerId: string,
  contributes: Contributes | undefined,
): void {
  if (!contributes) return;
  for (const [pointId, values] of Object.entries(contributes as Record<string, unknown[]>)) {
    if (!points.has(pointId)) {
      if (DEV) console.warn(`[plugin-sdk] 贡献指向不存在的扩展点：${pointId}（来自 ${ownerId}）`);
      continue;
    }
    const list = contributions.get(pointId) ?? [];
    for (const value of values ?? []) {
      const id = contributionKey(value);
      if (id !== undefined) {
        const existing = list.findIndex((c) => contributionKey(c.value) === id);
        if (existing >= 0) {
          if (DEV) console.warn(`[plugin-sdk] 贡献键冲突（id/name），后者覆盖：${pointId}/${id}`);
          list.splice(existing, 1);
        }
      }
      list.push({ ownerId, value });
    }
    contributions.set(pointId, list);
  }
}

/** 读取某扩展点的全部贡献（注册序，已按 id 去重）。 */
export function getContributions<K extends keyof ExtensionPointMap>(
  pointId: K,
): ExtensionPointMap[K][];
export function getContributions(pointId: string): unknown[];
export function getContributions(pointId: string): unknown[] {
  return (contributions.get(pointId) ?? []).map((c) => c.value);
}

/** 读取某扩展点的全部贡献及其所有者插件 id（注册序，已按 id 去重）。 */
export function getContributionsWithOwner<K extends keyof ExtensionPointMap>(
  pointId: K,
): Array<{ ownerId: string; value: ExtensionPointMap[K] }>;
export function getContributionsWithOwner(
  pointId: string,
): Array<{ ownerId: string; value: unknown }>;
export function getContributionsWithOwner(
  pointId: string,
): Array<{ ownerId: string; value: unknown }> {
  return (contributions.get(pointId) ?? []).map((c) => ({
    ownerId: c.ownerId,
    value: c.value,
  }));
}

/**
 * 订阅贡献变更（当前只在注销路径触发）。返回可释放句柄；释放后不再收到通知。
 * 骨架拿到通知后自行重读 `getContributions`。
 */
export function subscribeContributions(
  listener: (pointId: string) => void,
): { dispose(): void } {
  listeners.add(listener);
  return {
    dispose: () => {
      listeners.delete(listener);
    },
  };
}

/** 按 `id ?? name` 删除指定 owner 的一条贡献；不存在时静默返回。 */
export function unregisterContribution(pointId: string, ownerId: string, key: string): void {
  const list = contributions.get(pointId);
  if (!list) return;
  const next = list.filter(
    (record) => !(record.ownerId === ownerId && contributionKey(record.value) === key),
  );
  if (next.length === list.length) return;
  contributions.set(pointId, next);
  notify(pointId);
}

/**
 * 删除某 owner 在全部扩展点上的贡献，受影响的扩展点各通知一次。
 * 原地覆盖已有 key（不先 delete 再 set），保持 Map 迭代顺序稳定。
 *
 * 只清除该 owner **贡献**的记录，不删除该 owner **声明**的扩展点：
 * `PointRecord.ownerId`（谁声明的点）与 `ContributionRecord.ownerId`（谁提交的贡献）
 * 同名字段语义不同，这里的 `ownerId` 只匹配后者。
 *
 * 通知在全部清除完成后统一派发：listener 是骨架代码，可能在回调里重建全量状态
 * 或再次 `registerContributions`，循环中派发会让它观察到「半注销」快照。
 */
export function unregisterOwner(ownerId: string): void {
  const affected: string[] = [];
  for (const [pointId, list] of contributions) {
    const next = list.filter((record) => record.ownerId !== ownerId);
    if (next.length === list.length) continue;
    contributions.set(pointId, next);
    affected.push(pointId);
  }
  for (const pointId of affected) notify(pointId);
}

/** 仅供测试：清空扩展点、贡献与订阅。 */
export function resetExtensionPointsForTests(): void {
  points.clear();
  contributions.clear();
  listeners.clear();
}
