import { invoke } from '@tauri-apps/api/core';

export interface OnboardingContext {
  /** 当前应用版本 */
  version: string;
  /** 「更新前版本」（AppConfig.last_run_version）；全新安装 / 无记录时为 null */
  previousVersion: string | null;
}

let cached: Promise<OnboardingContext> | null = null;

/**
 * 解析向导判定所需的上下文：读当前版本与「更新前版本」，读完后立刻把
 * `last_run_version` 写回当前版本，供**下次启动**作为「更新前版本」使用。
 *
 * 用模块级 Promise 缓存同一窗口内的结果：多处消费（向导门控、评分弹窗避让）拿到
 * 同一份快照，避免第二个消费点读到已被覆盖的值而误判。
 *
 * 任何读取失败都降级为空版本号（`shouldAutoShowOnboarding('')` 为 false，即直接进编辑器），
 * 保证 Promise 永不 reject——否则失败的 Promise 会被缓存住。
 */
export function resolveOnboardingContext(): Promise<OnboardingContext> {
  cached ??= (async (): Promise<OnboardingContext> => {
    let version = '';
    try {
      version = await invoke<string>('get_app_version');
    } catch (error) {
      console.error('[onboarding] 读取应用版本失败：', error);
      return { version: '', previousVersion: null };
    }

    let previousVersion: string | null = null;
    try {
      const config = await invoke<Record<string, unknown>>('get_config');
      const previous = config?.last_run_version;
      previousVersion = typeof previous === 'string' && previous ? previous : null;
      // 写回当前版本（仅当确有变化，避免每次启动都写盘）。
      if (version && previous !== version) {
        await invoke('set_config', { config: { ...config, last_run_version: version } });
      }
    } catch (error) {
      console.error('[onboarding] 读取/写回 last_run_version 失败：', error);
    }

    return { version, previousVersion };
  })();
  return cached;
}

/** 仅供测试：清空缓存。 */
export function resetOnboardingContextForTests(): void {
  cached = null;
}
