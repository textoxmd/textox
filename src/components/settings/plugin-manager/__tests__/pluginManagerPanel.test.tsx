import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PluginManifest } from '@textox/plugin-sdk';

const { setEnabledMock, installFromFileMock, dialogOpenMock, restoreBuiltinMock } = vi.hoisted(
  () => ({
    setEnabledMock: vi.fn(async (_id?: string, _enabled?: boolean) => ({
      safe_mode: false,
      enabled: [] as string[],
    })),
    installFromFileMock: vi.fn(async () => [] as unknown[]),
    dialogOpenMock: vi.fn(async () => null as string | string[] | null),
    restoreBuiltinMock: vi.fn(async (_id: string) => [] as string[]),
  }),
);

/** `plugin:data-changed` 的订阅者：模拟 Rust 广播，验证详情页会重读。 */
const { dataChangedHandlers } = vi.hoisted(() => ({
  dataChangedHandlers: [] as Array<(pluginId: string) => void>,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// 与生产 i18next 对齐：第二参传字符串即缺省文案，传对象时取 defaultValue 并做插值，
// 这样断言的是真实中文文案（而不是裸 key）。
vi.mock('@/i18n', () => {
  const interpolate = (template: string, values?: Record<string, unknown>): string =>
    template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values?.[key] ?? ''));
  return {
    default: {
      t: (key: string, options?: string | Record<string, unknown>): string => {
        if (typeof options === 'string') return options;
        const template = typeof options?.defaultValue === 'string' ? options.defaultValue : key;
        return interpolate(template, options);
      },
      getFixedT: () => (key: string, defaultValue?: string) => defaultValue ?? key,
    },
  };
});
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: dialogOpenMock }));
vi.mock('@/plugins/runtime/ipc', () => ({
  pluginIpc: {
    seedBundled: vi.fn(async () => [] as string[]),
    scan: vi.fn(async () => []),
    getState: vi.fn(async () => ({ safe_mode: false, enabled: [] })),
    setEnabled: setEnabledMock,
    installFromFile: installFromFileMock,
    uninstall: vi.fn(async () => []),
    setSafeMode: vi.fn(async (safeMode: boolean) => ({ safe_mode: safeMode, enabled: [] })),
    readData: vi.fn(async () => ({ settings: {}, plugin: {} })),
    writeData: vi.fn(async () => {}),
    restoreBuiltin: restoreBuiltinMock,
    readAsset: vi.fn(async (id: string, path: string) => {
      if (path === 'styles.css') return btoa(`[data-plugin='${id}'] { color: red; }`);
      throw new Error(`unexpected asset: ${path}`);
    }),
  },
  subscribePluginDataChanged: (handler: (pluginId: string) => void) => {
    dataChangedHandlers.push(handler);
    return () => {
      const index = dataChangedHandlers.indexOf(handler);
      if (index >= 0) dataChangedHandlers.splice(index, 1);
    };
  },
}));

import { Plugin } from '@textox/plugin-sdk';

import { toast } from 'sonner';

import { PluginManagerPanel } from '../PluginManagerPanel';
import type { PluginHostDeps } from '@/plugins/runtime/app';
import {
  initPluginRuntime,
  isPluginRunning,
  pluginRegistry,
  pluginState,
  resetPluginRuntimeForTests,
} from '@/plugins/runtime/index';
import { pluginIpc, type InstalledPluginDto } from '@/plugins/runtime/ipc';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom 没实现 Pointer Capture：radix Select 在 pointerdown / pointerup 时会调用它们，
// 不补这几个空实现就无法在测试里真正选中预设项。
(Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture ??= () =>
  false;
(Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture ??= () => {};
(Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture ??=
  () => {};

const ID = 'app.textox.hello-world';
const LOCAL_ID = 'io.github.acme.local';

const manifest: PluginManifest = {
  id: ID,
  name: 'Hello World',
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
    registerEmbed: () => ({ dispose: () => {} }),
    registerFileEditor: () => ({ dispose: () => {} }),
    registerSyntaxFeature: () => ({ dispose: () => {} }),
    registerExtension: () => ({ dispose: () => {} }),
    registerFormatToolbarItem: () => ({ dispose: () => {} }),
    registerContextMenuItem: () => ({ dispose: () => {} }),
    registerSelectionAction: () => ({ dispose: () => {} }),
    registerSyntaxHighlight: () => ({ dispose: () => {} }),
    registerInsertCommand: () => ({ dispose: () => {} }),
    registerExporter: () => ({ dispose: () => {} }),
    registerImageUploader: () => ({ dispose: () => {} }),
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
    requestReload: () => {},
    createNewDocument: async () => {},
    addMessages: () => {},
    parseEmbedRef: () => null,
  };
}

function entry(overrides: Partial<InstalledPluginDto> = {}): InstalledPluginDto {
  const id = overrides.id ?? ID;
  return {
    id,
    dir: `/plugins/${id}`,
    manifest: overrides.manifest ?? { ...manifest, id },
    enabled: false,
    error: null,
    ...overrides,
  };
}

class HelloPlugin extends Plugin {
  onload(): void {
    this.addCommand({ id: `${ID}.say`, name: 'Say hello', callback: () => {} });
  }
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<PluginManagerPanel />);
  });
  return container;
}

