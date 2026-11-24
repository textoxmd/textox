import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ipc', () => ({
  pluginIpc: {
    seedBundled: vi.fn(async () => []),
    scan: vi.fn(),
    getState: vi.fn(),
    readData: vi.fn(async () => ({ settings: {}, plugin: {} })),
    readAsset: vi.fn(),
    setEnabled: vi.fn(),
    installFromFile: vi.fn(),
    uninstall: vi.fn(async () => []),
  },
  subscribePluginDataChanged: () => () => {},
}));
const { registerPluginMessagesMock } = vi.hoisted(() => ({
  registerPluginMessagesMock: vi.fn(async () => {}),
}));
vi.mock('@/i18n', () => ({
  default: { getFixedT: () => () => '' },
  registerPluginMessages: registerPluginMessagesMock,
}));
// createHostDeps 桥接的旧体系模块（动态 import，同样受 vi.mock 拦截）
const {
  registerContributionsMock,
  unregisterContributionMock,
  unregisterOwnerMock,
  getInstalledHostDepsMock,
  makeHostDeps,
} = vi.hoisted(() => {
    interface HoistedHostDeps {
      getCurrentFile(): string | null;
      getDocumentDir(): string | null;
      openFile(path: string): Promise<void>;
      toDocumentRelative(path: string): string;
      createNewDocument(opts: { content: string; extension?: string }): Promise<void>;
      insertImageRef(src: string, alt: string): void;
      canEdit(): boolean;
      getSelectionContext(): null;
    }
    const make = (file: string): HoistedHostDeps => ({
      getCurrentFile: () => file,
      getDocumentDir: () => file.slice(0, file.lastIndexOf('/')),
      openFile: async () => {},
      toDocumentRelative: (path: string) => path,
      createNewDocument: async () => {},
      insertImageRef: () => {},
      canEdit: () => true,
      getSelectionContext: () => null,
    });
    return {
      registerContributionsMock: vi.fn(),
      unregisterContributionMock: vi.fn(),
      unregisterOwnerMock: vi.fn(),
      makeHostDeps: make,
      getInstalledHostDepsMock: vi.fn<() => HoistedHostDeps | null>(() => make('/notes/a.md')),
    };
  });
