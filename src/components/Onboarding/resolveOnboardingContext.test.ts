import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetOnboardingContextForTests,
  resolveOnboardingContext,
} from './resolveOnboardingContext';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

/** 按命令名分发返回值；未登记的命令返回 undefined。 */
function stubInvoke(handlers: Record<string, unknown>) {
  invokeMock.mockImplementation((cmd: string) =>
    Promise.resolve(cmd in handlers ? handlers[cmd] : undefined),
  );
}

describe('resolveOnboardingContext', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetOnboardingContextForTests();
  });

  afterEach(() => {
    resetOnboardingContextForTests();
  });

  it('读取当前版本与「更新前版本」，并把当前版本写回配置', async () => {
    stubInvoke({ get_app_version: '2.0.2', get_config: { last_run_version: '1.8.28', language: 'zh-CN' } });

    const ctx = await resolveOnboardingContext();

    expect(ctx).toEqual({ version: '2.0.2', previousVersion: '1.8.28' });
    expect(invokeMock).toHaveBeenCalledWith('set_config', {
      config: { last_run_version: '2.0.2', language: 'zh-CN' },
    });
  });

  it('配置里没有 last_run_version（全新安装）→ previousVersion 为 null', async () => {
    stubInvoke({ get_app_version: '2.0.2', get_config: { language: 'zh-CN' } });

    expect((await resolveOnboardingContext()).previousVersion).toBeNull();
  });

  it('last_run_version 为空串 → 视为无记录', async () => {
    stubInvoke({ get_app_version: '2.0.2', get_config: { last_run_version: '' } });

    expect((await resolveOnboardingContext()).previousVersion).toBeNull();
  });

  it('版本未变化时不写回配置（避免每次启动都写盘）', async () => {
    stubInvoke({ get_app_version: '2.0.2', get_config: { last_run_version: '2.0.2' } });

    await resolveOnboardingContext();

    expect(invokeMock).not.toHaveBeenCalledWith('set_config', expect.anything());
  });

  it('读配置失败时降级：previousVersion 为 null，且不抛错', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_app_version') return Promise.resolve('2.0.2');
      return Promise.reject(new Error('boom'));
    });

    await expect(resolveOnboardingContext()).resolves.toEqual({
      version: '2.0.2',
      previousVersion: null,
    });
  });

  it('取版本失败时降级为空版本号（shouldAutoShow 会判为不弹）', async () => {
    invokeMock.mockImplementation(() => Promise.reject(new Error('boom')));

    await expect(resolveOnboardingContext()).resolves.toEqual({
      version: '',
      previousVersion: null,
    });
  });

  it('结果按模块缓存：重复调用只读一次配置', async () => {
    stubInvoke({ get_app_version: '2.0.2', get_config: { last_run_version: '1.8.28' } });

    await resolveOnboardingContext();
    await resolveOnboardingContext();

    const getConfigCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'get_config');
    expect(getConfigCalls).toHaveLength(1);
  });
});