function text(): string {
  return container?.textContent ?? '';
}

function rows(): HTMLElement[] {
  return [...(container?.querySelectorAll('[data-slot="plugin-list-row"]') ?? [])] as HTMLElement[];
}

function rowById(id: string): HTMLElement {
  const row = container?.querySelector(`[data-slot="plugin-list-row"][data-plugin-id="${id}"]`);
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

function toggleIn(scope: Element): HTMLElement {
  const toggle = scope.querySelector('[data-slot="plugin-toggle"]');
  expect(toggle).not.toBeNull();
  return toggle as HTMLElement;
}

function checkboxIn(scope: Element): HTMLElement {
  const checkbox = scope.querySelector('[data-slot="checkbox"]');
  expect(checkbox).not.toBeNull();
  return checkbox as HTMLElement;
}

function detail(): HTMLElement | null {
  return container?.querySelector('[data-slot="plugin-detail-view"]') ?? null;
}

function listView(): HTMLElement | null {
  return container?.querySelector('[data-slot="plugin-list-view"]') ?? null;
}

/** 打开某个插件的详情页（点行主体）。 */
async function openRow(id: string): Promise<void> {
  const row = rowById(id);
  await act(async () => {
    row.click();
  });
  expect(detail()).not.toBeNull();
}

/** 点详情页顶部的返回按钮。 */
async function goBack(): Promise<void> {
  const back = detail()?.querySelector('[data-slot="plugin-detail-back"]') as
    | HTMLButtonElement
    | undefined;
  expect(back).not.toBeUndefined();
  await act(async () => {
    back!.click();
  });
}

async function clickButton(scope: ParentNode, label: string): Promise<void> {
  const button = [...scope.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  ) as HTMLButtonElement | undefined;
  expect(button, `button "${label}"`).not.toBeUndefined();
  await act(async () => {
    button!.click();
  });
}

function storedState(seeded: Record<string, { version: string; origin: 'seed' | 'user' }>) {
  return { safe_mode: false, enabled: [] as string[], seeded, uninstalled: [] as string[] };
}

/** 点开关：radix Checkbox 是 `button[role=checkbox]`，`click()` 会走 onCheckedChange。 */
async function clickCheckbox(checkbox: HTMLElement): Promise<void> {
  await act(async () => {
    checkbox.click();
  });
}

beforeEach(async () => {
  vi.mocked(pluginIpc.setEnabled).mockReset();
  vi.mocked(pluginIpc.setEnabled).mockResolvedValue({ safe_mode: false, enabled: [] });
  vi.mocked(pluginIpc.installFromFile).mockReset();
  vi.mocked(pluginIpc.installFromFile).mockResolvedValue([]);
  dialogOpenMock.mockReset();
  dialogOpenMock.mockResolvedValue(null);
  restoreBuiltinMock.mockReset();
  restoreBuiltinMock.mockResolvedValue([]);
  vi.mocked(pluginIpc.uninstall).mockReset();
  vi.mocked(pluginIpc.uninstall).mockResolvedValue([]);
  vi.mocked(pluginIpc.scan).mockReset();
  vi.mocked(pluginIpc.scan).mockResolvedValue([]);
  vi.mocked(pluginIpc.getState).mockReset();
  vi.mocked(pluginIpc.getState).mockResolvedValue({ safe_mode: false, enabled: [] });
  vi.mocked(pluginIpc.setSafeMode).mockReset();
  vi.mocked(pluginIpc.setSafeMode).mockImplementation(async (safeMode: boolean) => ({
    safe_mode: safeMode,
    enabled: [],
  }));
  vi.mocked(pluginIpc.readData).mockReset();
  vi.mocked(pluginIpc.readData).mockResolvedValue({ settings: {}, plugin: {} });
  vi.mocked(pluginIpc.writeData).mockReset();
  vi.mocked(pluginIpc.writeData).mockResolvedValue(undefined);
  dataChangedHandlers.length = 0;
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
  // 上一个用例可能留下运行实例 / 快照：统一回到「未初始化」的初始态，用例各自 setSnapshot / init
  await resetPluginRuntimeForTests();
  pluginRegistry.disposeOwner(ID);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  for (const element of document.querySelectorAll('style[data-plugin]')) element.remove();
});

describe('PluginManagerPanel 列表态', () => {
  it('shows a loading hint until the first snapshot arrives', async () => {
    // 启动期还没拿到第一次快照：`initialized` 为 false（快照一到就换成列表）
    pluginState.resetForTests();
    await render();

    expect(container!.querySelector('[data-slot="plugin-runtime-loading"]')).not.toBeNull();
    expect(text()).toContain('插件运行时加载中');
  });

  it('shows the import entry even when no plugins are installed', async () => {
    pluginState.setSnapshot([], { safe_mode: false, enabled: [] });

    await render();

    expect(text()).toContain('尚未安装任何插件');
    expect(text()).toContain('导入插件');
    expect(rows()).toHaveLength(0);
  });

  it('lists installed plugins with name, version/author and origin, without leaking the raw id', async () => {
    pluginState.setSnapshot([entry()], { safe_mode: false, enabled: [] });

    await render();

    expect(text()).toContain('Hello World');
    expect(text()).toContain('v1.0.0 · Textox');
    expect(text()).toContain('本地');
    expect(text()).toContain('已启用 0 / 1');
    // 列表行精简后不再展示 id（旧面板的 `id · vX · 状态` 元信息移到详情页技术信息）
    expect(text()).not.toContain(ID);

    await openRow(ID);

    // 详情页不再展示 id：列表行以名称/版本/来源为主，id 只作为 DOM 属性存在
    expect(text()).not.toContain(ID);
  });

  it('imports a plugin selected in the file dialog', async () => {
    vi.mocked(pluginIpc.scan).mockResolvedValue([]);
    pluginState.setSnapshot([], { safe_mode: false, enabled: [] });
    vi.mocked(pluginIpc.installFromFile).mockResolvedValueOnce([entry()]);
    dialogOpenMock.mockResolvedValueOnce('/tmp/x.zip');
    await render();

    await clickButton(container!, '导入插件');

    expect(dialogOpenMock).toHaveBeenCalled();
    expect(pluginIpc.installFromFile).toHaveBeenCalledWith('/tmp/x.zip');
    expect(pluginIpc.scan).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('已导入插件');
  });

  it('shows an error toast when the import fails', async () => {
    pluginState.setSnapshot([], { safe_mode: false, enabled: [] });
    vi.mocked(pluginIpc.installFromFile).mockRejectedValueOnce(new Error('boom'));
    dialogOpenMock.mockResolvedValueOnce('/tmp/x.zip');
    await render();

    await clickButton(container!, '导入插件');

    expect(toast.error).toHaveBeenCalledWith('boom');
  });

  it('does not import when the dialog is cancelled', async () => {
    pluginState.setSnapshot([], { safe_mode: false, enabled: [] });
    dialogOpenMock.mockResolvedValueOnce(null);
    await render();

    await clickButton(container!, '导入插件');

    expect(pluginIpc.installFromFile).not.toHaveBeenCalled();
  });
});

describe('PluginManagerPanel 启停', () => {
  it('enables a plugin through the row checkbox (which carries a readable label)', async () => {
    vi.mocked(pluginIpc.scan).mockResolvedValue([entry()]);
    await initPluginRuntime(deps(), { importModule: async () => ({ default: HelloPlugin }) });
    await render();

    const toggle = toggleIn(rowById(ID));
    expect(toggle.getAttribute('aria-label')).toBe('启用 Hello World');
    await clickCheckbox(toggle);

    expect(pluginIpc.setEnabled).toHaveBeenCalledWith(ID, true);
    expect(pluginRegistry.count('command')).toBe(1);
    expect(isPluginRunning(ID)).toBe(true);
  });

  it('disables a plugin and clears its contributions', async () => {
    vi.mocked(pluginIpc.scan).mockResolvedValue([entry({ enabled: true })]);
    vi.mocked(pluginIpc.getState).mockResolvedValue({ safe_mode: false, enabled: [ID] });
    await initPluginRuntime(deps(), { importModule: async () => ({ default: HelloPlugin }) });
    expect(pluginRegistry.count('command')).toBe(1);
    await render();

    await clickCheckbox(toggleIn(rowById(ID)));

    expect(pluginIpc.setEnabled).toHaveBeenCalledWith(ID, false);
    expect(pluginRegistry.count('command')).toBe(0);
    expect(isPluginRunning(ID)).toBe(false);
    expect(document.head.querySelector(`style[data-plugin="${ID}"]`)).toBeNull();
  });

  it('lets a load-failed but persisted-enabled plugin be turned off', async () => {
    pluginState.setSnapshot([entry({ enabled: true })], { safe_mode: false, enabled: [ID] });
    pluginState.markFailed(ID, 'onload timed out');
    await render();

    const toggle = toggleIn(rowById(ID));
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    await clickCheckbox(toggle);

    expect(pluginIpc.setEnabled).toHaveBeenCalledWith(ID, false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(pluginState.list().find((item) => item.id === ID)?.enabled).toBe(false);
  });

  it('disables the checkbox while a request is pending', async () => {
    await initPluginRuntime(deps(), { importModule: async () => ({ default: HelloPlugin }) });
    pluginState.setSnapshot([entry()], { safe_mode: false, enabled: [] });

    let resolveSetEnabled: ((value: { safe_mode: boolean; enabled: string[] }) => void) | null =
      null;
    vi.mocked(pluginIpc.setEnabled).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSetEnabled = resolve;
        }),
    );
    await render();
    const toggle = toggleIn(rowById(ID));

    await clickCheckbox(toggle);
    expect((toggle as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveSetEnabled?.({ safe_mode: false, enabled: [ID] });
    });
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the load-failed badge in the list and the failure message in the detail page', async () => {
    pluginState.setSnapshot([entry({ enabled: true })], { safe_mode: false, enabled: [ID] });
    pluginState.markFailed(ID, 'onload timed out');
    await render();

    const badge = rowById(ID).querySelector('[data-slot="plugin-load-failed-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('加载失败');
    expect(rowById(ID).textContent).not.toContain('onload timed out');
    // 加载失败不影响勾选态：持久化已启用必须显示为开，否则关不掉
    expect(toggleIn(rowById(ID)).getAttribute('aria-checked')).toBe('true');

    await openRow(ID);

    const error = detail()!.querySelector('[data-slot="plugin-detail-error"]');
    expect(error).not.toBeNull();
    expect(error!.textContent).toContain('onload timed out');
  });
});