// 只替换注册/注销：`@texto/plugin-sdk` 其余导出（编辑器扩展点 id 等）必须从真实模块透传。
vi.mock('@texto/plugin-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@texto/plugin-sdk')>()),
  registerContributions: registerContributionsMock,
  unregisterContribution: unregisterContributionMock,
  unregisterOwner: unregisterOwnerMock,
}));
vi.mock('@texto/app-api', () => ({ APP_FILE_EDITOR: 'app:fileEditor' }));
vi.mock('@texto/markdown-editor-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@texto/markdown-editor-api')>();
  return { ...actual };
});
vi.mock('@/plugins/host', () => ({
  getInstalledHostDeps: getInstalledHostDepsMock,
  installHostDeps: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import {
  Plugin,
  toDisposable,
  type EmbedNodeLike,
  type PluginManifest,
} from '@textox/plugin-sdk';

import type { PluginHostDeps } from '../app';
import {
  createHostDeps,
  installPluginFromFile,
  refreshPlugins,
  resetHostDepsForTests,
  setHostDepsBuilderForTests,
  uninstallPlugin,
  disablePlugin,
  enablePlugin,
  initPluginRuntime,
  isPluginRunning,
  pluginRegistry,
  pluginState,
  resetPluginRuntimeForTests,
  startPlugin,
  stopPlugin,
} from '../index';
import { pluginIpc, type InstalledPluginDto } from '../ipc';

const ID = 'app.textox.test';

const manifest: PluginManifest = {
  id: ID,
  name: 'Test',
  version: '1.0.0',
  minAppVersion: '2.3.8',
  author: { name: 'Textox' },
};

function deps(): PluginHostDeps {
  return {
    getActiveFilePath: () => null,
    getDocumentDir: () => null,
    openFile: async () => {},
    insertText: () => false,
    canEdit: () => false,
    registerEmbed: () => toDisposable(() => {}),
    registerFileEditor: () => toDisposable(() => {}),
    registerSyntaxFeature: () => toDisposable(() => {}),
    registerExtension: () => toDisposable(() => {}),
    registerFormatToolbarItem: () => toDisposable(() => {}),
    registerContextMenuItem: () => toDisposable(() => {}),
    registerSelectionAction: () => toDisposable(() => {}),
    registerSyntaxHighlight: () => toDisposable(() => {}),
    registerInsertCommand: () => toDisposable(() => {}),
    registerExporter: () => toDisposable(() => {}),
    registerImageUploader: () => toDisposable(() => {}),
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
      subscribe: () => toDisposable(() => {}),
      codeHighlightThemeDefaults: async () => ({}),
    }),
    createDialogsApi: () => ({
      pickFile: async () => null,
      confirm: async () => false,
    }),
    requestReload: () => {},
    createNewDocument: async () => {},
    addMessages: () => {},
    parseEmbedRef: () => null,
  };
}

function entry(overrides: Partial<InstalledPluginDto> = {}): InstalledPluginDto {
  return {
    id: ID,
    dir: `/plugins/${ID}`,
    manifest,
    enabled: true,
    error: null,
    ...overrides,
  };
}

function encode(text: string): string {
  return btoa(text);
}

class FakePlugin extends Plugin {
  static unloaded = false;

  onload(): void {
    this.addCommand({ id: `${ID}.say`, name: 'Say', callback: () => {} });
  }

  override onunload(): void {
    FakePlugin.unloaded = true;
  }
}

function stylesMarkup(id: string): string {
  return `[data-plugin='${id}'] { color: red; }`;
}

beforeEach(async () => {
  // 「未初始化」类用例需要确定的起点
  await resetPluginRuntimeForTests();
  unregisterOwnerMock.mockReset();
  // 其它用例可能改过全局 mock（惰性读取用例），复位到默认文件
  getInstalledHostDepsMock.mockReset();
  getInstalledHostDepsMock.mockReturnValue(makeHostDeps('/notes/a.md'));
  vi.mocked(pluginIpc.setEnabled).mockReset();
  vi.mocked(pluginIpc.setEnabled).mockResolvedValue({ safe_mode: false, enabled: [] });
  vi.mocked(pluginIpc.seedBundled).mockReset();
  vi.mocked(pluginIpc.seedBundled).mockResolvedValue([]);
  // 调用次数断言（播种顺序 / 失败后仍扫描）需要干净的调用记录；实现由各用例自己给
  vi.mocked(pluginIpc.scan).mockClear();
  vi.mocked(pluginIpc.getState).mockClear();
  FakePlugin.unloaded = false;
  vi.mocked(pluginIpc.readData).mockReset();
  vi.mocked(pluginIpc.readData).mockResolvedValue({ settings: {}, plugin: {} });
  vi.mocked(pluginIpc.readAsset).mockReset();
  vi.mocked(pluginIpc.readAsset).mockImplementation(async (id, path) => {
    if (path === 'styles.css') return encode(stylesMarkup(id));
    throw new Error(`unexpected asset: ${path}`);
  });
  // 真实流程里 initPluginRuntime 先 setSnapshot，startPlugin 才能在快照上改状态。
  // 这里 enabled 留空：startPlugin 成功后的 `enabled` 断言才能真正验证 markStatus。
  pluginState.setSnapshot([entry()], { safe_mode: false, enabled: [] });
});

afterEach(() => {
  // `reads the installed host deps lazily` 会改全局 mock，复位到默认文件
  getInstalledHostDepsMock.mockReset();
  getInstalledHostDepsMock.mockReturnValue(makeHostDeps('/notes/a.md'));
});

describe('startPlugin', () => {
  it('loads an enabled plugin and registers its command', async () => {
    await startPlugin(entry(), deps(), { importModule: async () => ({ default: FakePlugin }) });

    expect(pluginRegistry.count('command')).toBe(1);
    expect(isPluginRunning(ID)).toBe(true);
    expect(pluginState.list().find((item) => item.id === ID)?.status).toBe('enabled');
  });

  it('injects the plugin stylesheet with a data-plugin marker', async () => {
    await startPlugin(entry(), deps(), { importModule: async () => ({ default: FakePlugin }) });

    const style = document.head.querySelector(`style[data-plugin="${ID}"]`);

    expect(style).not.toBeNull();
    expect(style?.textContent).toContain(stylesMarkup(ID));
  });

  it('marks the plugin as failed when the module does not export a plugin class', async () => {
    await startPlugin(entry(), deps(), { importModule: async () => ({ default: {} }) });

    const status = pluginState.list().find((item) => item.id === ID);
    expect(status?.status).toBe('load-failed');
    expect(status?.errorMessage).toBe('default export is not a function');
    expect(pluginRegistry.count('command')).toBe(0);
  });

  it('reports a class that does not extend the host Plugin', async () => {
    class NotAPlugin {}

    await startPlugin(entry(), deps(), { importModule: async () => ({ default: NotAPlugin }) });

    const status = pluginState.list().find((item) => item.id === ID);
    expect(status?.status).toBe('load-failed');
    expect(status?.errorMessage).toContain('does not extend the host Plugin');
  });

  it('rejects an entry whose directory and manifest ids differ', async () => {
    const mismatched = entry({
      id: 'app.textox.dirname',
      manifest: { ...manifest, id: 'app.textox.manifest' },
    });
    pluginState.setSnapshot([mismatched], { safe_mode: false, enabled: [] });

    await startPlugin(mismatched, deps(), { importModule: async () => ({ default: FakePlugin }) });

    const status = pluginState.list().find((item) => item.id === 'app.textox.dirname');
    expect(status?.status).toBe('load-failed');
    expect(status?.errorMessage).toContain('does not match directory');
    expect(pluginRegistry.count('command')).toBe(0);
  });

  it('times out a never-resolving onload', async () => {
    class HangingPlugin extends Plugin {
      onload(): Promise<void> {
        return new Promise(() => {});
      }
    }

    await startPlugin(entry(), deps(), {
      importModule: async () => ({ default: HangingPlugin }),
      onloadTimeoutMs: 10,
    });

    const status = pluginState.list().find((item) => item.id === ID);
    expect(status?.status).toBe('load-failed');
    expect(status?.errorMessage).toContain('onload timed out');
    expect(pluginRegistry.count('command')).toBe(0);
    expect(isPluginRunning(ID)).toBe(false);
  });

  it('applies the defaults declared in manifest.settings', async () => {
    class SettingsPlugin extends Plugin {
      static seen: unknown;

      onload(): void {
        SettingsPlugin.seen = this.settings.get('greeting');
      }
    }

    await startPlugin(
      entry({
        manifest: {
          ...manifest,
          settings: [{ key: 'greeting', type: 'text', default: 'Hello', labelKey: 'greeting' }],
        },
      }),
      deps(),
      { importModule: async () => ({ default: SettingsPlugin }) },
    );

    expect(SettingsPlugin.seen).toBe('Hello');
  });

  it('rolls back registrations when onload throws', async () => {
    class ThrowingPlugin extends Plugin {
      onload(): void {
        this.addCommand({ id: `${ID}.boom`, name: 'Boom', callback: () => {} });
        // 直接走 app.register 的贡献不在插件自己的 store 里，只能靠 registry.disposeOwner 清掉
        this.app.register('command', `${ID}.direct`, { id: `${ID}.direct` });
        throw new Error('boom');
      }
    }

    await startPlugin(entry(), deps(), { importModule: async () => ({ default: ThrowingPlugin }) });

    const status = pluginState.list().find((item) => item.id === ID);
    expect(status?.status).toBe('load-failed');
    expect(status?.errorMessage).toBe('boom');
    expect(pluginRegistry.count('command')).toBe(0);
    expect(document.head.querySelector(`style[data-plugin="${ID}"]`)).toBeNull();
    // 插件在 onload 抛错前注册的扩展点贡献也要按 owner 清掉（否则重试会无界追加）
    expect(unregisterOwnerMock).toHaveBeenCalledWith(ID);
  });
});

describe('stopPlugin', () => {
  it('unloads, disposes and clears the registry', async () => {
    await startPlugin(entry(), deps(), { importModule: async () => ({ default: FakePlugin }) });

    await stopPlugin(ID);

    expect(FakePlugin.unloaded).toBe(true);
    expect(isPluginRunning(ID)).toBe(false);
    expect(pluginRegistry.count('command')).toBe(0);
    expect(document.head.querySelector(`style[data-plugin="${ID}"]`)).toBeNull();
    expect(pluginState.list().find((item) => item.id === ID)?.status).toBe('installed');
    // 插件没在 onunload 里 dispose 的扩展点贡献也不能留到重启 / 下次启用
    expect(unregisterOwnerMock).toHaveBeenCalledWith(ID);

    await expect(stopPlugin(ID)).resolves.toBeUndefined();
  });

  it('clears contributions registered directly through the app', async () => {
    class DirectPlugin extends Plugin {
      onload(): void {
        // 不经 addCommand，注册表里只有 registry.disposeOwner 能清掉它
        this.app.register('command', `${ID}.direct`, { id: `${ID}.direct` });
      }
    }

    await startPlugin(entry(), deps(), { importModule: async () => ({ default: DirectPlugin }) });
    expect(pluginRegistry.count('command')).toBe(1);

    await stopPlugin(ID);

    expect(pluginRegistry.count('command')).toBe(0);
  });
});

describe('initPluginRuntime', () => {
  it('calls seed before scanning', async () => {
    const order: string[] = [];
    // seed 里刻意先让出一个微任务：只有真正 await 完成它，scan 才会排在后面。
    // 若实现改成 fire-and-forget，scan 会先入队（断言能区分「调用」与「等待」）。
    vi.mocked(pluginIpc.seedBundled).mockImplementation(async () => {
      await Promise.resolve();
      order.push('seed');
      return [];
    });
    vi.mocked(pluginIpc.scan).mockImplementation(async () => {
      order.push('scan');
      return [];
    });
    vi.mocked(pluginIpc.getState).mockResolvedValue({ safe_mode: false, enabled: [] });

    await initPluginRuntime(deps(), { importModule: async () => ({ default: FakePlugin }) });

    expect(order).toEqual(['seed', 'scan']);
    expect(order.indexOf('seed')).toBeLessThan(order.indexOf('scan'));
  });

  it('injects locale bundles for plugins that never load', async () => {
    vi.mocked(pluginIpc.seedBundled).mockResolvedValue([]);
    // 默认停用：不会被 onload，设置页只能靠扫描后的 locales.json
    vi.mocked(pluginIpc.scan).mockResolvedValue([{ ...entry(), enabled: false }]);
    vi.mocked(pluginIpc.getState).mockResolvedValue({ safe_mode: false, enabled: [] });
    const payload = Buffer.from(
      JSON.stringify({ defaultLocale: 'en-US', locales: { 'en-US': { name: 'Localized' } } }),
    ).toString('base64');
    vi.mocked(pluginIpc.readAsset).mockImplementation(async (_id, path) => {
      if (path === 'locales.json') return payload;
      throw new Error('not found');
    });
    registerPluginMessagesMock.mockClear();

    await initPluginRuntime(deps(), { importModule: async () => ({ default: FakePlugin }) });

    expect(registerPluginMessagesMock).toHaveBeenCalledWith(
      'app.textox.test',
      { 'en-US': { name: 'Localized' } },
      'en-US',
    );
  });

  it('keeps starting plugins when seeding fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 非 Tauri 环境（浏览器 dev）没有该命令；打包遗漏时也可能整个命令不存在
      vi.mocked(pluginIpc.seedBundled).mockRejectedValue(new Error('command not found'));
      vi.mocked(pluginIpc.scan).mockResolvedValue([entry()]);
      vi.mocked(pluginIpc.getState).mockResolvedValue({ safe_mode: false, enabled: [ID] });

      await expect(
        initPluginRuntime(deps(), { importModule: async () => ({ default: FakePlugin }) }),
      ).resolves.toBeUndefined();

      expect(pluginIpc.scan).toHaveBeenCalledTimes(1);
      expect(pluginState.list().find((item) => item.id === ID)?.status).toBe('enabled');
      expect(warn).toHaveBeenCalledWith('[plugin] seed bundled plugins failed', expect.any(Error));
    } finally {
      warn.mockRestore();
    }
  });

  it('skips disabled, errored, unsafe-mode, invalid ids and invalid manifests', async () => {
    const thirdParty = 'io.github.acme.test';
    const thirdPartyManifest: PluginManifest = {
      ...manifest,
      id: thirdParty,
      name: 'Third party',
    };
    const invalidManifest = { id: 'app.textox.broken' } as PluginManifest;
    // 非法目录名（空段）但以 `app.textox.` 开头，确保不会先被 safe-mode 拦下。
    // 关键：manifest 的 id 用一个**合法且不同**的值——否则 `validateManifest` 也会因
    // invalid-id 跳过该条目，删除 id 校验后行为完全一致，断言无法区分两条路径。
    const invalidId = 'app.textox..broken';
    const invalidIdManifest: PluginManifest = {
      ...manifest,
      id: 'app.textox.manifest-name',
      name: 'Broken id',
    };

    vi.mocked(pluginIpc.scan).mockResolvedValue([
      entry(),
      entry({ id: 'app.textox.disabled', enabled: false }),
      entry({ id: 'app.textox.errored', error: 'broken manifest' }),
      entry({ id: thirdParty, manifest: thirdPartyManifest }),
      entry({ id: 'app.textox.broken', manifest: invalidManifest }),
      entry({ id: invalidId, manifest: invalidIdManifest }),
    ]);
    vi.mocked(pluginIpc.getState).mockResolvedValue({
      safe_mode: true,
      enabled: [
        ID,
        'app.textox.disabled',
        'app.textox.errored',
        thirdParty,
        'app.textox.broken',
        invalidId,
      ],
    });

    const started: string[] = [];
    class TrackedPlugin extends Plugin {
      onload(): void {
        started.push(this.manifest.id);
        this.addCommand({ id: `${this.manifest.id}.say`, name: 'Say', callback: () => {} });
      }
    }

    await initPluginRuntime(deps(), {
      importModule: async () => ({ default: TrackedPlugin }),
    });

    expect(started).toEqual([ID]);
    expect(pluginRegistry.count('command')).toBe(1);

    const byId = (id: string) => pluginState.list().find((item) => item.id === id);

    // Rust 扫描错误：直接展示给用户
    expect(byId('app.textox.errored')?.status).toBe('load-failed');
    expect(byId('app.textox.errored')?.errorMessage).toBe('broken manifest');
    // 安全模式拦截的第三方
    expect(byId(thirdParty)?.status).toBe('blocked');
    // 非法 id 与非法 manifest 各有可读原因
    expect(byId(invalidId)?.status).toBe('load-failed');
    expect(byId(invalidId)?.errorMessage).toBe('invalid plugin id');
    expect(byId('app.textox.broken')?.status).toBe('load-failed');
    expect(byId('app.textox.broken')?.errorMessage).toBe('invalid manifest.json');
  });
});

