import { beforeEach, describe, expect, it, vi } from 'vitest';

type EventHandler = (event: { payload: unknown }) => void;

const emitMock = vi.fn((..._args: unknown[]) => Promise.resolve());
const listenMock = vi.fn(
  (_event: string, _handler: EventHandler) => Promise.resolve<() => void>(() => {}),
);

vi.mock('@tauri-apps/api/event', () => ({
  emit: (...a: unknown[]) => emitMock(...a),
  listen: (event: string, handler: EventHandler) => listenMock(event, handler),
}));

import {
  PLUGIN_ENABLED_CHANGED_EVENT,
  broadcastPluginEnabledChanged,
  subscribePluginReload,
} from '../pluginReload';

beforeEach(() => {
  emitMock.mockClear();
  listenMock.mockClear();
});

describe('broadcastPluginEnabledChanged', () => {
  it('emits the change to all windows', () => {
    broadcastPluginEnabledChanged({ pluginId: 'p-a', enabled: false });
    expect(emitMock).toHaveBeenCalledWith('plugin-enabled-changed', {
      pluginId: 'p-a',
      enabled: false,
    });
    expect(PLUGIN_ENABLED_CHANGED_EVENT).toBe('plugin-enabled-changed');
  });
});

describe('subscribePluginReload', () => {
  async function capturedHandler(): Promise<EventHandler> {
    await Promise.resolve();
    const handler = listenMock.mock.calls[0]?.[1];
    expect(handler).toBeTypeOf('function');
    return handler!;
  }

  it('reloads when the guard allows', async () => {
    const reload = vi.fn();
    const beforeReload = vi.fn(async () => true);
    const unsubscribe = subscribePluginReload({ beforeReload, reload });

    const handler = await capturedHandler();
    handler({ payload: { pluginId: 'p-a', enabled: false } });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(beforeReload).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('does not reload when the guard rejects', async () => {
    const reload = vi.fn();
    const unsubscribe = subscribePluginReload({
      beforeReload: async () => false,
      reload,
    });

    const handler = await capturedHandler();
    handler({ payload: { pluginId: 'p-a', enabled: false } });
    await Promise.resolve();
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('串行化：前一次守卫未结束时忽略后续事件', async () => {
    const reload = vi.fn();
    let resolveGuard: (ok: boolean) => void = () => {};
    const beforeReload = vi.fn(
      () => new Promise<boolean>((resolve) => { resolveGuard = resolve; }),
    );
    const unsubscribe = subscribePluginReload({ beforeReload, reload });

    const handler = await capturedHandler();
    handler({ payload: { pluginId: 'p-a', enabled: false } });
    handler({ payload: { pluginId: 'p-a', enabled: false } });
    await Promise.resolve();
    expect(beforeReload).toHaveBeenCalledTimes(1);

    resolveGuard(true);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(beforeReload).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('串行化：守卫拒绝后可再次进入', async () => {
    const reload = vi.fn();
    const beforeReload = vi.fn(async () => false);
    const unsubscribe = subscribePluginReload({ beforeReload, reload });

    const handler = await capturedHandler();
    handler({ payload: { pluginId: 'p-a', enabled: false } });
    await vi.waitFor(() => expect(beforeReload).toHaveBeenCalledTimes(1));

    handler({ payload: { pluginId: 'p-a', enabled: false } });
    await vi.waitFor(() => expect(beforeReload).toHaveBeenCalledTimes(2));
    expect(reload).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('unsubscribes a listen that resolves after cancellation', async () => {
    const unlisten = vi.fn();
    let resolveListen: (fn: () => void) => void = () => {};
    listenMock.mockImplementationOnce(
      () => new Promise<() => void>((resolve) => { resolveListen = resolve; }),
    );

    const unsubscribe = subscribePluginReload({
      beforeReload: async () => true,
      reload: vi.fn(),
    });
    unsubscribe();
    resolveListen(unlisten);
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
