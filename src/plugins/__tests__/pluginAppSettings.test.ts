import { describe, expect, it, vi } from 'vitest';

import type { PluginManifest } from '@textox/plugin-sdk';

// app.ts 顶层会初始化 i18n / sonner：这里只需要它们可 import，不触发真实 Tauri 事件订阅
vi.mock('@/i18n', () => ({ default: { getFixedT: () => (key: string) => key } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { createPluginApp, type PluginData } from '../runtime/app';

const manifest: PluginManifest = {
  id: 'app.textox.demo',
  name: 'Demo',
  version: '1.0.0',
  minAppVersion: '2.5.0',
  author: { name: 'x' },
  settings: [{ type: 'boolean', key: 'a', labelKey: 'a', default: true }],
};

/** 只需要设置面：其余宿主能力用最小桩（`createPluginApp` 只在构造时用到 agent/theme/dialogs）。 */
const stubDeps = (): never =>
  ({
    createAgentCapability: () => ({
      available: () => false,
      run: () => ({ abort: () => {} }),
      present: () => ({ abort: () => {} }),
      profiles: { list: () => [] },
      tools: { list: () => [], call: async () => ({ content: '' }) },
    }),
    createThemeApi: () => ({
      appearance: 'light',
      applyCodeHighlightTheme: () => {},
      subscribe: () => ({ dispose: () => {} }),
      codeHighlightThemeDefaults: async () => ({}),
    }),
    createDialogsApi: () => ({
      pickFile: async () => null,
      confirm: async () => false,
    }),
  }) as never;

/** 不落盘、不订阅真实事件的 app；需要时按用例覆盖 IO。 */
function makeApp(
  overrides: {
    data?: PluginData;
    writeData?: (pluginId: string, data: PluginData) => Promise<void>;
    readData?: (pluginId: string) => Promise<PluginData>;
    subscribeDataChanged?: (handler: (pluginId: string) => void) => () => void;
  } = {},
) {
  return createPluginApp({
    manifest,
    registry: { register: vi.fn() } as never,
    deps: stubDeps(),
    data: overrides.data ?? { settings: {}, plugin: {} },
    writeData: overrides.writeData ?? vi.fn(async () => undefined),
    readData: overrides.readData ?? vi.fn(async () => ({ settings: {}, plugin: {} })),
    subscribeDataChanged: overrides.subscribeDataChanged ?? (() => () => {}),
  });
}

describe('createPluginApp settings', () => {
  it('fills defaults from manifest.settings and notifies listeners', async () => {
    const writeData = vi.fn().mockResolvedValue(undefined);
    const app = createPluginApp({
      manifest,
      registry: { register: vi.fn() } as never,
      deps: stubDeps(),
      data: { settings: {}, plugin: {} },
      writeData,
      subscribeDataChanged: () => () => {},
    });
    const seen: unknown[] = [];
    app.settings.onDidChange((snapshot) => seen.push(snapshot.values.a));
    expect(app.settings.all().values.a).toBe(true);
    await app.settings.set('a', false);
    expect(seen).toEqual([false]);
    expect(writeData).toHaveBeenCalled();
  });

  it('does not notify after the listener disposable is released', async () => {
    const app = makeApp();
    const listener = vi.fn();
    const sub = app.settings.onDidChange(listener);

    sub.dispose();
    await app.settings.set('a', false);

    expect(listener).not.toHaveBeenCalled();
    expect(app.settings.get('a')).toBe(false);
  });

  it('isolates a throwing listener from the others and from set()', async () => {
    const app = makeApp();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const healthy = vi.fn();
      app.settings.onDidChange(() => {
        throw new Error('boom');
      });
      app.settings.onDidChange(healthy);

      await expect(app.settings.set('a', false)).resolves.toBeUndefined();

      expect(healthy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        '[plugin:app.textox.demo]',
        'settings listener threw',
        expect.any(Error),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('returns undefined for unknown keys and keeps defaults out of the plugin namespace', async () => {
    const data: PluginData = { settings: {}, plugin: { cursor: 3 } };
    const app = makeApp({ data });

    expect(app.settings.get('missing')).toBeUndefined();
    expect(app.settings.all().values).toEqual({ a: true });
    expect(app.settings.all().read('a')).toBe(true);

    await app.settings.set('a', false);

    // 默认值只回填生效配置，既不写进 plugin 命名空间，也不改写调用方对象
    expect(data.plugin).toEqual({ cursor: 3 });
    expect(data.settings).toEqual({});
  });

  it('reloads from disk when another window broadcasts a data change for this plugin', async () => {
    let handler: ((pluginId: string) => void) | null = null;
    const readData = vi.fn(async () => ({ settings: { a: false }, plugin: { cursor: 7 } }));
    const app = makeApp({
      readData,
      subscribeDataChanged: (fn) => {
        handler = fn;
        return () => {};
      },
    });
    const listener = vi.fn();
    app.settings.onDidChange(listener);

    handler!('app.textox.other');
    expect(readData).not.toHaveBeenCalled();

    handler!(manifest.id);
    await vi.waitFor(() => {
      expect(app.settings.get('a')).toBe(false);
    });

    expect(readData).toHaveBeenCalledWith(manifest.id);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].values).toEqual({ a: false });
  });

  it('releases the broadcast subscription on dispose', () => {
    const unsubscribe = vi.fn();
    const app = makeApp({
      subscribeDataChanged: () => unsubscribe,
    });

    app.dispose();
    // 可重复调用
    app.dispose();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('stops notifying listeners after dispose', async () => {
    const app = makeApp();
    const listener = vi.fn();
    app.settings.onDidChange(listener);

    app.dispose();
    await app.settings.set('a', false);

    expect(listener).not.toHaveBeenCalled();
  });
});