describe('enablePlugin / disablePlugin', () => {
  it('refuses to enable third-party plugins while safe mode is on', async () => {
    vi.mocked(pluginIpc.scan).mockResolvedValue([]);
    vi.mocked(pluginIpc.getState).mockResolvedValue({ safe_mode: true, enabled: [] });
    await initPluginRuntime(deps(), { importModule: async () => ({ default: FakePlugin }) });

    const thirdParty = 'io.github.acme.test';
    const thirdPartyEntry = entry({
      id: thirdParty,
      manifest: { ...manifest, id: thirdParty, name: 'Third party' },
    });
    pluginState.setSnapshot([thirdPartyEntry], { safe_mode: true, enabled: [] });
    vi.mocked(pluginIpc.setEnabled).mockClear();

    await expect(enablePlugin(thirdPartyEntry)).rejects.toThrow(
      'safe mode is enabled: only built-in plugins can be enabled',
    );

    expect(pluginIpc.setEnabled).not.toHaveBeenCalled();
    expect(isPluginRunning(thirdParty)).toBe(false);
  });

  it('does not persist enabled state when the runtime is not initialized', async () => {
    const order: string[] = [];
    vi.mocked(pluginIpc.setEnabled).mockImplementation(async () => {
      order.push('setEnabled');
      return { safe_mode: false, enabled: [ID] };
    });
    pluginState.setSnapshot([entry()], { safe_mode: false, enabled: [] });

    await expect(enablePlugin(entry())).rejects.toThrow(
      'plugin runtime is not initialized (call initPluginRuntime first)',
    );

    expect(order).toEqual([]);
    expect(pluginIpc.setEnabled).not.toHaveBeenCalled();
  });

  it('persists the enabled flag before loading the plugin', async () => {
    const order: string[] = [];
    vi.mocked(pluginIpc.setEnabled).mockImplementation(async () => {
      order.push('setEnabled');
      return { safe_mode: false, enabled: [ID] };
    });
    vi.mocked(pluginIpc.scan).mockResolvedValue([]);
    vi.mocked(pluginIpc.getState).mockResolvedValue({ safe_mode: false, enabled: [] });

    class OrderedPlugin extends Plugin {
      onload(): void {
        order.push('register');
        this.addCommand({ id: `${ID}.say`, name: 'Say', callback: () => {} });
      }
    }

    await initPluginRuntime(deps(), {
      importModule: async () => {
        order.push('import');
        return { default: OrderedPlugin };
      },
    });
    pluginState.setSnapshot([entry()], { safe_mode: false, enabled: [] });

    await enablePlugin(entry());

    expect(order).toEqual(['setEnabled', 'import', 'register']);
    expect(pluginIpc.setEnabled).toHaveBeenCalledWith(ID, true);
    expect(isPluginRunning(ID)).toBe(true);
  });

  it('persists the disabled flag before tearing the plugin down', async () => {
    vi.mocked(pluginIpc.setEnabled).mockResolvedValue({ safe_mode: false, enabled: [] });
    vi.mocked(pluginIpc.scan).mockResolvedValue([entry()]);
    vi.mocked(pluginIpc.getState).mockResolvedValue({ safe_mode: false, enabled: [ID] });

    await initPluginRuntime(deps(), { importModule: async () => ({ default: FakePlugin }) });
    expect(pluginRegistry.count('command')).toBe(1);

    await disablePlugin(ID);

    expect(pluginIpc.setEnabled).toHaveBeenCalledWith(ID, false);
    expect(pluginRegistry.count('command')).toBe(0);
    expect(isPluginRunning(ID)).toBe(false);
  });
});

