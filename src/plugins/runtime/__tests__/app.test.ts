import { describe, expect, it, vi } from 'vitest';

const { fixedT } = vi.hoisted(() => ({
  fixedT: vi.fn((key: string, vars?: unknown) => `${key}|${JSON.stringify(vars)}`),
}));

vi.mock('@/i18n', () => ({
  default: { getFixedT: vi.fn(() => fixedT) },
}));
vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('../ipc', () => ({
  pluginIpc: { writeData: vi.fn(async () => undefined) },
  subscribePluginDataChanged: () => () => {},
}));

import { toDisposable, type PluginManifest, type SettingsField } from '@textox/plugin-sdk';

import i18n from '@/i18n';
import { toast } from 'sonner';

import {
  createPluginApp,
  parseManifestSettings,
  runManifestAction,
  toHostSettingsFields,
  type PluginData,
  type PluginHostDeps,
} from '../app';
import { pluginIpc } from '../ipc';
import { PluginRegistry } from '../registry';

const manifest: PluginManifest = {
  id: 'app.textox.demo',
  name: 'Demo',
  version: '1.0.0',
  minAppVersion: '2.3.8',
  author: { name: 'Textox' },
};

function themeApi() {
  return {
    appearance: 'light' as const,
    applyCodeHighlightTheme: vi.fn(),
    subscribe: vi.fn(() => toDisposable(() => {})),
    codeHighlightThemeDefaults: vi.fn(async () => ({ light: 'githubLight' })),
  };
}

function dialogsApi() {
  return {
    pickFile: vi.fn(async () => null),
    confirm: vi.fn(async () => false),
  };
}

function deps(): PluginHostDeps {
  return {
    getActiveFilePath: () => '/notes/a.md',
    getDocumentDir: () => '/notes',
    openFile: vi.fn(async () => undefined),
    insertText: vi.fn(() => true),
    canEdit: () => true,
    registerEmbed: vi.fn(() => toDisposable(() => {})),
    registerFileEditor: vi.fn(() => toDisposable(() => {})),
    registerSyntaxFeature: vi.fn(() => toDisposable(() => {})),
    registerExtension: vi.fn(() => toDisposable(() => {})),
    registerFormatToolbarItem: vi.fn(() => toDisposable(() => {})),
    registerContextMenuItem: vi.fn(() => toDisposable(() => {})),
    registerSelectionAction: vi.fn(() => toDisposable(() => {})),
    registerSyntaxHighlight: vi.fn(() => toDisposable(() => {})),
    registerInsertCommand: vi.fn(() => toDisposable(() => {})),
    registerExporter: vi.fn(() => toDisposable(() => {})),
    registerImageUploader: vi.fn(() => toDisposable(() => {})),
    createAgentCapability: vi.fn(() => ({
      available: () => false,
      run: () => ({ abort: () => {} }),
      present: () => ({ abort: () => {} }),
      profiles: { list: () => [] },
      tools: { list: () => [], call: async () => ({ content: '' }) },
    })),
    createThemeApi: vi.fn(() => themeApi()),
    createDialogsApi: vi.fn(() => dialogsApi()),
    requestReload: vi.fn(),
    createNewDocument: vi.fn(async () => undefined),
    addMessages: vi.fn(),
    parseEmbedRef: vi.fn(() => null),
  };
}

function makeApp(
  options: {
    settings?: unknown[];
    /** 整体覆盖清单（用于构造第三方手写的坏清单）。 */
    manifestOverride?: PluginManifest;
    data?: PluginData;
    onDataChanged?: (data: PluginData) => void;
  } = {},
) {
  const registry = new PluginRegistry();
  const hostDeps = deps();
  const app = createPluginApp({
    manifest:
      options.manifestOverride ??
      (options.settings ? { ...manifest, settings: options.settings } : manifest),
    registry,
    deps: hostDeps,
    data: options.data ?? { settings: {}, plugin: {} },
    onDataChanged: options.onDataChanged,
    readData: vi.fn(async () => ({ settings: {}, plugin: {} })),
    subscribeDataChanged: () => () => {},
  });
  return { app, registry, deps: hostDeps };
}

