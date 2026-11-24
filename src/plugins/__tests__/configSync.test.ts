import { beforeEach, describe, expect, it, vi } from 'vitest';

type ConfigEvent = { payload: { pluginId: string; config: Record<string, unknown> } };

const invokeMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(undefined));
const emitMock = vi.fn((..._args: unknown[]) => Promise.resolve());
const listenMock = vi.fn(
  (_event: string, _handler: (event: ConfigEvent) => void) => Promise.resolve<() => void>(() => {}),
);

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock('@tauri-apps/api/event', () => ({
  emit: (...a: unknown[]) => emitMock(...a),
  listen: (event: string, handler: (event: ConfigEvent) => void) => listenMock(event, handler),
}));

import { resetPluginConfigSnapshotsForTests, getPluginConfigSnapshot } from '@texto/plugin-sdk';
import { APP_SETTINGS_SECTION } from '@texto/app-api';

import {
  effectivePluginConfig,
  primePluginConfigs,
  registerPluginManifests,
  subscribePluginConfigChanges,
  writePluginConfig,
} from '../configSync';

const immediate = {
  id: 'p-live',
  version: '1',
  settingsApply: 'immediate' as const,
  contributes: {
    [APP_SETTINGS_SECTION]: [
      {
        id: 'p-live.settings',
        titleKey: 't',
        fields: [{ type: 'number' as const, key: 'count', labelKey: 'c', default: 15 }],
      },
    ],
  },
};
const restart = { id: 'p-restart', version: '1', contributes: immediate.contributes };

beforeEach(() => {
  invokeMock.mockReset();
  emitMock.mockClear();
  listenMock.mockClear();
  resetPluginConfigSnapshotsForTests();
  registerPluginManifests([immediate, restart]);
});

describe('effectivePluginConfig', () => {
  it('fills defaults', () => {
    expect(effectivePluginConfig('p-live', {})).toEqual({ count: 15 });
    expect(effectivePluginConfig('p-live', { count: 3 })).toEqual({ count: 3 });
  });
});

describe('primePluginConfigs', () => {
  it('loads all stored configs with one batch invoke', async () => {
    invokeMock.mockResolvedValue({ 'p-live': { count: 8 } });
    await primePluginConfigs([immediate, restart]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('get_plugin_configs', {
      pluginIds: ['p-live', 'p-restart'],
    });
    expect(getPluginConfigSnapshot('p-live')).toEqual({ count: 8 });
    expect(getPluginConfigSnapshot('p-restart')).toEqual({ count: 15 });
  });

  it('falls back to defaults for plugins missing from the batch', async () => {
    invokeMock.mockResolvedValue({ 'p-live': { count: 8 } });
    await primePluginConfigs([immediate, restart]);
    expect(getPluginConfigSnapshot('p-restart')).toEqual({ count: 15 });
  });

  it('falls back to defaults when the batch load fails', async () => {
    invokeMock.mockRejectedValue(new Error('nope'));
    await primePluginConfigs([immediate]);
    expect(getPluginConfigSnapshot('p-live')).toEqual({ count: 15 });
  });
});

describe('writePluginConfig', () => {
  it('broadcasts and updates snapshot for immediate plugins', async () => {
    invokeMock.mockResolvedValue(undefined);
    await writePluginConfig('p-live', { count: 4 });
    expect(invokeMock).toHaveBeenCalledWith('set_plugin_config', { pluginId: 'p-live', config: { count: 4 } });
    expect(getPluginConfigSnapshot('p-live')).toEqual({ count: 4 });
    expect(emitMock).toHaveBeenCalledWith('plugin-config-changed', { pluginId: 'p-live', config: { count: 4 } });
  });

  it('does not broadcast or update snapshot for restart plugins', async () => {
    invokeMock.mockResolvedValue(undefined);
    await writePluginConfig('p-restart', { count: 4 });
    expect(emitMock).not.toHaveBeenCalled();
    expect(getPluginConfigSnapshot('p-restart')).toEqual({});
  });
});

describe('subscribePluginConfigChanges', () => {
  function capturedHandler(): (event: ConfigEvent) => void {
    const handler = listenMock.mock.calls[0]?.[1];
    expect(handler).toBeTypeOf('function');
    return handler!;
  }

  it('applies immediate broadcasts and ignores restart plugins', async () => {
    const unsubscribe = subscribePluginConfigChanges();
    // listen 异步返回 unlisten，先让 .then 落地再触发回调。
    await Promise.resolve();
    expect(listenMock).toHaveBeenCalledWith('plugin-config-changed', expect.any(Function));

    const handler = capturedHandler();
    handler({ payload: { pluginId: 'p-live', config: { count: 6 } } });
    expect(getPluginConfigSnapshot('p-live')).toEqual({ count: 6 });

    handler({ payload: { pluginId: 'p-restart', config: { count: 6 } } });
    expect(getPluginConfigSnapshot('p-restart')).toEqual({});

    unsubscribe();
  });

  it('unsubscribes a listen that resolves after cancellation', async () => {
    const unlisten = vi.fn();
    let resolveListen: (fn: () => void) => void = () => {};
    listenMock.mockImplementationOnce(
      () => new Promise<() => void>((resolve) => { resolveListen = resolve; }),
    );

    const unsubscribe = subscribePluginConfigChanges();
    unsubscribe(); // 在 listen 落地前取消
    resolveListen(unlisten);
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