describe('createHostDeps', () => {
  it('exposes and wires the four bridge capabilities', async () => {
    const deps = await createHostDeps();

    expect(typeof deps.registerEmbed).toBe('function');
    expect(typeof deps.registerFileEditor).toBe('function');
    expect(typeof deps.createNewDocument).toBe('function');
    expect(typeof deps.addMessages).toBe('function');

    const embed = {
      id: 'app.textox.test.embed',
      extensions: ['.demo'],
      insertLabelKey: 'embed',
      matches: () => true,
      createPreview: () => ({ render: () => {} }),
    };
    const fileEditor = {
      id: 'app.textox.test.editor',
      extensions: ['.demo'],
      newFile: 'newDemo',
      createEmptyContent: () => '',
      load: async () => ({ default: {} }),
    };

    const embedDisposable = deps.registerEmbed(embed, 'app.textox.test');
    deps.registerFileEditor(fileEditor, 'app.textox.test');
    await deps.createNewDocument({ content: 'x', extension: 'demo' });
    deps.addMessages({ 'zh-CN': { hello: '你好' } }, 'zh-CN', 'app.textox.test');

    expect(embedDisposable.dispose).toBeTypeOf('function');
    // 嵌入走单一分发扩展（owner 固定为 plugin-runtime），插件只写实时表
    expect(registerContributionsMock).toHaveBeenCalledWith('plugin-runtime', {
      'markdown-editor:extension': [expect.objectContaining({ id: 'runtime.embeds' })],
    });
    expect(registerContributionsMock).toHaveBeenCalledWith('app.textox.test', {
      'app:fileEditor': [expect.objectContaining({ id: 'app.textox.test.editor' })],
    });
    expect(deps.getActiveFilePath()).toBe('/notes/a.md');
    expect(deps.canEdit()).toBe(true);
  });

  it('reads the installed host deps lazily, not at construction time', async () => {
    // 先清 memoize，再让全局 mock 返回 null（不用 mockReturnValueOnce：构建期并不读取）
    resetHostDepsForTests();
    getInstalledHostDepsMock.mockReturnValue(null);
    const deps = await createHostDeps();
    // 构造时还没有 host deps
    expect(deps.getActiveFilePath()).toBeNull();

    const openFile = vi.fn(async () => {});
    const late = makeHostDeps('/late/file.md');
    late.openFile = openFile;
    getInstalledHostDepsMock.mockReturnValue(late);

    expect(deps.getActiveFilePath()).toBe('/late/file.md');
    expect(deps.getDocumentDir()).toBe('/late');
    expect(deps.canEdit()).toBe(true);
    await deps.openFile('/late/file.md');
    expect(openFile).toHaveBeenCalledWith('/late/file.md');
  });
});