describe('createPluginApp', () => {
  it('fills settings defaults from the manifest into its own copy and returns a copy from all()', () => {
    const fields: SettingsField[] = [
      { key: 'mode', type: 'text', default: 'a', labelKey: 'mode' },
    ];
    const callerData: PluginData = { settings: {}, plugin: {} };

    const { app } = makeApp({ settings: fields, data: callerData });

    expect(app.settings.get('mode')).toBe('a');
    expect(callerData.settings).toEqual({});

    const snapshot = app.settings.all();
    expect(snapshot.values).toEqual({ mode: 'a' });
    // 快照只读：values 已冻结，改不动内部值
    expect(Object.isFrozen(snapshot.values)).toBe(true);
    expect(() => {
      (snapshot.values as Record<string, unknown>).mode = 'changed';
    }).toThrow();
    expect(app.settings.get('mode')).toBe('a');
  });

  it('delegates register to the plugin registry', () => {
    const { app, registry } = makeApp();
    const value = { id: 'x' };

    const disposable = app.register('command', 'x', value);

    expect(registry.get<{ id: string }>('command')).toEqual([value]);
    disposable.dispose();
    expect(registry.get('command')).toEqual([]);
  });

  it('translates keys through the plugin-bound i18n namespace', () => {
    vi.mocked(i18n.getFixedT).mockReturnValue(fixedT as never);
    fixedT.mockClear();
    const { app } = makeApp();

    app.i18n.t('hello', { name: 'x' });

    expect(i18n.getFixedT).toHaveBeenCalledWith(null, 'plugins');
    expect(fixedT).toHaveBeenCalledWith('app.textox.demo.hello', { name: 'x' });
  });

  it('reports the interface language, falling back to en before i18next is ready', () => {
    const i18nLike = i18n as unknown as { language?: string };
    const { app } = makeApp();

    delete i18nLike.language;
    expect(app.i18n.language()).toBe('en');

    i18nLike.language = 'zh-CN';
    expect(app.i18n.language()).toBe('zh-CN');
    delete i18nLike.language;
  });

  it('binds theme and dialogs to the plugin id through the host deps', () => {
    const { app, deps } = makeApp();

    expect(deps.createThemeApi).toHaveBeenCalledWith(manifest.id);
    expect(deps.createDialogsApi).toHaveBeenCalledWith(manifest.id);
    expect(app.theme.appearance).toBe('light');
    expect(app.dialogs).toBe(vi.mocked(deps.createDialogsApi).mock.results[0]?.value);
  });

  it('exposes the host theme api (defaults / apply / subscribe) unchanged', async () => {
    const { app } = makeApp();

    await expect(app.theme.codeHighlightThemeDefaults()).resolves.toEqual({ light: 'githubLight' });

    app.theme.applyCodeHighlightTheme('githubLight', 'githubDark');
    const listener = vi.fn();
    const subscription = app.theme.subscribe(listener);
    expect(app.theme.subscribe).toHaveBeenCalledWith(listener);
    subscription.dispose();
  });

  it('routes info toasts through the host toast channel', () => {
    const { app } = makeApp();
    app.toast.info('uploaded');
    expect(toast.info).toHaveBeenCalledWith('uploaded');
  });

  it('persists settings and prefixes log output with the plugin id', async () => {
    const onDataChanged = vi.fn();
    const { app } = makeApp({ onDataChanged });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(pluginIpc.writeData).mockClear();

    try {
      await app.settings.set('k', 1);

      expect(pluginIpc.writeData).toHaveBeenCalledWith(
        manifest.id,
        expect.objectContaining({ settings: { k: 1 } }),
      );
      const persisted = vi.mocked(pluginIpc.writeData).mock.calls[0][1] as PluginData;
      expect(onDataChanged).toHaveBeenCalledWith(persisted);

      app.log.warn('x');
      expect(warnSpy).toHaveBeenCalledWith('[plugin:app.textox.demo]', 'x');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('rejects settings.set and rolls the memory value back when persisting fails', async () => {
    const { app } = makeApp({
      data: { settings: { k: 0, other: 'keep' }, plugin: {} },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(pluginIpc.writeData).mockRejectedValueOnce(new Error('boom'));

    try {
      await expect(app.settings.set('k', 1)).rejects.toThrow('boom');
      expect(errorSpy).toHaveBeenCalled();
      // 内存 == 最近一次成功落盘：失败的写入完全不可见
      expect(app.settings.get('k')).toBe(0);
      expect(app.settings.get('other')).toBe('keep');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('removes a newly added key from memory when persisting fails', async () => {
    const { app } = makeApp();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(pluginIpc.writeData).mockRejectedValueOnce(new Error('boom'));

    try {
      await expect(app.settings.set('fresh', 1)).rejects.toThrow('boom');
      expect(app.settings.get('fresh')).toBeUndefined();
      expect(app.settings.all().values).toEqual({});
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('keeps a snapshot stable across later set() calls and reads the same frozen copy', async () => {
    const { app } = makeApp();

    await app.settings.set('a', true);
    const snapshot = app.settings.all();
    await app.settings.set('a', false);

    // 快照是当时的冻结副本，read 与 values 必须一致（不能一个读活数据一个读副本）
    expect(snapshot.values).toEqual({ a: true });
    expect(snapshot.read('a')).toBe(true);
    expect(snapshot.read('missing')).toBeUndefined();
    expect(app.settings.all().read('a')).toBe(false);
    expect(app.settings.get('a')).toBe(false);
  });

  it('emits once when a cross-window reload reads back the value just written locally', async () => {
    let fireDataChanged: (pluginId: string) => void = () => {};
    let disk: PluginData = { settings: {}, plugin: {} };
    let reads = 0;
    const app = createPluginApp({
      manifest: {
        ...manifest,
        settings: [{ key: 'mode', type: 'text', default: 'a', labelKey: 'mode' }],
      },
      registry: new PluginRegistry(),
      deps: deps(),
      data: { settings: {}, plugin: {} },
      writeData: async (_pluginId, data) => {
        disk = { settings: { ...data.settings }, plugin: { ...data.plugin } };
      },
      readData: async () => {
        reads += 1;
        return disk;
      },
      subscribeDataChanged: (handler) => {
        fireDataChanged = handler;
        return () => {};
      },
    });
    const listener = vi.fn();
    app.settings.onDidChange(listener);

    // 本地 set：落盘后 emit 一次
    await app.settings.set('mode', 'b');
    expect(listener).toHaveBeenCalledTimes(1);

    // Rust 广播回来：本窗口重读磁盘，值未变 ⇒ 不再 emit（否则插件会重建编辑器两遍）
    fireDataChanged(manifest.id);
    await vi.waitFor(() => expect(reads).toBe(1));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(app.settings.get('mode')).toBe('b');

    // 值真的变了仍要通知（避免把热更新静默掉）
    disk = { settings: { mode: 'c' }, plugin: {} };
    fireDataChanged(manifest.id);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
    expect(listener.mock.calls[1]![0].values).toEqual({ mode: 'c' });
    expect(app.settings.get('mode')).toBe('c');

    app.dispose();
  });

  it('keeps undeclared settings keys across a cross-window reload and later writes', async () => {
    let fireDataChanged: (pluginId: string) => void = () => {};
    let disk: PluginData = { settings: {}, plugin: {} };
    let reads = 0;
    const app = createPluginApp({
      manifest: {
        ...manifest,
        settings: [{ key: 'declared', type: 'text', default: 'a', labelKey: 'declared' }],
      },
      registry: new PluginRegistry(),
      deps: deps(),
      data: { settings: {}, plugin: {} },
      writeData: async (_pluginId, data) => {
        disk = { settings: { ...data.settings }, plugin: { ...data.plugin } };
      },
      readData: async () => {
        reads += 1;
        return disk;
      },
      subscribeDataChanged: (handler) => {
        fireDataChanged = handler;
        return () => {};
      },
    });

    // 插件写入一个清单里未声明的键（旧版本遗留 / 前向兼容）
    await app.settings.set('extra', 1);
    expect(app.settings.get('extra')).toBe(1);
    expect(disk.settings).toEqual({ declared: 'a', extra: 1 });

    // 别的窗口落盘后广播回来：重读磁盘不得丢掉未声明键
    fireDataChanged(manifest.id);
    await vi.waitFor(() => expect(reads).toBe(1));
    expect(app.settings.get('extra')).toBe(1);

    // 之后任意一次 set 写盘，磁盘上的 extra 仍要在（否则被永久抹掉）
    await app.settings.set('declared', 'z');
    expect(app.settings.get('extra')).toBe(1);
    expect(disk.settings).toEqual({ declared: 'z', extra: 1 });

    app.dispose();
  });

  it('a restart field is persisted but not applied until the next start', async () => {
    let disk: PluginData = { settings: {}, plugin: {} };
    const app = createPluginApp({
      manifest: {
        ...manifest,
        settings: [
          { key: 'needsRestart', type: 'boolean', default: false, labelKey: 'x', apply: 'restart' },
        ],
      },
      registry: new PluginRegistry(),
      deps: deps(),
      data: { settings: {}, plugin: {} },
      writeData: async (_pluginId, data) => {
        disk = { settings: { ...data.settings }, plugin: { ...data.plugin } };
      },
      readData: async () => disk,
      subscribeDataChanged: () => () => {},
    });
    const listener = vi.fn();
    app.settings.onDidChange(listener);

    await app.settings.set('needsRestart', true);

    // 落盘立即（下次启动用磁盘值初始化），但运行期内存值与订阅者都不变
    expect(disk.settings.needsRestart).toBe(true);
    expect(app.settings.get('needsRestart')).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    app.dispose();
  });

  it('keeps a pending restart value on disk when another setting is written later', async () => {
    let disk: PluginData = { settings: {}, plugin: {} };
    const app = createPluginApp({
      manifest: {
        ...manifest,
        settings: [
          { key: 'needsRestart', type: 'boolean', default: false, labelKey: 'x', apply: 'restart' },
          { key: 'theme', type: 'text', default: 'light', labelKey: 'x' },
        ],
      },
      registry: new PluginRegistry(),
      deps: deps(),
      data: { settings: {}, plugin: {} },
      writeData: async (_pluginId, data) => {
        disk = { settings: { ...data.settings }, plugin: { ...data.plugin } };
      },
      readData: async () => disk,
      subscribeDataChanged: () => () => {},
    });

    await app.settings.set('needsRestart', true);
    expect(disk.settings.needsRestart).toBe(true);

    // 后续任意一次普通写入都必须原样带上尚未生效的 restart 值，否则会把磁盘回退成旧值
    await app.settings.set('theme', 'dark');
    expect(disk.settings).toEqual({ needsRestart: true, theme: 'dark' });
    // 内存值仍然等重启才生效
    expect(app.settings.get('needsRestart')).toBe(false);
    expect(app.settings.get('theme')).toBe('dark');

    app.dispose();
  });

  it('does not record a pending value when the restart write fails', async () => {
    let disk: PluginData = { settings: {}, plugin: {} };
    let failNext = true;
    const app = createPluginApp({
      manifest: {
        ...manifest,
        settings: [
          { key: 'needsRestart', type: 'boolean', default: false, labelKey: 'x', apply: 'restart' },
          { key: 'theme', type: 'text', default: 'light', labelKey: 'x' },
        ],
      },
      registry: new PluginRegistry(),
      deps: deps(),
      data: { settings: {}, plugin: {} },
      writeData: async (_pluginId, data) => {
        if (failNext) {
          failNext = false;
          throw new Error('boom');
        }
        disk = { settings: { ...data.settings }, plugin: { ...data.plugin } };
      },
      readData: async () => disk,
      subscribeDataChanged: () => () => {},
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(app.settings.set('needsRestart', true)).rejects.toThrow('boom');
      expect(disk.settings).toEqual({});

      // 失败的写入不得留在 overlay 里：下一次无关写入不能把 true 带到磁盘
      await app.settings.set('theme', 'dark');
      expect(disk.settings).toEqual({ needsRestart: false, theme: 'dark' });

      // 成功那次才记账，后续无关写入继续带上它
      await app.settings.set('needsRestart', true);
      await app.settings.set('theme', 'light');
      expect(disk.settings).toEqual({ needsRestart: true, theme: 'light' });
      expect(app.settings.get('needsRestart')).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }

    app.dispose();
  });

  it('an immediate field still applies on set', async () => {
    let disk: PluginData = { settings: {}, plugin: {} };
    const app = createPluginApp({
      manifest: {
        ...manifest,
        settings: [{ key: 'theme', type: 'text', default: 'light', labelKey: 'x' }],
      },
      registry: new PluginRegistry(),
      deps: deps(),
      data: { settings: {}, plugin: {} },
      writeData: async (_pluginId, data) => {
        disk = { settings: { ...data.settings }, plugin: { ...data.plugin } };
      },
      readData: async () => disk,
      subscribeDataChanged: () => () => {},
    });
    const listener = vi.fn();
    app.settings.onDidChange(listener);

    await app.settings.set('theme', 'dark');

    expect(disk.settings.theme).toBe('dark');
    expect(app.settings.get('theme')).toBe('dark');
    expect(listener).toHaveBeenCalledTimes(1);

    app.dispose();
  });

  it('a cross-window change to a restart field does not overwrite the running value', async () => {
    let fireDataChanged: (pluginId: string) => void = () => {};
    let disk: PluginData = { settings: { needsRestart: false }, plugin: {} };
    let reads = 0;
    const app = createPluginApp({
      manifest: {
        ...manifest,
        settings: [
          { key: 'needsRestart', type: 'boolean', default: false, labelKey: 'x', apply: 'restart' },
        ],
      },
      registry: new PluginRegistry(),
      deps: deps(),
      data: { settings: {}, plugin: {} },
      writeData: async () => {},
      readData: async () => {
        reads += 1;
        return disk;
      },
      subscribeDataChanged: (handler) => {
        fireDataChanged = handler;
        return () => {};
      },
    });
    const listener = vi.fn();
    app.settings.onDidChange(listener);

    // 别的窗口把 restart 字段改成 true：磁盘变了，但本窗口运行中的插件不受影响
    disk = { settings: { needsRestart: true }, plugin: {} };
    fireDataChanged(manifest.id);
    await vi.waitFor(() => expect(reads).toBe(1));

    expect(app.settings.get('needsRestart')).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    app.dispose();
  });

  it('drops select fields without options', () => {
    const warn = vi.fn();
    const good = { key: 'shout', type: 'boolean', default: false, labelKey: 'shout' };
    const missingOptions = { key: 'mode', type: 'select', default: 'a', labelKey: 'mode' };
    const emptyOptions = { key: 'mode', type: 'select', default: 'a', labelKey: 'mode', options: [] };
    const badOption = {
      key: 'mode',
      type: 'select',
      default: 'a',
      labelKey: 'mode',
      options: [{ value: '' }],
    };

    const fields = parseManifestSettings(
      { ...manifest, settings: [good, missingOptions, emptyOptions, badOption] },
      { warn },
    );

    // 缺 options 的 select 会在渲染期 `field.options.map` 抛错（整页卸载），必须在入口丢弃
    expect(fields).toEqual([good]);
    expect(warn).toHaveBeenCalledWith('dropping invalid settings field', missingOptions);
    expect(warn).toHaveBeenCalledWith('dropping invalid settings field', emptyOptions);
    expect(warn).toHaveBeenCalledWith('dropping invalid settings field', badOption);
  });

  it('drops numeric fields with non-finite defaults', () => {
    const warn = vi.fn();
    const good = { key: 'count', type: 'number', default: 5, labelKey: 'count' };
    const nullDefault = { key: 'count', type: 'number', default: null, labelKey: 'count' };
    const infiniteDefault = {
      key: 'count',
      type: 'number',
      default: Number.POSITIVE_INFINITY,
      labelKey: 'count',
    };

    const fields = parseManifestSettings(
      { ...manifest, settings: [good, nullDefault, infiniteDefault] },
      { warn },
    );

    // ±Infinity / null 无法 JSON 往返：落盘会变成 null，输入框也回显不出有效值
    expect(fields).toEqual([good]);
    expect(warn).toHaveBeenCalledWith('dropping invalid settings field', nullDefault);
    expect(warn).toHaveBeenCalledWith('dropping invalid settings field', infiniteDefault);
  });

  it('warns and drops invalid manifest.settings fields instead of silently ignoring them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { app } = makeApp({
        settings: [
          null,
          { key: 1, type: 'text' },
          { key: 'bogus', type: 'definitely-not-a-field' },
          { key: 'ok', type: 'text', default: 'v', labelKey: 'ok' },
          { key: 'tint', type: 'color', default: '#fff', labelKey: 'tint' },
        ],
      });

      expect(warn).toHaveBeenCalledWith(
        '[plugin:app.textox.demo]',
        'dropping invalid settings field',
        null,
      );
      expect(warn).toHaveBeenCalledWith(
        '[plugin:app.textox.demo]',
        'dropping invalid settings field',
        { key: 1, type: 'text' },
      );
      expect(warn).toHaveBeenCalledWith(
        '[plugin:app.textox.demo]',
        'dropping invalid settings field',
        { key: 'bogus', type: 'definitely-not-a-field' },
      );
      // 合法字段（含 color）仍回填默认值
      expect(app.settings.get('ok')).toBe('v');
      expect(app.settings.get('tint')).toBe('#fff');
      expect(app.settings.get('bogus')).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('warns when manifest.settings itself is not an array', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const badManifest = { ...manifest, settings: 'abc' } as unknown as PluginManifest;
      const { app } = makeApp({ manifestOverride: badManifest });

      expect(warn).toHaveBeenCalledWith(
        '[plugin:app.textox.demo]',
        'dropping invalid settings declaration',
        'abc',
      );
      expect(app.settings.all().values).toEqual({});
    } finally {
      warn.mockRestore();
    }
  });

  it('drops malformed color / preset / action declarations', () => {
    const warn = vi.fn();
    const goodColor = { key: 'tint', type: 'color', default: '#f7d54e', labelKey: 'tint' };
    const goodPreset = {
      key: 'density',
      type: 'preset',
      labelKey: 'density',
      options: [{ value: 'compact', labelKey: 'compact', values: { spacing: 0 } }],
    };
    const goodAction = { key: 'ping', type: 'action', labelKey: 'ping', command: 'p.ping' };
    // color 的 default 必须是合法 hex：渲染器把裸字符串塞进 `<input type="color">`，非法值只显示黑色
    const badColor = { key: 'tint', type: 'color', default: 'red', labelKey: 'tint' };
    const missingColorDefault = { key: 'tint', type: 'color', labelKey: 'tint' };
    // preset 的每项都必须带 values 补丁，否则「选它」什么也写不进去
    const missingValues = {
      key: 'density',
      type: 'preset',
      labelKey: 'density',
      options: [{ value: 'compact', labelKey: 'compact' }],
    };
    const arrayValues = {
      key: 'density',
      type: 'preset',
      labelKey: 'density',
      options: [{ value: 'compact', labelKey: 'compact', values: [] }],
    };
    const emptyOptions = { key: 'density', type: 'preset', labelKey: 'density', options: [] };
    // action 只引用命令 id：缺它就没有可执行入口
    const missingCommand = { key: 'ping', type: 'action', labelKey: 'ping' };
    const emptyCommand = { key: 'ping', type: 'action', labelKey: 'ping', command: '' };

    const fields = parseManifestSettings(
      {
        ...manifest,
        settings: [
          goodColor,
          goodPreset,
          goodAction,
          badColor,
          missingColorDefault,
          missingValues,
          arrayValues,
          emptyOptions,
          missingCommand,
          emptyCommand,
        ],
      },
      { warn },
    );

    expect(fields).toEqual([goodColor, goodPreset, goodAction]);
    for (const dropped of [
      badColor,
      missingColorDefault,
      missingValues,
      arrayValues,
      emptyOptions,
      missingCommand,
      emptyCommand,
    ]) {
      expect(warn).toHaveBeenCalledWith('dropping invalid settings field', dropped);
    }
  });

  it('backfills defaults only for value fields (preset/action carry none)', () => {
    const { app } = makeApp({
      settings: [
        { key: 'profile', type: 'modelProfile', default: '', labelKey: 'profile' },
        { key: 'tint', type: 'color', default: '#f7d54e', labelKey: 'tint' },
        {
          key: 'density',
          type: 'preset',
          labelKey: 'density',
          options: [{ value: 'compact', labelKey: 'compact', values: { tint: '#000' } }],
        },
        { key: 'ping', type: 'action', labelKey: 'ping', command: 'p.ping' },
      ],
    });

    expect(app.settings.all().values).toEqual({ profile: '', tint: '#f7d54e' });
  });

  it('does not write data or notify the host after dispose()', async () => {
    const onDataChanged = vi.fn();
    const { app } = makeApp({ onDataChanged });
    vi.mocked(pluginIpc.writeData).mockClear();

    app.dispose();
    await app.settings.set('late', 1);

    expect(pluginIpc.writeData).not.toHaveBeenCalled();
    expect(app.settings.get('late')).toBeUndefined();
    expect(onDataChanged).not.toHaveBeenCalled();
  });

  it('ignores an in-flight cross-window reload that lands after dispose()', async () => {
    let fireDataChanged: (pluginId: string) => void = () => {};
    let resolveRead: (next: PluginData) => void = () => {};
    const onDataChanged = vi.fn();
    const app = createPluginApp({
      manifest,
      registry: new PluginRegistry(),
      deps: deps(),
      data: { settings: { keep: 1 }, plugin: {} },
      onDataChanged,
      readData: () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      subscribeDataChanged: (handler) => {
        fireDataChanged = handler;
        return () => {};
      },
    });
    const listener = vi.fn();
    app.settings.onDidChange(listener);

    fireDataChanged(manifest.id);
    app.dispose();
    resolveRead({ settings: { keep: 2 }, plugin: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.settings.get('keep')).toBe(1);
    expect(onDataChanged).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not treat NaN as a change on every cross-window reload', async () => {
    let fireDataChanged: (pluginId: string) => void = () => {};
    const app = createPluginApp({
      manifest,
      registry: new PluginRegistry(),
      deps: deps(),
      data: { settings: {}, plugin: {} },
      readData: async () => ({ settings: { n: Number.NaN }, plugin: {} }),
      subscribeDataChanged: (handler) => {
        fireDataChanged = handler;
        return () => {};
      },
    });
    const listener = vi.fn();
    app.settings.onDidChange(listener);

    fireDataChanged(manifest.id);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    fireDataChanged(manifest.id);
    // NaN 与 NaN 用 Object.is 判定相等，不该再广播一次
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listener).toHaveBeenCalledTimes(1);

    app.dispose();
  });

  it('delegates the four bridge capabilities to host deps', async () => {
    const hostDeps = deps();
    const app = createPluginApp({
      manifest,
      registry: new PluginRegistry(),
      deps: hostDeps,
      data: { settings: {}, plugin: {} },
    });
    const embed = {
      id: 'app.textox.demo.embed',
      extensions: ['.demo'],
      insertLabelKey: 'embed',
      matches: () => true,
      createPreview: () => ({ render: () => {} }),
    };
    const fileEditor = {
      id: 'app.textox.demo.editor',
      extensions: ['.demo'],
      newFile: 'newDemo',
      createEmptyContent: () => '',
      load: async () => ({ default: {} }),
    };

    app.editor.registerEmbed(embed);
    app.editor.parseEmbedRef('![a](b.md)');
    app.workspace.registerFileEditor(fileEditor);
    await app.documents.createNewDocument({ content: 'x', extension: 'demo' });
    app.i18n.addMessages({ 'zh-CN': { hello: '你好' } }, 'zh-CN');

    expect(hostDeps.registerEmbed).toHaveBeenCalledWith(embed, manifest.id);
    expect(hostDeps.parseEmbedRef).toHaveBeenCalledWith('![a](b.md)');
    expect(hostDeps.registerFileEditor).toHaveBeenCalledWith(fileEditor, manifest.id);
    expect(hostDeps.createNewDocument).toHaveBeenCalledWith({
      content: 'x',
      extension: 'demo',
    });
    expect(hostDeps.addMessages).toHaveBeenCalledWith(
      { 'zh-CN': { hello: '你好' } },
      'zh-CN',
      manifest.id,
    );
  });

  it('passes bridge calls and the returned disposable through to host deps', () => {
    const disposable = toDisposable(() => {});
    const hostDeps = deps();
    vi.mocked(hostDeps.registerEmbed).mockReturnValue(disposable);
    const registry = new PluginRegistry();
    const app = createPluginApp({
      manifest,
      registry,
      deps: hostDeps,
      data: { settings: {}, plugin: {} },
    });
    const options = {
      id: 'app.textox.demo.embed',
      extensions: ['.demo'],
      insertLabelKey: 'embed',
      matches: () => true,
      createPreview: () => ({ render: () => {} }),
    };

    const returned = app.editor.registerEmbed(options);

    expect(hostDeps.registerEmbed).toHaveBeenCalledWith(options, manifest.id);
    expect(returned).toBe(disposable);

  });

  it('returns the disposable from workspace.registerFileEditor unchanged', () => {
    const hostDeps = deps();
    const app = createPluginApp({
      manifest,
      registry: new PluginRegistry(),
      deps: hostDeps,
      data: { settings: {}, plugin: {} },
    });
    const fileEditorDisposable = toDisposable(() => {});
    vi.mocked(hostDeps.registerFileEditor).mockReturnValue(fileEditorDisposable);
    const fileOptions = {
      id: 'app.textox.demo.editor',
      extensions: ['.demo'],
      newFile: 'newDemo',
      createEmptyContent: () => '',
      load: async () => ({ default: {} }),
    };

    const returnedFileEditor = app.workspace.registerFileEditor(fileOptions);

    expect(hostDeps.registerFileEditor).toHaveBeenCalledWith(fileOptions, manifest.id);
    expect(returnedFileEditor).toBe(fileEditorDisposable);
  });

  it('delegates toast calls to sonner', () => {
    const { app } = makeApp();

    app.toast.success('x');

    expect(toast.success).toHaveBeenCalledWith('x');
  });

  it('reports the edition from VITE_FREE_VERSION', () => {
    try {
      vi.stubEnv('VITE_FREE_VERSION', 'true');
      expect(makeApp().app.edition).toBe('lite');
      vi.stubEnv('VITE_FREE_VERSION', 'false');
      expect(makeApp().app.edition).toBe('full');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('falls back to 0.0.0 when __APP_VERSION__ is not injected', () => {
    expect(makeApp().app.version).toBe('0.0.0');
  });

  it('uses the injected __APP_VERSION__', () => {
    const scope = globalThis as Record<string, unknown>;
    scope.__APP_VERSION__ = '9.9.9';
    try {
      expect(makeApp().app.version).toBe('9.9.9');
    } finally {
      delete scope.__APP_VERSION__;
    }
  });
});

describe('toHostSettingsFields', () => {
  it('passes value fields through unchanged (colour presets included)', () => {
    const tint = {
      key: 'tint',
      type: 'color' as const,
      default: '#f7d54e',
      labelKey: 'tint',
      presets: [{ value: '#f7d54e' }, { value: '#a0e8a0', labelKey: 'green' }],
    };
    const profile = { key: 'profile', type: 'modelProfile' as const, default: '', labelKey: 'p' };

    const fields = toHostSettingsFields([tint, profile]);

    // 清单形状与面板形状相容：不复制、不改写（默认值 / color 预设原样透传）
    expect(fields[0]).toBe(tint);
    expect(fields[1]).toBe(profile);
  });

  it('derives preset value()/apply() from the option patches', () => {
    const fields = toHostSettingsFields([
      { key: 'spacing', type: 'number', default: 1, labelKey: 'spacing' },
      {
        key: 'theme',
        type: 'preset',
        labelKey: 'theme',
        options: [
          { value: 'compact', labelKey: 'compact', values: { spacing: 0, accent: false } },
          { value: 'roomy', labelKey: 'roomy', values: { spacing: 2, accent: true } },
        ],
      },
    ]);
    const preset = fields[1];
    if (preset.type !== 'preset') throw new Error('expected a preset field');

    // 选项只保留渲染需要的 value / labelKey（values 是写入规则，不进下拉项）
    expect(preset.options).toEqual([
      { value: 'compact', labelKey: 'compact' },
      { value: 'roomy', labelKey: 'roomy' },
    ]);

    // 当前选中项 = 有效配置与某个补丁逐键一致
    expect(preset.value({ spacing: 2, accent: true })).toBe('roomy');
    // 用户手工改过某个键（混合态）⇒ 没有匹配项
    expect(preset.value({ spacing: 2, accent: false })).toBe('');

    const patch = preset.apply('compact', {});
    expect(patch).toEqual({ spacing: 0, accent: false });
    // 返回副本：面板之后的改写不能污染清单里的声明
    expect(patch).not.toBe(preset.apply('compact', {}));
    expect(preset.apply('missing', {})).toBeUndefined();
  });

  it('renders actions by key and keeps the command reference dispatchable', async () => {
    const action = {
      key: 'testConnection',
      type: 'action' as const,
      labelKey: 'test',
      descriptionKey: 'testDesc',
      command: 'picgo.test',
    };
    const { app, registry } = makeApp({ settings: [action] });
    const callback = vi.fn();
    registry.register(manifest.id, 'command', action.command, {
      id: action.command,
      name: 'Test connection',
      callback,
    });

    const [view] = toHostSettingsFields([action]);

    if (view.type !== 'action') throw new Error('expected an action field');
    // 面板按 `id` 渲染 / 标识；`command` 经展开式保留，面板 onAction 直接交给 runManifestAction
    expect(view.id).toBe('testConnection');
    expect(view.labelKey).toBe('test');
    expect(view.descriptionKey).toBe('testDesc');
    await expect(runManifestAction(manifest.id, view)).resolves.toBe(true);
    expect(callback).toHaveBeenCalledTimes(1);
    app.dispose();
  });
});
