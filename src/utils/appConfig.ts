import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * 单窗口 AppConfig 快照。
 *
 * 启动期有 i18n / agent / 插件迁移 / App hooks 等多个消费者几乎同时读配置。
 * 每次 `invoke('get_config')` 都要付一次 IPC + JSON 编解码；这里把它们收敛成
 * 一份短 TTL 快照。Rust 的 `set_config` 会广播 `config-changed`，快照据此
 * 跟随其它窗口/原生菜单的写入；TTL 只作为事件丢失时的兜底。
 *
 * 约定：返回对象按**只读**使用。现有调用点都用 `{ ...config, key: value }`
 * 生成新对象；若要原地修改，请先浅拷贝。
 */

type AppConfig = Record<string, unknown>;

const CACHE_TTL_MS = 1000;

let snapshot: AppConfig | null = null;
let snapshotAt = 0;
/** 失效代数：写操作/外部事件递增，防止已在飞的旧读取回写快照。 */
let generation = 0;
let inFlight: Promise<AppConfig> | null = null;
let subscribed = false;

function subscribeConfigChanges(): void {
  if (subscribed || typeof window === 'undefined') return;
  subscribed = true;
  void listen<AppConfig>('config-changed', (event) => {
    const payload = event.payload;
    if (!payload || typeof payload !== 'object') return;
    snapshot = payload;
    snapshotAt = Date.now();
    generation += 1;
  }).catch(() => {
    // 非 Tauri 环境（浏览器预览/测试未 stub）：只靠 TTL 失效。
    subscribed = false;
  });
}

/** 读取当前窗口的 AppConfig 快照；TTL 内/并发调用不会重复 IPC。 */
export async function readAppConfig<T = AppConfig>(): Promise<T> {
  subscribeConfigChanges();

  if (snapshot && Date.now() - snapshotAt < CACHE_TTL_MS) {
    return snapshot as T;
  }
  if (inFlight) {
    return inFlight as Promise<T>;
  }

  const startGeneration = generation;
  const request = invoke<AppConfig>('get_config')
    .then((config) => {
      // 读取期间发生过写入/外部事件：不要把旧值写回快照。
      if (generation === startGeneration) {
        snapshot = config;
        snapshotAt = Date.now();
      }
      return config;
    })
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });

  inFlight = request;
  return request as Promise<T>;
}

/** 写入 AppConfig（整份替换）并使快照失效。 */
export async function writeAppConfig(config: unknown): Promise<void> {
  await invoke('set_config', { config });
  invalidateAppConfig();
}

/** 使快照失效；下一次读取会重新落到 Rust。 */
export function invalidateAppConfig(): void {
  snapshot = null;
  snapshotAt = 0;
  generation += 1;
}

/** 仅测试：清空快照、in-flight 与订阅标记。 */
export function resetAppConfigCacheForTests(): void {
  snapshot = null;
  snapshotAt = 0;
  generation = 0;
  inFlight = null;
  subscribed = false;
}