describe('createHostDeps bridges', () => {
  // 每个用例用全新的桥实例（含独立的实时表与分发扩展），避免 memoize 跨用例串台
  beforeEach(() => {
    resetHostDepsForTests();
  });

  type FakeNode = { textContent: string; attrs: Record<string, unknown>; type: { name: string } };
  type FakeRegion = {
    render: (target: HTMLElement) => void;
    update?: (node: unknown) => void;
    destroy?: () => void;
  };
  type DispatcherNodeView = (
    node: FakeNode,
    view?: unknown,
    getPos?: unknown,
    decorations?: unknown,
  ) => unknown;

  /** 节点文本必须是合法的嵌入引用语法（分发扩展用宿主的 parseEmbedRef 解析）。 */
  function node(src: string): FakeNode {
    return { textContent: `![alt](${src})`, attrs: {}, type: { name: 'image_ref' } };
  }

  /** 取最后一次注册的编辑器扩展里的 `image_ref` 分发 nodeView（读实时 Map）。 */
  function dispatcherNodeView(): { nodeView: DispatcherNodeView; embed: ReturnType<typeof vi.fn> } {
    // 分发扩展在 memoize 的实例里只注册一次，因此要跨全部调用查找（不能只看最后一次）
    const calls = registerContributionsMock.mock.calls;
    let contribution:
      | {
          create: (ctx: unknown) => { nodeViews: { image_ref: DispatcherNodeView } };
        }
      | undefined;
    for (let index = calls.length - 1; index >= 0; index -= 1) {
      const contributes = calls[index]?.[1] as
        | { 'markdown-editor:extension'?: Array<{ id: string }> }
        | undefined;
      const candidate = contributes?.['markdown-editor:extension']?.[0];
      if (candidate?.id === 'runtime.embeds') {
        contribution = candidate as unknown as typeof contribution;
        break;
      }
    }
    if (!contribution) throw new Error('embed dispatcher was not registered');
    const embed = vi.fn((args: { preview: unknown }) => args.preview);
    const result = contribution.create({ views: { embed } });
    return { nodeView: result.nodeViews.image_ref, embed };
  }

  function embedOptions(
    overrides: Partial<{
      id: string;
      matches: (src: string) => boolean;
      createPreview: (node: EmbedNodeLike) => FakeRegion;
    }> = {},
  ) {
    return {
      id: overrides.id ?? 'app.textox.test.embed',
      extensions: ['.demo'],
      insertLabelKey: 'embed',
      matches: overrides.matches ?? ((src: string) => src.endsWith('.demo')),
      createPreview: overrides.createPreview ?? (() => ({ render: () => {} })),
    };
  }

  it('dispatches matching srcs to the registered plugin preview', async () => {
    const deps = await createHostDeps();
    const createPreview = vi.fn((): FakeRegion => ({ render: () => {} }));
    deps.registerEmbed(embedOptions({ createPreview }), 'app.textox.test');

    const { nodeView, embed } = dispatcherNodeView();
    expect(nodeView(node('a.demo'))).not.toBeNull();
    expect(embed).toHaveBeenCalledTimes(1);
    expect(createPreview).toHaveBeenCalledTimes(1);
    // 不匹配的 src 交还给编辑器（继续尝试后面的 nodeView / 内置视图）
    expect(nodeView(node('a.png'))).toBeNull();
  });

  it('stops dispatching as soon as the disposable is disposed', async () => {
    const deps = await createHostDeps();
    const disposable = deps.registerEmbed(embedOptions(), 'app.textox.test');
    const { nodeView, embed } = dispatcherNodeView();
    expect(nodeView(node('a.demo'))).not.toBeNull();

    disposable.dispose();

    expect(nodeView(node('a.demo'))).toBeNull();
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('uses registration order when several plugins match the same src', async () => {
    const deps = await createHostDeps();
    const first = vi.fn((): FakeRegion => ({ render: () => {} }));
    const second = vi.fn((): FakeRegion => ({ render: () => {} }));
    deps.registerEmbed(embedOptions({ id: 'app.textox.test.embed-first', createPreview: first }), 'app.textox.test');
    deps.registerEmbed(embedOptions({ id: 'app.textox.test.embed-second', createPreview: second }), 'app.textox.test');

    const { nodeView } = dispatcherNodeView();
    nodeView(node('a.demo'));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('forwards preview updates to the plugin region', async () => {
    const deps = await createHostDeps();
    const updated: unknown[] = [];
    deps.registerEmbed(
      embedOptions({
        createPreview: () => ({ render: () => {}, update: (next) => updated.push(next) }),
      }),
      'app.textox.test',
    );

    const { nodeView, embed } = dispatcherNodeView();
    nodeView(node('one.demo'));
    const preview = (embed.mock.calls[0]?.[0] as { preview: { update: (n: FakeNode) => void } })
      .preview;
    preview.update(node('two.demo'));

    expect(updated).toEqual([{ textContent: '![alt](two.demo)', attrs: {}, type: 'image_ref' }]);
  });

  it('recreates the preview when the plugin region has no update', async () => {
    const deps = await createHostDeps();
    const destroy = vi.fn();
    const createPreview = vi.fn((): FakeRegion => ({ render: () => {}, destroy }));
    deps.registerEmbed(embedOptions({ createPreview }), 'app.textox.test');

    const { nodeView, embed } = dispatcherNodeView();
    nodeView(node('one.demo'));
    const preview = (embed.mock.calls[0]?.[0] as { preview: { update: (n: FakeNode) => void } })
      .preview;
    preview.update(node('two.demo'));

    expect(createPreview).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('passes file editor capabilities and createEmptyContent path through', async () => {
    const deps = await createHostDeps();
    const capabilities = { customSave: true, exportable: false };
    deps.registerFileEditor(
      {
        id: 'app.textox.test.editor-passthrough',
        extensions: ['.demo'],
        newFile: 'newDemo',
        createEmptyContent: (path?: string) => path ?? '',
        load: async () => ({ default: {} }),
        capabilities,
      },
      'app.textox.test',
    );
    const calls = registerContributionsMock.mock.calls;
    const contributions = calls[calls.length - 1]?.[1] as {
      'app:fileEditor': Array<{
        capabilities?: unknown;
        createEmptyContent: (p?: string) => string;
      }>;
    };
    expect(contributions['app:fileEditor'][0].capabilities).toEqual(capabilities);
    expect(contributions['app:fileEditor'][0].createEmptyContent('/x.demo')).toBe('/x.demo');
  });

  it('passes the whole locales map and default locale to the i18n bridge', async () => {
    const deps = await createHostDeps();
    const locales = { en: { hi: 'Hello' }, 'zh-CN': { hi: '你好' } };
    registerPluginMessagesMock.mockClear();

    deps.addMessages(locales, 'en', 'app.textox.test');

    expect(registerPluginMessagesMock).toHaveBeenCalledWith('app.textox.test', locales, 'en');
  });

  it('parses embed references through the host implementation', async () => {
    const deps = await createHostDeps();

    expect(deps.parseEmbedRef('![a](b.md "t")')).toStrictEqual({
      src: 'b.md',
      alt: 'a',
      title: 't',
    });
    expect(deps.parseEmbedRef('![a](b.md)')).toStrictEqual({ src: 'b.md', alt: 'a' });
    expect('title' in (deps.parseEmbedRef('![a](b.md)') ?? {})).toBe(false);
    expect(deps.parseEmbedRef('plain text')).toBeNull();
  });

  it('memoizes the host deps so extensions are not registered twice', async () => {
    const first = await createHostDeps();
    const second = await createHostDeps();

    expect(second).toBe(first);
  });

  it('registers editor contributions reversibly through unregisterContribution', async () => {
    const deps = await createHostDeps();
    registerContributionsMock.mockClear();
    unregisterContributionMock.mockClear();

    const feature = { name: 'demo' };
    const featureSub = deps.registerSyntaxFeature(feature, 'app.textox.test');
    expect(registerContributionsMock).toHaveBeenCalledWith('app.textox.test', {
      'markdown-editor:syntaxFeature': [feature],
    });

    featureSub.dispose();
    expect(unregisterContributionMock).toHaveBeenCalledWith(
      'markdown-editor:syntaxFeature',
      'app.textox.test',
      'demo',
    );
  });

  it('synthesizes an id for keyless contributions so dispose can unregister them', async () => {
    const deps = await createHostDeps();
    registerContributionsMock.mockClear();
    unregisterContributionMock.mockClear();

    // 语法高亮贡献体没有 id / name：不补 id 时 dispose 无法定位（旧实现是空操作）
    const sub = deps.registerSyntaxHighlight(
      { languages: [{ id: 'demo' }] },
      'app.textox.test',
    );
    const [, contributes] = registerContributionsMock.mock.calls[0] as [
      string,
      Record<string, unknown[]>,
    ];
    const registered = (
      contributes['markdown-editor:syntaxHighlight'] as Array<{
        id: string;
        languages: unknown[];
      }>
    )[0]!;
    expect(registered.languages).toEqual([{ id: 'demo' }]);
    expect(registered.id).toContain('app.textox.test');

    sub.dispose();
    expect(unregisterContributionMock).toHaveBeenCalledWith(
      'markdown-editor:syntaxHighlight',
      'app.textox.test',
      registered.id,
    );
  });

  it('registers insert commands as editor extension contributions, not app commands', async () => {
    const deps = await createHostDeps();
    registerContributionsMock.mockClear();
    unregisterContributionMock.mockClear();

    const command = {
      id: 'demo.insert',
      keyword: 'demo',
      labelKey: 'demo.insert.label',
      icon: 'table',
      insert: () => {},
    };
    const sub = deps.registerInsertCommand(command, 'app.textox.test');
    const [ownerId, contributes] = registerContributionsMock.mock.calls[0] as [
      string,
      Record<string, unknown[]>,
    ];
    // insert 命令只进编辑器扩展点（app:command 需要 titleKey + run，形状对不上）
    expect(ownerId).toBe('app.textox.test');
    expect(Object.keys(contributes)).toEqual(['markdown-editor:extension']);
    expect(contributes['app:command']).toBeUndefined();
    const extension = (contributes['markdown-editor:extension'] as Array<Record<string, unknown>>)[0]!;
    // 贡献 id 带 owner：两个插件同 slug 时不会互相覆盖
    // labelKey 由桥补插件 id 前缀（编辑器的消费方直接 i18next.t，不走插件命名空间）
    expect(extension).toMatchObject({
      id: 'runtime.insert.app.textox.test.demo.insert',
      insert: { ...command, labelKey: 'app.textox.test.demo.insert.label' },
    });

    sub.dispose();
    expect(unregisterContributionMock).toHaveBeenCalledWith(
      'markdown-editor:extension',
      'app.textox.test',
      'runtime.insert.app.textox.test.demo.insert',
    );
  });
});

describe('createHostDeps memoization', () => {
  it('retries the build after a failed first attempt', async () => {
    setHostDepsBuilderForTests(async () => {
      throw new Error('host deps boom');
    });
    try {
      await expect(createHostDeps()).rejects.toThrow('host deps boom');
    } finally {
      setHostDepsBuilderForTests(null);
    }

    // 失败不应被永久缓存：恢复 builder 后能正常重建
    await expect(createHostDeps()).resolves.toMatchObject({
      getActiveFilePath: expect.any(Function),
    });
  });

  it('rebuilds after resetHostDepsForTests', async () => {
    const first = await createHostDeps();
    resetHostDepsForTests();
    const second = await createHostDeps();

    expect(second).not.toBe(first);
  });
});

describe('createHostDeps duplicate ids', () => {
  it('warns when the same embed id is registered twice', async () => {
    const deps = await createHostDeps();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const options = {
        id: 'app.textox.test.dup-embed',
        extensions: ['.demo'],
        insertLabelKey: 'embed',
        matches: () => true,
        createPreview: () => ({ render: () => {} }),
      };
      deps.registerEmbed(options, 'app.textox.test');
      deps.registerEmbed(options, 'app.textox.test');

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('duplicate embed id app.textox.test.dup-embed'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('warns when the same file editor id is registered twice', async () => {
    const deps = await createHostDeps();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const options = {
        id: 'app.textox.test.dup-editor',
        extensions: ['.demo'],
        newFile: 'newDemo',
        createEmptyContent: () => '',
        load: async () => ({ default: {} }),
      };
      deps.registerFileEditor(options, 'app.textox.test');
      deps.registerFileEditor(options, 'app.textox.test');

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('duplicate file editor id app.textox.test.dup-editor'),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe('createHostDeps preload context', () => {
  it('maps isSingleFileMode to singleFileMode and keeps currentFile', async () => {
    const deps = await createHostDeps();
    const preloadMock = vi.fn(async () => {});
    deps.registerFileEditor(
      {
        id: 'app.textox.test.preload-editor',
        extensions: ['.demo'],
        newFile: 'newDemo',
        createEmptyContent: () => '',
        load: async () => ({ default: {} }),
        preload: preloadMock,
      },
      'app.textox.test',
    );

    const calls = registerContributionsMock.mock.calls;
    const contribution = (
      calls[calls.length - 1]?.[1] as {
        'app:fileEditor': Array<{
          preload?: (ctx: { isSingleFileMode: boolean; currentFile: string | null }) => void;
        }>;
      }
    )['app:fileEditor'][0];

    await contribution.preload?.({ isSingleFileMode: true, currentFile: '/a/b.excalidraw' });

    expect(preloadMock).toHaveBeenCalledWith({
      singleFileMode: true,
      currentFile: '/a/b.excalidraw',
    });
  });
});

describe('refreshPlugins / install / uninstall', () => {
  it('refreshes the snapshot from scan + getState', async () => {
    vi.mocked(pluginIpc.scan).mockResolvedValue([entry()]);
    vi.mocked(pluginIpc.getState).mockResolvedValue({ safe_mode: true, enabled: [ID] });

    await refreshPlugins();

    expect(pluginIpc.scan).toHaveBeenCalled();
    expect(pluginIpc.getState).toHaveBeenCalled();
    expect(pluginState.list().map((item) => item.id)).toEqual([ID]);
    expect(pluginState.isSafeMode()).toBe(true);
  });

  it('installs from a file and refreshes the list', async () => {
    vi.mocked(pluginIpc.installFromFile).mockResolvedValue([entry()]);
    vi.mocked(pluginIpc.scan).mockResolvedValue([entry()]);
    vi.mocked(pluginIpc.getState).mockResolvedValue({ safe_mode: false, enabled: [] });

    const installed = await installPluginFromFile('/tmp/a.zip');

    expect(pluginIpc.installFromFile).toHaveBeenCalledWith('/tmp/a.zip');
    expect(pluginIpc.scan).toHaveBeenCalled();
    expect(installed).toEqual([entry()]);
    expect(pluginState.list().map((item) => item.id)).toEqual([ID]);
  });

  it('stops a running plugin before uninstalling', async () => {
    const order: string[] = [];
    vi.mocked(pluginIpc.scan).mockResolvedValue([]);
    vi.mocked(pluginIpc.getState).mockResolvedValue({ safe_mode: false, enabled: [] });
    await initPluginRuntime(deps(), { importModule: async () => ({ default: FakePlugin }) });
    pluginState.setSnapshot([entry()], { safe_mode: false, enabled: [ID] });
    await enablePlugin(entry());
    expect(pluginRegistry.count('command')).toBe(1);

    vi.mocked(pluginIpc.uninstall).mockImplementation(async () => {
      order.push(`uninstall:${pluginRegistry.count('command')}`);
      return [];
    });

    await uninstallPlugin(ID);

    expect(order).toEqual(['uninstall:0']);
    expect(pluginIpc.uninstall).toHaveBeenCalledWith(ID);
    expect(pluginRegistry.count('command')).toBe(0);
    expect(isPluginRunning(ID)).toBe(false);
  });
});

describe('installPluginFromFile replaces running plugins', () => {
  it('stops plugins that were running before the install', async () => {
    const unloaded: string[] = [];
    class TrackedPlugin extends Plugin {
      onload(): void {
        this.addCommand({ id: `${ID}.say`, name: 'Say', callback: () => {} });
      }
      override onunload(): void {
        unloaded.push(this.manifest.id);
      }
    }

    vi.mocked(pluginIpc.scan).mockResolvedValue([]);
    vi.mocked(pluginIpc.getState).mockResolvedValue({ safe_mode: false, enabled: [] });
    await initPluginRuntime(deps(), { importModule: async () => ({ default: TrackedPlugin }) });
    pluginState.setSnapshot([entry()], { safe_mode: false, enabled: [] });
    await enablePlugin(entry());
    expect(isPluginRunning(ID)).toBe(true);

    vi.mocked(pluginIpc.installFromFile).mockResolvedValue([entry()]);
    vi.mocked(pluginIpc.scan).mockResolvedValue([entry()]);

    await installPluginFromFile('/tmp/a.zip');

    expect(unloaded).toEqual([ID]);
    expect(isPluginRunning(ID)).toBe(false);
    expect(pluginRegistry.count('command')).toBe(0);
  });
});
