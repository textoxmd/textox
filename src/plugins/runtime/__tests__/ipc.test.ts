import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import { subscribePluginDataChanged, pluginIpc } from '../ipc';

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

/** 让已 resolve 的 `listen` promise 走完 `.then`。 */
const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const CASES: Array<[string, () => Promise<unknown>, string, Record<string, unknown> | undefined]> = [
  ['scan', () => pluginIpc.scan(), 'plugin_scan', undefined],
  ['getState', () => pluginIpc.getState(), 'plugin_get_state', undefined],
  [
    'setEnabled',
    () => pluginIpc.setEnabled('app.textox.demo', true),
    'plugin_set_enabled',
    { id: 'app.textox.demo', enabled: true },
  ],
  [
    'setSafeMode',
    () => pluginIpc.setSafeMode(false),
    'plugin_set_safe_mode',
    { safeMode: false },
  ],
  [
    'readAsset',
    () => pluginIpc.readAsset('app.textox.demo', 'dist/index.js'),
    'plugin_read_asset',
    { pluginId: 'app.textox.demo', path: 'dist/index.js' },
  ],
  [
    'readData',
    () => pluginIpc.readData('app.textox.demo'),
    'plugin_read_data',
    { pluginId: 'app.textox.demo' },
  ],
  [
    'writeData',
    () => pluginIpc.writeData('app.textox.demo', { settings: {} }),
    'plugin_write_data',
    { pluginId: 'app.textox.demo', data: { settings: {} } },
  ],
  [
    'installFromFile',
    () => pluginIpc.installFromFile('/tmp/x.zip'),
    'plugin_install_from_file',
    { path: '/tmp/x.zip' },
  ],
  [
    'installFromUrl',
    () => pluginIpc.installFromUrl('https://example.com/x.zip'),
    'plugin_install_from_url',
    { url: 'https://example.com/x.zip' },
  ],
  [
    'uninstall',
    () => pluginIpc.uninstall('app.textox.demo'),
    'plugin_uninstall',
    { pluginId: 'app.textox.demo' },
  ],
];

describe('pluginIpc', () => {
  it.each(CASES)('%s invokes the right command with camelCase args', async (_name, call, command, args) => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);

    await call();

    if (args === undefined) {
      expect(invokeMock.mock.calls[0]).toEqual([command]);
    } else {
      expect(invokeMock).toHaveBeenCalledWith(command, args);
    }
  });

  it('passes invoke results through unchanged', async () => {
    const entries = [
      { id: 'app.textox.demo', dir: '/p', manifest: null, enabled: false, error: null },
    ];
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(entries);

    const scanned = await pluginIpc.scan();

    expect(scanned).toBe(entries);
  });
});

describe('subscribePluginDataChanged', () => {
  it('unlistens once when the listener promise resolves after cancellation', async () => {
    let resolveListen: (fn: () => void) => void = () => {};
    listenMock.mockReset();
    listenMock.mockReturnValue(
      new Promise<() => void>((resolve) => {
        resolveListen = resolve;
      }),
    );
    const unlisten = vi.fn();
    const stop = subscribePluginDataChanged(() => {});

    // listen 还没 resolve 就取消：此刻无句柄可调
    stop();
    expect(unlisten).not.toHaveBeenCalled();

    resolveListen(unlisten);
    await flushMicrotasks();

    // resolve 之后立刻补上 unlisten，且重复取消不会二次调用
    expect(unlisten).toHaveBeenCalledTimes(1);
    stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('unlistens when cancelled after the listener promise resolved', async () => {
    const unlisten = vi.fn();
    listenMock.mockReset();
    listenMock.mockResolvedValue(unlisten);
    const handler = vi.fn();
    const stop = subscribePluginDataChanged(handler);
    await flushMicrotasks();

    stop();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