describe('PluginManagerPanel 安全模式', () => {
  it('locks third-party checkboxes while safe mode is on', async () => {
    const THIRD = 'io.github.acme.test';
    vi.mocked(pluginIpc.scan).mockResolvedValue([
      entry(),
      entry({ id: THIRD, manifest: { ...manifest, id: THIRD, name: 'Third party' } }),
    ]);
    vi.mocked(pluginIpc.getState).mockResolvedValue({ safe_mode: true, enabled: [] });
    await initPluginRuntime(deps(), { importModule: async () => ({ default: HelloPlugin }) });
    await render();

    const banner = container!.querySelector('[data-slot="plugin-safe-mode-banner"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('安全模式已开启');

    const thirdParty = toggleIn(rowById(THIRD)) as HTMLButtonElement;
    expect(thirdParty.disabled).toBe(true);
    expect(thirdParty.getAttribute('title')).toContain('第三方插件无法启用');
    expect((toggleIn(rowById(ID)) as HTMLButtonElement).disabled).toBe(false);
  });

  it('asks for confirmation before leaving safe mode, then persists and refreshes', async () => {
    pluginState.setSnapshot([], { safe_mode: true, enabled: [] });
    vi.mocked(pluginIpc.getState).mockResolvedValue({ safe_mode: true, enabled: [] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await render();
    vi.mocked(pluginIpc.scan).mockClear();

    try {
      expect(container!.querySelector('[data-slot="plugin-safe-mode-banner"]')).not.toBeNull();
      await clickButton(container!, '关闭安全模式');

      expect(confirm).toHaveBeenCalledWith(
        '关闭安全模式？关闭后第三方插件可以运行任意代码，请只安装你信任的插件。',
      );
      expect(pluginIpc.setSafeMode).toHaveBeenCalledWith(false);
      expect(pluginIpc.scan).toHaveBeenCalled();
      // 返回状态落进本地 state ⇒ 横幅消失，列表回到常规态
      expect(container!.querySelector('[data-slot="plugin-safe-mode-banner"]')).toBeNull();
    } finally {
      confirm.mockRestore();
    }
  });

  it('does not leave safe mode when the confirmation is cancelled', async () => {
    pluginState.setSnapshot([], { safe_mode: true, enabled: [] });
    vi.mocked(pluginIpc.getState).mockResolvedValue({ safe_mode: true, enabled: [] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await render();

    try {
      await clickButton(container!, '关闭安全模式');

      expect(confirm).toHaveBeenCalled();
      expect(pluginIpc.setSafeMode).not.toHaveBeenCalled();
      expect(container!.querySelector('[data-slot="plugin-safe-mode-banner"]')).not.toBeNull();
    } finally {
      confirm.mockRestore();
    }
  });

  it('still allows turning off a third-party plugin already enabled in safe mode', async () => {
    const THIRD = 'io.github.acme.test';
    vi.mocked(pluginIpc.scan).mockResolvedValue([
      entry({
        id: THIRD,
        enabled: true,
        manifest: { ...manifest, id: THIRD, name: 'Third party' },
      }),
    ]);
    vi.mocked(pluginIpc.getState).mockResolvedValue({ safe_mode: true, enabled: [THIRD] });
    await initPluginRuntime(deps(), { importModule: async () => ({ default: HelloPlugin }) });
    await render();

    const toggle = toggleIn(rowById(THIRD)) as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    await clickCheckbox(toggle);
    expect(pluginIpc.setEnabled).toHaveBeenCalledWith(THIRD, false);
  });
});

describe('PluginManagerPanel 导航', () => {
  it('opens the detail page on row click, goes back, and does not navigate from the checkbox', async () => {
    await initPluginRuntime(deps(), { importModule: async () => ({ default: HelloPlugin }) });
    pluginState.setSnapshot([entry()], { safe_mode: false, enabled: [] });
    await render();

    await openRow(ID);
    expect(listView()).toBeNull();
    expect(detail()!.textContent).toContain('Hello World');

    await goBack();
    expect(listView()).not.toBeNull();
    expect(detail()).toBeNull();

    await openRow(ID);
    await clickCheckbox(checkboxIn(detail()!));

    // 点开关只切启用，不弹回列表
    expect(pluginIpc.setEnabled).toHaveBeenCalledWith(ID, true);
    expect(detail()).not.toBeNull();
    expect(listView()).toBeNull();
  });

  it('returns to the list when the selected plugin disappears from the snapshot', async () => {
    pluginState.setSnapshot([entry()], { safe_mode: false, enabled: [] });
    await render();
    await openRow(ID);

    // 其它窗口卸载 / 本窗口重扫：选中项从快照里消失
    await act(async () => {
      pluginState.setSnapshot([], { safe_mode: false, enabled: [] });
    });

    expect(listView()).not.toBeNull();
    expect(detail()).toBeNull();
  });
});

describe('PluginManagerPanel 搜索与筛选', () => {
  it('drives the list through the search box and the origin chips', async () => {
    vi.mocked(pluginIpc.getState).mockResolvedValue(
      storedState({ [ID]: { version: '1.0.0', origin: 'seed' } }),
    );
    pluginState.setSnapshot(
      [
        entry(),
        entry({ id: LOCAL_ID, manifest: { ...manifest, id: LOCAL_ID, name: 'Local thing' } }),
      ],
      { safe_mode: false, enabled: [] },
    );
    await render();

    expect(rows()).toHaveLength(2);

    const input = container!.querySelector(
      '[data-slot="plugin-search-input"]',
    ) as HTMLInputElement;
    await act(async () => {
      // React 受控输入：直接赋值会被 value tracker 吞掉，必须走原生 setter 再派发 input
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, 'local');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].getAttribute('data-plugin-id')).toBe(LOCAL_ID);

    // 清空搜索后按来源筛选：只有内置插件
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const chips = [...container!.querySelectorAll('[data-slot="plugin-origin-filter"] button')];
    await act(async () => {
      (chips[1] as HTMLElement).click();
    });

    expect(chips[1].getAttribute('aria-pressed')).toBe('true');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].getAttribute('data-plugin-id')).toBe(ID);
  });
});

describe('PluginManagerPanel 来源与操作', () => {
  it('marks seeded plugins as 内置 and others as 本地, offering one action per origin', async () => {
    vi.mocked(pluginIpc.getState).mockResolvedValue(
      storedState({
        [ID]: { version: '1.0.0', origin: 'seed' },
        [LOCAL_ID]: { version: '2.0.0', origin: 'user' },
      }),
    );
    pluginState.setSnapshot(
      [
        entry(),
        entry({ id: LOCAL_ID, manifest: { ...manifest, id: LOCAL_ID, name: 'Local' } }),
      ],
      { safe_mode: false, enabled: [] },
    );
    await render();

    const listRows = rows();
    expect(listRows).toHaveLength(2);
    expect(listRows[0].textContent).toContain('内置');
    expect(listRows[1].textContent).toContain('本地');

    // 纯出厂插件没有「重装内置版本」（版本已与资源目录一致）；本地插件只提供「卸载」
    await openRow(ID);
    expect(detail()!.querySelector('[data-slot="plugin-reinstall"]')).toBeNull();
    expect(detail()!.querySelector('[data-slot="plugin-uninstall"]')).toBeNull();

    await goBack();
    // 本地覆盖版：既是本地来源（可卸载），也能重装回内置版本
    await openRow(LOCAL_ID);
    expect(detail()!.querySelector('[data-slot="plugin-uninstall"]')).not.toBeNull();
    expect(detail()!.querySelector('[data-slot="plugin-reinstall"]')).not.toBeNull();
  });

  it('uninstalls a plugin after confirmation and returns to the list', async () => {
    pluginState.setSnapshot([entry()], { safe_mode: false, enabled: [] });
    // 重扫仍返回该条目：回到列表只能来自卸载成功后的显式切换（不依赖快照变化）
    vi.mocked(pluginIpc.scan).mockResolvedValue([entry()]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await render();

    try {
      await openRow(ID);
      await clickButton(detail()!, '卸载');

      expect(confirm).toHaveBeenCalledWith(`卸载 ${ID}？插件目录会被删除`);
      expect(pluginIpc.uninstall).toHaveBeenCalledWith(ID);
      expect(toast.success).toHaveBeenCalledWith(`已卸载 ${ID}`);
      expect(listView()).not.toBeNull();
      expect(detail()).toBeNull();
    } finally {
      confirm.mockRestore();
    }
  });

  it('does not uninstall when the confirmation is cancelled', async () => {
    pluginState.setSnapshot([entry()], { safe_mode: false, enabled: [] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await render();

    try {
      await openRow(ID);
      await clickButton(detail()!, '卸载');

      expect(confirm).toHaveBeenCalled();
      expect(pluginIpc.uninstall).not.toHaveBeenCalled();
      expect(detail()).not.toBeNull();
    } finally {
      confirm.mockRestore();
    }
  });

  it('restores a bundled plugin overridden by a local copy', async () => {
    vi.mocked(pluginIpc.getState).mockResolvedValue(
      storedState({ [ID]: { version: '1.0.0', origin: 'user' } }),
    );
    pluginState.setSnapshot([entry()], { safe_mode: false, enabled: [] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await render();

    try {
      await openRow(ID);
      vi.mocked(pluginIpc.scan).mockClear();
      vi.mocked(pluginIpc.getState).mockClear();

      await clickButton(detail()!, '重装内置版本');

      expect(confirm).toHaveBeenCalledWith(`重装内置版本 ${ID}？插件目录会被重新写入`);
      expect(restoreBuiltinMock).toHaveBeenCalledWith(ID);
      // refreshPlugins() 至少扫一次；handleRestore 之后再取一次状态（刷新来源）。
      expect(pluginIpc.scan).toHaveBeenCalledTimes(1);
      expect(pluginIpc.getState).toHaveBeenCalledTimes(2);
      expect(toast.success).toHaveBeenCalledWith(`已重装内置版本 ${ID}`);
    } finally {
      confirm.mockRestore();
    }
  });

  it('stops the running instance before restoring an overridden plugin', async () => {
    vi.mocked(pluginIpc.scan).mockResolvedValue([entry({ enabled: true })]);
    vi.mocked(pluginIpc.getState).mockResolvedValue(
      storedState({ [ID]: { version: '1.0.0', origin: 'user' } }),
    );
    await initPluginRuntime(deps(), { importModule: async () => ({ default: HelloPlugin }) });
    expect(isPluginRunning(ID)).toBe(true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    // 目录会被重写：进入 restoreBuiltin 时实例必须已经停掉（顺序即断言）
    let runningAtRestore: boolean | null = null;
    restoreBuiltinMock.mockImplementationOnce(async () => {
      runningAtRestore = isPluginRunning(ID);
      return [ID];
    });
    await render();

    try {
      await openRow(ID);
      await clickButton(detail()!, '重装内置版本');

      expect(restoreBuiltinMock).toHaveBeenCalledWith(ID);
      expect(runningAtRestore).toBe(false);
      expect(isPluginRunning(ID)).toBe(false);
      expect(toast.success).toHaveBeenCalledWith(`已重装内置版本 ${ID}`);
      expect(toast.info).toHaveBeenCalledWith('编辑器窗口需重启 Textox 后加载该插件');
    } finally {
      confirm.mockRestore();
    }
  });
});

describe('PluginManagerPanel 详情页设置', () => {
  /** 带声明式设置字段的清单：`parseManifestSettings` 的白名单字段都能渲染。 */
  const settingsManifest: PluginManifest = {
    ...manifest,
    settings: [
      { key: 'shout', type: 'boolean', default: false, labelKey: 'shout' },
      { key: 'count', type: 'number', default: 5, min: 3, max: 20, labelKey: 'count' },
    ],
  };

  function settingsCard(): HTMLElement {
    const card = detail()?.querySelector('[data-slot="plugin-detail-settings"]');
    expect(card).not.toBeNull();
    return card as HTMLElement;
  }

  it('resets declared settings to their defaults and keeps undeclared keys', async () => {
    pluginState.setSnapshot([entry({ manifest: settingsManifest })], {
      safe_mode: false,
      enabled: [],
    });
    vi.mocked(pluginIpc.readData).mockResolvedValue({
      settings: { shout: true, count: 9, extra: 'keep' },
      plugin: { keep: 1 },
    });

    await render();
    await openRow(ID);

    const reset = detail()!.querySelector('[data-slot="plugin-reset-defaults"]') as HTMLButtonElement;
    expect(reset).not.toBeNull();
    expect(reset.disabled).toBe(false);

    await clickButton(detail()!, '恢复默认设置');

    expect(pluginIpc.writeData).toHaveBeenCalledWith(ID, {
      settings: { shout: false, count: 5, extra: 'keep' },
      plugin: { keep: 1 },
    });
  });

  it('shows the restart hint once for a plugin with restart fields, and not for immediate-only ones', async () => {
    const RESTART_ID = 'app.textox.restart';
    const restartManifest: PluginManifest = {
      ...manifest,
      id: RESTART_ID,
      name: 'Restart',
      settings: [
        {
          key: 'needsRestart',
          type: 'boolean',
          default: false,
          labelKey: 'needsRestart',
          apply: 'restart',
        },
        { key: 'live', type: 'boolean', default: false, labelKey: 'live' },
      ],
    };
    pluginState.setSnapshot(
      [entry({ id: RESTART_ID, manifest: restartManifest }), entry({ manifest: settingsManifest })],
      { safe_mode: false, enabled: [] },
    );
    await render();

    await openRow(RESTART_ID);
    const restartCard = settingsCard();
    // 整段一条提示（不随字段数量重复），且是设置区第一个子元素
    expect(restartCard.querySelectorAll('[data-slot="plugin-settings-restart"]')).toHaveLength(1);
    expect(restartCard.firstElementChild?.getAttribute('data-slot')).toBe(
      'plugin-settings-restart',
    );
    expect(restartCard.textContent).toContain('此插件的设置需重启应用后生效');

    // 纯 immediate 字段的插件不出现该提示
    await goBack();
    await openRow(ID);
    expect(settingsCard().querySelector('[data-slot="plugin-settings-restart"]')).toBeNull();
  });

  it('renders manifest settings and persists a coerced boolean change with an exact payload', async () => {
    pluginState.setSnapshot([entry({ manifest: settingsManifest })], {
      safe_mode: false,
      enabled: [],
    });
    vi.mocked(pluginIpc.readData).mockResolvedValue({
      settings: { count: 5 },
      plugin: { keep: 1 },
    });

    await render();
    await openRow(ID);

    const checkbox = checkboxIn(settingsCard());
    expect(checkbox.getAttribute('aria-checked')).toBe('false');

    await clickCheckbox(checkbox);

    expect(pluginIpc.readData).toHaveBeenCalledWith(ID);
    expect(pluginIpc.writeData).toHaveBeenCalledWith(ID, {
      settings: { count: 5, shout: true },
      plugin: { keep: 1 },
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range number without writing data, echoing the stored value', async () => {
    pluginState.setSnapshot([entry({ manifest: settingsManifest })], {
      safe_mode: false,
      enabled: [],
    });
    vi.mocked(pluginIpc.readData).mockResolvedValue({
      settings: { count: 5 },
      plugin: {},
    });

    await render();
    await openRow(ID);

    const input = settingsCard().querySelector('input[type="number"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, '99');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(pluginIpc.writeData).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('设置值无效，已保留原值');
    // 受控输入框不能停在非法输入上：回写后显示磁盘里的原值
    expect(input!.value).toBe('5');
  });

  it('ignores a stale read that resolves after a newer one', async () => {
    pluginState.setSnapshot([entry({ manifest: settingsManifest })], {
      safe_mode: false,
      enabled: [],
    });
    const pending: Array<
      (data: { settings: Record<string, unknown>; plugin: Record<string, unknown> }) => void
    > = [];
    vi.mocked(pluginIpc.readData).mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );

    await render();
    await openRow(ID);
    // 首次进入详情读一次
    expect(pending).toHaveLength(1);

    await act(async () => {
      // 两次广播各触发一次并行读
      for (const handler of dataChangedHandlers) handler(ID);
      for (const handler of dataChangedHandlers) handler(ID);
    });
    expect(pending).toHaveLength(3);

    // 最后一次读（count: 7）先返回、更早发出的慢读（count: 5）后返回：
    // 只应接受最后一次发出的读，晚到的旧值不得覆盖
    await act(async () => {
      pending[2]({ settings: { count: 7 }, plugin: {} });
    });
    await act(async () => {
      pending[0]({ settings: { count: 5 }, plugin: {} });
    });

    const input = settingsCard().querySelector('input[type="number"]') as HTMLInputElement;
    expect(input.value).toBe('7');
  });

  it('drops an invalid manifest settings field with a warning instead of rendering it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bogus = { key: 'x', type: 'bogus' };
    const manifestWithBogus: PluginManifest = {
      ...manifest,
      settings: [
        { key: 'shout', type: 'boolean', default: false, labelKey: 'shoutLabel' },
        bogus,
      ],
    };
    pluginState.setSnapshot([entry({ manifest: manifestWithBogus })], {
      safe_mode: false,
      enabled: [],
    });

    try {
      await render();
      await openRow(ID);

      expect(warn).toHaveBeenCalledWith('dropping invalid settings field', bogus);
      const card = settingsCard();
      // 合法字段照常渲染；非法字段被丢弃（不再产生第二行 / 未知 type 控件）。
      expect(card.querySelector('[data-slot="checkbox"]')).not.toBeNull();
      expect(card.querySelectorAll('.settings-item')).toHaveLength(1);
      expect(card.querySelector('input[type="bogus"]')).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  it('re-reads only the plugin shown in the detail page when plugin:data-changed fires', async () => {
    pluginState.setSnapshot(
      [entry({ manifest: settingsManifest }), entry({ id: LOCAL_ID })],
      { safe_mode: false, enabled: [] },
    );

    await render();
    await openRow(ID);
    vi.mocked(pluginIpc.readData).mockClear();

    await act(async () => {
      for (const handler of dataChangedHandlers) {
        handler(ID);
        handler(LOCAL_ID);
      }
    });

    expect(pluginIpc.readData).toHaveBeenCalledTimes(1);
    expect(pluginIpc.readData).toHaveBeenCalledWith(ID);
  });
});

describe('PluginManagerPanel 预设与动作', () => {
  /** 走 pointerdown / pointerup 打开并提交 radix Select（happy-dom 下 click 不会提交）。 */
  async function selectOptionByIndex(trigger: Element, index: number): Promise<void> {
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      (trigger as HTMLElement).click();
    });
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.length).toBeGreaterThan(index);
    await act(async () => {
      options[index].dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
      (options[index] as HTMLElement).click();
    });
  }

  function selectTrigger(): HTMLElement {
    const trigger = detail()?.querySelector('[data-slot="select-trigger"]');
    expect(trigger).not.toBeNull();
    return trigger as HTMLElement;
  }

  const PRESET_ID = 'io.github.acme.presets';

  const presetManifest: PluginManifest = {
    ...manifest,
    id: PRESET_ID,
    name: 'Presets',
    settings: [
      { key: 'spacing', type: 'number', default: 1, min: 0, max: 4, labelKey: 'spacing' },
      { key: 'accent', type: 'boolean', default: false, labelKey: 'accent' },
      { key: 'tint', type: 'color', default: '#f7d54e', labelKey: 'tint' },
      {
        key: 'density',
        type: 'preset',
        labelKey: 'density',
        options: [
          { value: 'compact', labelKey: 'compact', values: { spacing: 0, accent: false } },
          {
            value: 'roomy',
            labelKey: 'roomy',
            // 颜色故意用 3 位 + 大写：验证补丁逐键过 `coerceSettingsValue`（归一化为 6 位小写）
            values: { spacing: 3, accent: true, tint: '#ABC' },
          },
        ],
      },
    ],
  };

  it('writes every key of a preset patch through the shared coercion', async () => {
    pluginState.setSnapshot([entry({ id: PRESET_ID, manifest: presetManifest })], {
      safe_mode: false,
      enabled: [],
    });
    vi.mocked(pluginIpc.readData).mockResolvedValue({
      settings: { spacing: 1, accent: false, tint: '#f7d54e' },
      plugin: { keep: 1 },
    });

    await render();
    await openRow(PRESET_ID);

    // 有效配置与所有预设都不一致（spacing=1）⇒ 下拉未选中任何预设
    await selectOptionByIndex(selectTrigger(), 1);

    expect(pluginIpc.writeData).toHaveBeenCalledWith(PRESET_ID, {
      settings: { spacing: 3, accent: true, tint: '#aabbcc' },
      plugin: { keep: 1 },
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('rejects the whole preset patch when one key is invalid', async () => {
    const invalidManifest: PluginManifest = {
      ...presetManifest,
      settings: [
        { key: 'spacing', type: 'number', default: 1, min: 0, max: 4, labelKey: 'spacing' },
        {
          key: 'density',
          type: 'preset',
          labelKey: 'density',
          options: [
            // spacing=9 超出 max：整组补丁必须一起拒绝，不能只写另一半
            { value: 'broken', labelKey: 'broken', values: { spacing: 9 } },
          ],
        },
      ],
    };
    pluginState.setSnapshot([entry({ id: PRESET_ID, manifest: invalidManifest })], {
      safe_mode: false,
      enabled: [],
    });
    vi.mocked(pluginIpc.readData).mockResolvedValue({
      settings: { spacing: 1 },
      plugin: {},
    });

    await render();
    await openRow(PRESET_ID);

    await selectOptionByIndex(selectTrigger(), 0);

    expect(pluginIpc.writeData).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('设置值无效，已保留原值');
  });

  const ACTION_ID = 'io.github.acme.actions';

  function actionManifest(commands: { ping: string; missing: string }): PluginManifest {
    return {
      ...manifest,
      id: ACTION_ID,
      name: 'Actions',
      settings: [
        { key: 'ping', type: 'action', labelKey: 'ping', command: commands.ping },
        { key: 'missing', type: 'action', labelKey: 'missing', command: commands.missing },
      ],
    };
  }

  it('runs an action through the command its plugin registered', async () => {
    const commands = { ping: `${ACTION_ID}.ping`, missing: `${ACTION_ID}.missing` };
    const ping = vi.fn();
    class ActionPlugin extends Plugin {
      onload(): void {
        this.addCommand({ id: commands.ping, name: 'Ping', callback: ping });
      }
    }
    vi.mocked(pluginIpc.scan).mockResolvedValue([
      entry({ id: ACTION_ID, manifest: actionManifest(commands), enabled: true }),
    ]);
    await initPluginRuntime(deps(), { importModule: async () => ({ default: ActionPlugin }) });
    expect(isPluginRunning(ACTION_ID)).toBe(true);

    await render();
    await openRow(ACTION_ID);

    // 两个 action 都是「行尾直接子元素是按钮」的设置行，按声明顺序排列
    const actionButtons = [...detail()!.querySelectorAll('.settings-item')]
      .map((item) => [...item.children].find((child) => child.tagName === 'BUTTON'))
      .filter((button): button is Element => button !== undefined);
    expect(actionButtons).toHaveLength(2);

    await act(async () => {
      (actionButtons[0] as HTMLElement).click();
    });
    expect(ping).toHaveBeenCalledTimes(1);

    // 第二个字段引用的命令没人注册 ⇒ 面板提示，而不是静默失败
    await act(async () => {
      (actionButtons[1] as HTMLElement).click();
    });
    expect(toast.error).toHaveBeenCalledWith('插件未启用或未注册该命令，无法执行该操作');
  });
});
