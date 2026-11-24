import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

// 该用例依赖「缺失键回退为键名」：初始化一个空资源的 i18next 实例。
if (!i18next.isInitialized) {
  await i18next.use(initReactI18next).init({
    lng: 'en',
    resources: {},
    returnNull: false,
    fallbackLng: false,
  });
}

// 静态导入的 `@/i18n` 也持有同一个 i18next 单例：它可能先完成初始化、串行加载
// 资源并把语言探测成 happy-dom 的 `en-US`。本文件的中文文案断言（如「（已停用）」）
// 依赖 zh-CN 资源 / 缺省值，故显式钉住语言，避免用例受模块初始化时序影响
// （否则时快时慢地渲染出英文 `(disabled)`）。
if (i18next.language !== 'zh-CN') await i18next.changeLanguage('zh-CN');

import { PluginSettingsPanel } from '../PluginSettingsPanel';
import type { TextoPlugin } from '@/plugins/types';
import { OFFICIAL_AUTHOR } from '@texto/plugin-sdk';

// 隔离外部依赖：Tauri invoke、宿主构造、扩展点贡献读取、toast 副作用。
const { invokeMock, getContributionsMock, listAgentProfilesMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (_cmd: string, _args?: unknown) => ({})),
  getContributionsMock: vi.fn(() => [] as unknown[]),
  listAgentProfilesMock: vi.fn((): unknown[] => []),
}));

const { tooltipCaptures, providerDelays } = vi.hoisted(() => ({
  tooltipCaptures: [] as Array<{ name: string; side?: string }>,
  providerDelays: [] as Array<number | undefined>,
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
// 只替换 listAgentProfiles：其余 Agent 配置能力保持真实实现（避免 mock 面扩大）。
vi.mock('@/agent/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/agent/config')>()),
  listAgentProfiles: listAgentProfilesMock,
}));
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/plugins/host', () => ({ createPluginHost: () => ({}), NOOP_HOST_DEPS: {} }));
// 展开真实实现后只覆盖 `getContributionsWithOwner`：全局注册表是跨用例共享状态，
// 只有这处贡献读取需要按用例控制返回值；
// 其余导出（含 applySettingsDefaults —— 它本身就是被测行为）一律用真实实现，
// 避免包根每新增一个导出就要回来补白名单（如 @texto/app-api 兼容壳经由本模块取值）。
vi.mock('@texto/plugin-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@texto/plugin-sdk')>()),
  getContributionsWithOwner: getContributionsMock,
}));

// 隔离 base-ui 的 hover 计时与 portal，只验证本组的 tooltip 组合接线。
// Root/Provider 在生产中不渲染 DOM，这里同样直通（不伪造包裹层）；
// 真实可见性由 base-ui 负责，测试只捕获「每个方块注册了什么内容」。
vi.mock('@/components/ui/tooltip', async () => {
  const { Fragment, createElement, useEffect } = await import('react');
  const passThrough = ({ children }: { children?: ReactNode }) =>
    createElement(Fragment, null, children);
  return {
    TooltipProvider: ({ children, delay }: { children?: ReactNode; delay?: number }) => {
      useEffect(() => {
        providerDelays.push(delay);
      }, [delay]);
      return createElement(Fragment, null, children);
    },
    Tooltip: passThrough,
    TooltipTrigger: ({ render }: { render: ReactElement }) => render,
    TooltipContent: ({ children, side }: { children?: ReactNode; side?: string }) => {
      useEffect(() => {
        tooltipCaptures.push({ name: String(children), side });
      }, [children, side]);
      return null;
    },
  };
});

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function makePlugin(overrides: Partial<TextoPlugin>): TextoPlugin {
  return { id: 'plugin', version: '1.0.0', ...overrides };
}

/** 供 modelProfile 下拉用的配置条目（形状同 AgentProfile）。 */
function modelProfile(id: string, enabled: boolean) {
  return {
    id,
    name: id,
    provider: 'deepseek',
    model: 'deepseek-flash',
    apiKey: 'k',
    baseUrl: '',
    enabled,
  };
}

async function renderPanel(props: {
  plugins: TextoPlugin[];
  enabled?: Record<string, boolean>;
  onToggle?: (pluginId: string, next: boolean) => void;
  /** 显式指定初始视图；省略则不打 localStorage（走默认）。 */
  viewMode?: 'list' | 'grid';
}): Promise<void> {
  if (!root || !container) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  }
  if (props.viewMode) {
    localStorage.setItem('texto:plugins-view-mode', props.viewMode);
  }
  const element: ReactElement = createElement(PluginSettingsPanel, {
    plugins: props.plugins,
    enabled: props.enabled ?? {},
    onToggle: props.onToggle ?? (() => {}),
  });
  await act(async () => {
    root!.render(element);
  });
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

async function openMenu(trigger: Element): Promise<void> {
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    (trigger as HTMLElement).click();
  });
  await act(async () => {});
}

function menuItems(): Element[] {
  const content = document.querySelector('[data-slot="dropdown-menu-content"]');
  return [...(content?.querySelectorAll('[data-slot="dropdown-menu-item"]') ?? [])];
}

function groupTitles(): string[] {
  return [...container!.querySelectorAll('[data-slot="plugin-group-title"]')].map(
    (el) => el.textContent ?? '',
  );
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => ({}));
  getContributionsMock.mockReset();
  getContributionsMock.mockImplementation(() => []);
  listAgentProfilesMock.mockReset();
  listAgentProfilesMock.mockImplementation(() => []);
  tooltipCaptures.length = 0;
  providerDelays.length = 0;
  localStorage.clear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('PluginSettingsPanel', () => {
  it('按 categoryKey 分组渲染卡片，无 categoryKey 归入默认组', async () => {
    const tool = makePlugin({
      id: 'p-tool',
      displayNameKey: 'pluginA.name',
      category: 'editor',
    });
    const llm = makePlugin({ id: 'p-llm', displayNameKey: 'pluginC.name', category: 'llm' });
    const plain = makePlugin({ id: 'p-plain', displayNameKey: 'pluginB.name' });

    await renderPanel({ plugins: [tool, llm, plain] });

    // 三个分组各一个标题：LLM / 编辑器增强 / 默认组
    expect(groupTitles()).toContain(i18next.t('settings.categoryLlm'));
    expect(groupTitles()).toContain(i18next.t('settings.categoryEditor'));
    expect(groupTitles()).toContain(i18next.t('settings.plugins'));
    // 卡片名称经 aria-label 暴露（紧凑方块无可见文本）
    const labels = [...container!.querySelectorAll('[data-slot="plugin-tile"]')].map((el) =>
      el.getAttribute('aria-label'),
    );
    expect(labels).toContain('pluginA.name');
    expect(labels).toContain('pluginB.name');
    expect(labels).toContain('pluginC.name');
    expect(container!.querySelectorAll('[role="button"]').length).toBe(3);
  });

  it('列表渲染单列行与图标容器', async () => {
    const plugin = makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' });
    await renderPanel({ plugins: [plugin], viewMode: 'list' });

    expect(container!.querySelector('[data-slot="plugin-list"]')).not.toBeNull();
    const row = container!.querySelector('[data-slot="plugin-row"]');
    expect(row).not.toBeNull();
    expect(row!.querySelector('[data-slot="plugin-icon"]')).not.toBeNull();
    expect(row!.querySelector('[data-slot="dropdown-menu-trigger"]')).not.toBeNull();
  });

  it('官方插件显示官方徽标，第三方显示作者名', async () => {
    const official = makePlugin({
      id: 'p-official',
      displayNameKey: 'pluginA.name',
      author: OFFICIAL_AUTHOR,
    });
    const third = makePlugin({
      id: 'p-third',
      displayNameKey: 'pluginB.name',
      author: 'Acme',
    });
    await renderPanel({ plugins: [official, third], viewMode: 'list' });

    expect(container!.textContent).toContain(i18next.t('settings.pluginBundled'));
    expect(container!.textContent).toContain('Acme');
  });

  it('自定义分类字符串按原文分组显示', async () => {
    const plugin = makePlugin({
      id: 'p-sync',
      displayNameKey: 'pluginA.name',
      category: 'sync',
    });
    await renderPanel({ plugins: [plugin] });

    expect(groupTitles()).toContain('sync');
  });

  it('点击卡片进入二级页，点返回回到列表', async () => {
    const plugin = makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' });
    await renderPanel({ plugins: [plugin] });

    const card = container!.querySelector('[role="button"]');
    expect(card).not.toBeNull();
    await click(card!);

    // 二级页：卡片列表消失，返回按钮（图标按钮，文案在 aria-label）出现
    expect(container!.querySelectorAll('[role="button"]').length).toBe(0);
    const back = container!.querySelector(
      `button[aria-label="${i18next.t('settings.plugins')}"]`,
    );
    expect(back).toBeTruthy();

    await click(back!);

    // 返回列表
    expect(container!.querySelectorAll('[role="button"]').length).toBe(1);
  });

  it('进入二级页时把滚动容器重置到顶部', async () => {
    const plugin = makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' });
    await renderPanel({ plugins: [plugin] });

    // 模拟设置内容区（可滚动容器）：列表已滚到中部。
    container!.style.overflowY = 'auto';
    container!.scrollTop = 200;
    expect(container!.scrollTop).toBe(200);

    await click(container!.querySelector('[role="button"]')!);

    // 二级页应从顶部开始，而不是沿用插件中心的滚动位置。
    expect(container!.scrollTop).toBe(0);
  });

  it('返回列表时恢复插件中心进入前的滚动位置', async () => {
    const plugin = makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' });
    await renderPanel({ plugins: [plugin] });

    container!.style.overflowY = 'auto';
    container!.scrollTop = 200;

    await click(container!.querySelector('[role="button"]')!);
    expect(container!.scrollTop).toBe(0);

    // 二级页内滚到别处，返回时应回到进入前的列表位置，而非停在二级页的位置。
    container!.scrollTop = 120;
    const back = container!.querySelector(
      `button[aria-label="${i18next.t('settings.plugins')}"]`,
    );
    await click(back!);

    expect(container!.scrollTop).toBe(200);
  });

  it('齿轮菜单的启用项调用 onToggle，且不进入二级页', async () => {
    const onToggle = vi.fn();
    const plugin = makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' });
    await renderPanel({ plugins: [plugin], enabled: { 'p-a': false }, onToggle, viewMode: 'list' });

    const trigger = container!.querySelector('[data-slot="dropdown-menu-trigger"]');
    expect(trigger).not.toBeNull();
    await openMenu(trigger!);

    const items = menuItems();
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain(i18next.t('settings.pluginEnable'));
    await click(items[0]);

    expect(onToggle).toHaveBeenCalledWith('p-a', true);
    // 未进入二级页：卡片列表仍在
    expect(container!.querySelectorAll('[role="button"]').length).toBe(1);
  });

  it('二级页用切换按钮调用 onToggle(false)', async () => {
    const onToggle = vi.fn();
    await renderPanel({
      plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })],
      enabled: { 'p-a': true },
      onToggle,
    });
    await click(container!.querySelector('[role="button"]')!);

    // 二级页不再有齿轮
    expect(container!.querySelector('[data-slot="dropdown-menu-trigger"]')).toBeNull();

    const btn = [...container!.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(i18next.t('settings.pluginDisable')),
    );
    expect(btn).toBeTruthy();
    await click(btn!);
    expect(onToggle).toHaveBeenCalledWith('p-a', false);
  });

  it('二级页禁用态显示启用按钮并调用 onToggle(true)', async () => {
    const onToggle = vi.fn();
    await renderPanel({
      plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })],
      enabled: { 'p-a': false },
      onToggle,
    });
    await click(container!.querySelector('[role="button"]')!);

    const btn = [...container!.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(i18next.t('settings.pluginEnable')),
    );
    expect(btn).toBeTruthy();
    await click(btn!);
    expect(onToggle).toHaveBeenCalledWith('p-a', true);
  });

  it('未启用插件在二级页不显示其配置项，启用后才显示', async () => {
    getContributionsMock.mockImplementation(() => [
      {
        ownerId: 'p-a',
        value: {
          id: 'p-a.section',
          titleKey: 'pluginA.sectionTitle',
          fields: [{ type: 'boolean', key: 'flag', labelKey: 'pluginA.flag', default: false }],
        },
      },
    ]);
    const plugin = () => makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' });

    // 未启用：进入二级页不渲染配置字段，但仍可看到启用按钮。
    await renderPanel({ plugins: [plugin()], enabled: { 'p-a': false } });
    await click(container!.querySelector('[role="button"]')!);
    expect(container!.textContent).not.toContain(i18next.t('pluginA.flag'));
    expect(
      [...container!.querySelectorAll('button')].some((b) =>
        b.textContent?.includes(i18next.t('settings.pluginEnable')),
      ),
    ).toBe(true);

    // 启用：配置字段渲染。
    await renderPanel({ plugins: [plugin()], enabled: { 'p-a': true } });
    expect(container!.textContent).toContain(i18next.t('pluginA.flag'));
  });

  it('二级页第三方插件显示卸载、官方插件不显示', async () => {
    await renderPanel({
      plugins: [
        makePlugin({ id: 'p-official', displayNameKey: 'pluginA.name', author: OFFICIAL_AUTHOR }),
      ],
    });
    await click(container!.querySelector('[role="button"]')!);
    expect(
      [...container!.querySelectorAll('button')].some((b) =>
        b.textContent?.includes(i18next.t('settings.pluginUninstall')),
      ),
    ).toBe(false);

    await renderPanel({
      plugins: [makePlugin({ id: 'p-third', displayNameKey: 'pluginB.name', author: 'Acme' })],
    });
    await click(container!.querySelector('[role="button"]')!);
    expect(
      [...container!.querySelectorAll('button')].some((b) =>
        b.textContent?.includes(i18next.t('settings.pluginUninstall')),
      ),
    ).toBe(true);
  });

  it('第三方插件菜单含卸载项、内置官方插件不含', async () => {
    await renderPanel({
      plugins: [
        makePlugin({ id: 'p-official', displayNameKey: 'pluginA.name', author: OFFICIAL_AUTHOR }),
      ],
      viewMode: 'list',
    });
    await openMenu(container!.querySelector('[data-slot="dropdown-menu-trigger"]')!);
    expect(menuItems().some((el) =>
      el.textContent?.includes(i18next.t('settings.pluginUninstall')),
    )).toBe(false);

    await renderPanel({
      plugins: [makePlugin({ id: 'p-third', displayNameKey: 'pluginB.name', author: 'Acme' })],
      viewMode: 'list',
    });
    await openMenu(container!.querySelector('[data-slot="dropdown-menu-trigger"]')!);
    expect(menuItems().some((el) =>
      el.textContent?.includes(i18next.t('settings.pluginUninstall')),
    )).toBe(true);
  });

  it('渲染 app:settingsSection 字段，文本变更写入插件配置', async () => {
    getContributionsMock.mockImplementation(() => [
      {
        ownerId: 'p-a',
        value: {
          id: 'p-a.section',
          titleKey: 'pluginA.sectionTitle',
          fields: [
            { type: 'text', key: 'apiKey', labelKey: 'pluginA.apiKey', default: '' },
            { type: 'boolean', key: 'flag', labelKey: 'pluginA.flag', default: false },
          ],
        },
      },
    ]);
    const plugin = makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' });
    await renderPanel({ plugins: [plugin] });

    const card = container!.querySelector('[role="button"]');
    await click(card!);

    // 字段 label 渲染
    expect(container!.textContent).toContain(i18next.t('pluginA.apiKey'));
    expect(container!.textContent).toContain(i18next.t('pluginA.flag'));

    const input = container!.querySelector('input[type="text"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    invokeMock.mockClear();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, 'secret');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const setCall = invokeMock.mock.calls.find((call) => call[0] === 'set_plugin_config');
    expect(setCall).toBeTruthy();
    expect(setCall![1]).toEqual({
      pluginId: 'p-a',
      config: { apiKey: 'secret' },
    });
  });

  it('框架内建「恢复默认值」：配置偏离默认时展示，经二次确认后写回默认配置', async () => {
    getContributionsMock.mockImplementation(() => [
      {
        ownerId: 'p-a',
        value: {
          id: 'p-a.section',
          titleKey: 'pluginA.sectionTitle',
          fields: [{ type: 'text', key: 'apiKey', labelKey: 'pluginA.apiKey', default: 'def' }],
        },
      },
    ]);
    // 已存非默认值，恢复后应写回默认值。
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'get_plugin_config' ? { apiKey: 'user' } : {},
    );
    await renderPanel({
      plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })],
      enabled: { 'p-a': true },
    });
    await click(container!.querySelector('[role="button"]')!);

    const resetBtn = [...container!.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(i18next.t('settings.pluginReset')),
    );
    expect(resetBtn).toBeTruthy();

    // 点击只弹出二次确认，不直接写入。
    await click(resetBtn!);
    invokeMock.mockClear();
    expect(invokeMock.mock.calls.some((call) => call[0] === 'set_plugin_config')).toBe(false);

    const confirmBox = document.querySelector('[data-slot="plugin-reset-confirm"]');
    expect(confirmBox).not.toBeNull();
    const confirmBtn = [...confirmBox!.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(i18next.t('settings.pluginReset')),
    );
    expect(confirmBtn).toBeTruthy();

    await click(confirmBtn!);
    await act(async () => {});

    const setCall = invokeMock.mock.calls.find((call) => call[0] === 'set_plugin_config');
    expect(setCall?.[1]).toEqual({ pluginId: 'p-a', config: { apiKey: 'def' } });
  });

  it('配置未偏离默认值时不显示「恢复默认值」', async () => {
    getContributionsMock.mockImplementation(() => [
      {
        ownerId: 'p-a',
        value: {
          id: 'p-a.section',
          titleKey: 'pluginA.sectionTitle',
          fields: [{ type: 'text', key: 'apiKey', labelKey: 'pluginA.apiKey', default: 'def' }],
        },
      },
    ]);
    // 存的值等于默认值 → 无变化。
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'get_plugin_config' ? { apiKey: 'def' } : {},
    );
    await renderPanel({
      plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })],
      enabled: { 'p-a': true },
    });
    await click(container!.querySelector('[role="button"]')!);

    expect(
      [...container!.querySelectorAll('button')].some((b) =>
        b.textContent?.includes(i18next.t('settings.pluginReset')),
      ),
    ).toBe(false);
  });

  it('select 选项用纯文本 label 时渲染 label 而非原始 key', async () => {
    getContributionsMock.mockImplementation(() => [
      {
        ownerId: 'p-a',
        value: {
          id: 'p-a.section',
          titleKey: 'settings.plugins',
          fields: [
            {
              type: 'select',
              key: 'theme',
              labelKey: 'settings.plugins',
              options: [
                // 纯文本 label：不应把 value 当 key/i18n key 输出
                { value: 'theme.alpha', label: 'Alpha' },
                // labelKey 为空串：回退到纯文本 label
                { value: 'theme.beta', labelKey: '', label: 'Beta' },
                // labelKey 为真：走 i18n，且优先于 label
                { value: 'theme.delta', labelKey: 'pluginA.delta', label: 'Delta' },
              ],
            },
          ],
        },
      },
    ]);
    const plugin = makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' });
    await renderPanel({ plugins: [plugin] });

    await click(container!.querySelector('[role="button"]')!);

    const trigger = container!.querySelector('[data-slot="select-trigger"]');
    expect(trigger).not.toBeNull();
    await click(trigger!);

    const content = document.querySelector('[data-slot="select-content"]');
    expect(content).not.toBeNull();
    const optionTexts = [...content!.querySelectorAll('[data-slot="select-item"]')].map(
      (el) => el.textContent ?? '',
    );
    // 纯文本 label 与空串 labelKey 回退均正确渲染
    expect(optionTexts).toContain('Alpha');
    expect(optionTexts).toContain('Beta');
    // labelKey 为真时走 i18n：测试环境无 pluginA.delta 翻译 → t() 回退键名，
    // 且标签优先于同项的 label，故渲染 key 而非 'Delta'。
    expect(optionTexts).toContain('pluginA.delta');
    expect(optionTexts).not.toContain('Delta');
  });

  it('渲染 action 返回的 detail（可复制）', async () => {
    getContributionsMock.mockImplementation(() => [
      {
        ownerId: 'p-a',
        value: {
          id: 'p-a.section',
          titleKey: 'pluginA.sectionTitle',
          fields: [
            {
              type: 'action',
              id: 'p-a.test',
              labelKey: 'pluginA.test',
              run: async () => ({ ok: true, detail: 'https://cdn.example/x.png' }),
            },
          ],
        },
      },
    ]);
    const plugin = makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' });
    await renderPanel({ plugins: [plugin] });

    await click(container!.querySelector('[role="button"]')!);

    const actionButton = [...container!.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes(i18next.t('pluginA.test')),
    );
    expect(actionButton).toBeTruthy();
    await click(actionButton!);
    await act(async () => {});

    const dialog = document.querySelector('[data-slot="dialog-content"]');
    expect(dialog?.textContent).toContain('https://cdn.example/x.png');

    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const copyButton = dialog!.querySelector(
      `button[aria-label="${i18next.t('common.copy')}"]`,
    ) as HTMLButtonElement | null;
    expect(copyButton).not.toBeNull();
    await click(copyButton!);
    expect(writeText).toHaveBeenCalledWith('https://cdn.example/x.png');
  });

  it('color 字段渲染颜色输入并在变更时写入配置', async () => {
    getContributionsMock.mockImplementation(() => [
      {
        ownerId: 'p-a',
        value: {
          id: 'p-a.section',
          titleKey: 'pluginA.sectionTitle',
          fields: [
            { type: 'color', key: 'color', labelKey: 'settings.particleColor', default: '#123456' },
          ],
        },
      },
    ]);
    await renderPanel({ plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })] });
    await click(container!.querySelector('[role="button"]')!);

    const input = container!.querySelector(
      '[data-slot="plugin-color-input"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input!.tagName).toBe('INPUT');
    expect(input!.type).toBe('color');
    invokeMock.mockClear();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '#ffffff');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const setCall = invokeMock.mock.calls.find((call) => call[0] === 'set_plugin_config');
    expect(setCall?.[1]).toEqual({ pluginId: 'p-a', config: { color: '#ffffff' } });
  });

  it('color 字段带 presets 时渲染色板并可选择', async () => {
    getContributionsMock.mockImplementation(() => [
      {
        ownerId: 'p-a',
        value: {
          id: 'p-a.section',
          titleKey: 'pluginA.sectionTitle',
          fields: [
            {
              type: 'color',
              key: 'color',
              labelKey: 'pluginA.color',
              default: '#ffd700',
              presets: [{ value: '#ffd700' }, { value: '#a3e07a' }],
            },
          ],
        },
      },
    ]);
    await renderPanel({ plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })] });
    await click(container!.querySelector('[role="button"]')!);

    const swatches = container!.querySelectorAll('[data-slot="plugin-color-preset"]');
    expect(swatches.length).toBe(2);
    // 默认值命中第一个预设：仅该色板处于按下态。
    expect(swatches[0].getAttribute('aria-pressed')).toBe('true');
    expect(swatches[1].getAttribute('aria-pressed')).toBe('false');
    expect(container!.querySelector('[data-slot="plugin-color-input"]')).not.toBeNull();

    invokeMock.mockClear();
    await click(swatches[1] as HTMLButtonElement);
    const setCall = invokeMock.mock.calls.find((call) => call[0] === 'set_plugin_config');
    expect(setCall?.[1]).toEqual({ pluginId: 'p-a', config: { color: '#a3e07a' } });
  });

  it('color 字段 presets 模式下自定义色显示选中反馈且取色器仍可写入', async () => {
    getContributionsMock.mockImplementation(() => [
      {
        ownerId: 'p-a',
        value: {
          id: 'p-a.section',
          titleKey: 'pluginA.sectionTitle',
          fields: [
            {
              type: 'color',
              key: 'color',
              labelKey: 'pluginA.color',
              default: '#ffd700',
              presets: [{ value: '#ffd700' }, { value: '#a3e07a' }],
            },
          ],
        },
      },
    ]);
    // 已存配置为自定义色（不匹配任何预设）。
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'get_plugin_config' ? { color: '#123456' } : {},
    );
    await renderPanel({ plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })] });
    await click(container!.querySelector('[role="button"]')!);
    await act(async () => {});

    const custom = container!.querySelector('[data-slot="plugin-color-custom"]');
    expect(custom).not.toBeNull();
    expect(custom!.getAttribute('data-active')).toBe('true');
    // 自定义色不命中预设：色板均为未按下态。
    const swatches = container!.querySelectorAll('[data-slot="plugin-color-preset"]');
    expect([...swatches].every((el) => el.getAttribute('aria-pressed') === 'false')).toBe(true);

    const input = container!.querySelector(
      '[data-slot="plugin-color-input"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    invokeMock.mockClear();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '#00ff00');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const setCall = invokeMock.mock.calls.find((call) => call[0] === 'set_plugin_config');
    expect(setCall?.[1]).toEqual({ pluginId: 'p-a', config: { color: '#00ff00' } });
  });

  it('visibleWhen 不满足时隐藏字段', async () => {
    getContributionsMock.mockImplementation(() => [
      {
        ownerId: 'p-a',
        value: {
          id: 'p-a.section',
          titleKey: 'pluginA.sectionTitle',
          fields: [
            { type: 'select', key: 'mode', labelKey: 'pluginA.mode', default: 'a', options: [{ value: 'a', label: 'A' }] },
            { type: 'color', key: 'color', labelKey: 'pluginA.color', visibleWhen: { key: 'mode', equals: 'fixed' } },
          ],
        },
      },
    ]);
    await renderPanel({ plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })] });
    await click(container!.querySelector('[role="button"]')!);
    expect(container!.querySelector('input[type="color"]')).toBeNull();
  });

  it('number 字段带范围属性', async () => {
    getContributionsMock.mockImplementation(() => [
      {
        ownerId: 'p-a',
        value: {
          id: 'p-a.section',
          titleKey: 'pluginA.sectionTitle',
          fields: [
            { type: 'number', key: 'count', labelKey: 'pluginA.count', default: 5, min: 3, max: 20, step: 1 },
          ],
        },
      },
    ]);
    await renderPanel({ plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })] });
    await click(container!.querySelector('[role="button"]')!);
    const input = container!.querySelector('input[type="number"]') as HTMLInputElement | null;
    expect(input?.getAttribute('min')).toBe('3');
    expect(input?.getAttribute('max')).toBe('20');
    expect(input?.getAttribute('step')).toBe('1');
  });

  it('action 返回 set 时用整组配置覆盖', async () => {
    getContributionsMock.mockImplementation(() => [
      {
        ownerId: 'p-a',
        value: {
          id: 'p-a.section',
          titleKey: 'pluginA.sectionTitle',
          fields: [
            { type: 'action', id: 'p-a.reset', labelKey: 'pluginA.reset', run: async () => ({ ok: true, set: { count: 15 } }) },
          ],
        },
      },
    ]);
    // 已存配置含额外键：用于区分「整组覆盖」与「合并写入」。
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'get_plugin_config' ? { other: 1 } : {},
    );
    await renderPanel({ plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })] });
    await click(container!.querySelector('[role="button"]')!);

    const button = [...container!.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes(i18next.t('pluginA.reset')),
    );
    expect(button).toBeTruthy();
    invokeMock.mockClear();
    await click(button!);
    await act(async () => {});

    const setCall = invokeMock.mock.calls.find((call) => call[0] === 'set_plugin_config');
    expect(setCall?.[1]).toEqual({ pluginId: 'p-a', config: { count: 15 } });
    expect((setCall![1] as { config: Record<string, unknown> }).config).not.toHaveProperty('other');
  });

  it('restart 插件显示重启提示', async () => {
    getContributionsMock.mockImplementation(() => [
      {
        ownerId: 'p-a',
        value: {
          id: 'p-a.section',
          titleKey: 'pluginA.sectionTitle',
          fields: [{ type: 'boolean', key: 'flag', labelKey: 'pluginA.flag', default: false }],
        },
      },
    ]);
    await renderPanel({ plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })] });
    await click(container!.querySelector('[role="button"]')!);
    expect(container!.querySelector('[data-slot="plugin-settings-restart"]')).not.toBeNull();
  });

  it('immediate 插件不显示重启提示', async () => {
    getContributionsMock.mockImplementation(() => [
      {
        ownerId: 'p-a',
        value: {
          id: 'p-a.section',
          titleKey: 'pluginA.sectionTitle',
          fields: [{ type: 'boolean', key: 'flag', labelKey: 'pluginA.flag', default: false }],
        },
      },
    ]);
    await renderPanel({
      plugins: [
        makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name', settingsApply: 'immediate' }),
      ],
    });
    await click(container!.querySelector('[role="button"]')!);
    // 设置段仍渲染，但不出现重启提示。
    expect(container!.textContent).toContain(i18next.t('pluginA.flag'));
    expect(container!.querySelector('[data-slot="plugin-settings-restart"]')).toBeNull();
  });

  it('默认网格视图，并提供列表/网格切换按钮', async () => {
    await renderPanel({ plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })] });

    expect(container!.querySelector('[data-slot="plugin-grid"]')).not.toBeNull();
    expect(container!.querySelector('[data-slot="plugin-list"]')).toBeNull();
    const listBtn = container!.querySelector('[data-plugin-view="list"]');
    const gridBtn = container!.querySelector('[data-plugin-view="grid"]');
    expect(listBtn).not.toBeNull();
    expect(gridBtn).not.toBeNull();
    expect(gridBtn!.getAttribute('data-active')).not.toBeNull();
    expect(listBtn!.getAttribute('data-active')).toBeNull();
  });

  it('切换到列表会写入 localStorage 并更新按下态', async () => {
    await renderPanel({ plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })] });

    await click(container!.querySelector('[data-plugin-view="list"]') as HTMLElement);

    expect(localStorage.getItem('texto:plugins-view-mode')).toBe('list');
    expect(
      container!.querySelector('[data-plugin-view="list"]')!.getAttribute('data-active'),
    ).not.toBeNull();
    expect(
      container!.querySelector('[data-plugin-view="grid"]')!.getAttribute('data-active'),
    ).toBeNull();
  });

  it('重新挂载时读取并保持上次的视图选择', async () => {
    localStorage.setItem('texto:plugins-view-mode', 'list');
    await renderPanel({ plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })] });

    expect(
      container!.querySelector('[data-plugin-view="list"]')!.getAttribute('data-active'),
    ).not.toBeNull();
  });

  it('网格视图渲染方块且方块不含行内操作按钮', async () => {
    await renderPanel({ plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })] });

    await click(container!.querySelector('[data-plugin-view="grid"]') as HTMLElement);

    expect(container!.querySelector('[data-slot="plugin-grid"]')).not.toBeNull();
    expect(container!.querySelector('[data-slot="plugin-list"]')).toBeNull();
    const tile = container!.querySelector('[data-slot="plugin-tile"]');
    expect(tile).not.toBeNull();
    expect(tile!.querySelector('[data-slot="plugin-icon"]')).not.toBeNull();
    expect(tile!.getAttribute('aria-label')).toBe('pluginA.name');
    expect(tile!.hasAttribute('title')).toBe(false);
    expect(tile!.textContent).toBe('');
    // 方块不放行内操作按钮
    expect(tile!.querySelector('[data-slot="dropdown-menu-trigger"]')).toBeNull();
  });

  it('紧凑方块带漂浮参数，未启用插件置灰', async () => {
    await renderPanel({
      plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })],
      enabled: { 'p-a': false },
    });

    const tile = container!.querySelector('[data-slot="plugin-tile"]') as HTMLElement | null;
    expect(tile).not.toBeNull();
    expect(tile!.getAttribute('data-disabled')).toBe('true');

    const icon = tile!.querySelector('[data-slot="plugin-icon"]') as HTMLElement | null;
    expect(icon).not.toBeNull();
    expect(icon!.style.getPropertyValue('--float-duration')).toMatch(/s$/);
    expect(icon!.style.getPropertyValue('--float-delay')).toMatch(/s$/);
    expect(icon!.style.getPropertyValue('--float-distance')).toMatch(/px$/);

    // CSS 硬依赖 div.plugin-tile > span.plugin-tile-icon > svg 的形状：
    // 结构被改会让 hover 缩放 / 漂浮选择器静默失效（见 plugin-tile-parity.test.ts）。
    expect(icon!.classList.contains('plugin-tile-icon')).toBe(true);
    // 直接子级判定：happy-dom 不支持 `:scope > svg`（实测恒为 null），
    // 改用父元素反查 —— 图标 svg 必须直接挂在图标层下，而不是被包一层。
    expect(icon!.querySelector('svg')?.parentElement).toBe(icon);
  });

  it('每个方块都带悬浮名称 tooltip（side=bottom）', async () => {
    await renderPanel({ plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })] });

    const last = tooltipCaptures[tooltipCaptures.length - 1];
    expect(last).toEqual({ name: 'pluginA.name', side: 'bottom' });
    expect(providerDelays[providerDelays.length - 1]).toBe(200);
    expect(tooltipCaptures).toHaveLength(1);
  });

  it('视图项带错峰入场动画延迟', async () => {
    await renderPanel({
      plugins: [
        makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' }),
        makePlugin({ id: 'p-b', displayNameKey: 'pluginB.name' }),
      ],
      viewMode: 'grid',
    });

    const tiles = container!.querySelectorAll('[data-slot="plugin-tile"]');
    expect(tiles.length).toBe(2);
    expect((tiles[0] as HTMLElement).style.animationDelay).toBe('0ms');
    expect((tiles[1] as HTMLElement).style.animationDelay).toBe('28ms');
  });

  it('从侧边栏进入插件页不播放逐项入场动画，内部切换后才启用', async () => {
    await renderPanel({ plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })] });

    // 首次进入（从侧边栏点开插件页）：不带动画标记。
    const first = container!.querySelector('.plugin-center');
    expect(first).not.toBeNull();
    expect(first!.classList.contains('plugin-center--animated')).toBe(false);

    // 插件中心内部切换视图后：带标记，逐项入场动画生效。
    await click(container!.querySelector('[data-plugin-view="list"]') as HTMLElement);
    expect(
      container!.querySelector('.plugin-center')!.classList.contains('plugin-center--animated'),
    ).toBe(true);
  });

  it('网格模式点击方块进入二级页，返回后仍为网格', async () => {
    await renderPanel({ plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })] });

    await click(container!.querySelector('[data-plugin-view="grid"]') as HTMLElement);
    await click(container!.querySelector('[data-slot="plugin-tile"]') as HTMLElement);

    // 二级页：方块消失，出现返回按钮
    expect(container!.querySelectorAll('[data-slot="plugin-tile"]').length).toBe(0);
    const back = container!.querySelector(
      `button[aria-label="${i18next.t('settings.plugins')}"]`,
    );
    expect(back).toBeTruthy();

    await click(back!);
    // 返回列表后仍是网格
    expect(container!.querySelector('[data-slot="plugin-grid"]')).not.toBeNull();
  });

  /** 挂载一个只带 modelProfile 字段的插件二级页，并返回下拉选项文本。 */
  async function renderModelProfileField(): Promise<string[]> {
    getContributionsMock.mockImplementation(() => [
      {
        ownerId: 'p-a',
        value: {
          id: 'p-a.section',
          titleKey: 'pluginA.sectionTitle',
          fields: [
            {
              type: 'modelProfile',
              key: 'modelProfile',
              labelKey: 'pluginA.modelProfile',
              default: '',
            },
          ],
        },
      },
    ]);
    await renderPanel({
      plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })],
      enabled: { 'p-a': true },
    });
    await click(container!.querySelector('[role="button"]')!);

    const trigger = container!.querySelector('[data-slot="select-trigger"]');
    expect(trigger).not.toBeNull();
    await click(trigger!);

    const content = document.querySelector('[data-slot="select-content"]');
    expect(content).not.toBeNull();
    return [...content!.querySelectorAll('[data-slot="select-item"]')].map(
      (el) => el.textContent ?? '',
    );
  }

  it('modelProfile 字段渲染下拉且只列出已启用的配置', async () => {
    listAgentProfilesMock.mockImplementation(() => [
      modelProfile('a', true),
      modelProfile('b', false),
    ]);

    const optionTexts = await renderModelProfileField();

    expect(optionTexts).toEqual(['a · deepseek-flash']);
  });

  it('modelProfile 保留已绑定但已停用的配置并标注停用', async () => {
    listAgentProfilesMock.mockImplementation(() => [
      modelProfile('a', true),
      modelProfile('b', false),
    ]);
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'get_plugin_config' ? { modelProfile: 'b' } : {},
    );

    const optionTexts = await renderModelProfileField();

    expect(optionTexts).toEqual(['a · deepseek-flash', 'b · deepseek-flash（已停用）']);
  });

  it('modelProfile 绑定已删除时提示重新选择', async () => {
    listAgentProfilesMock.mockImplementation(() => [modelProfile('a', true)]);
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'get_plugin_config' ? { modelProfile: 'gone' } : {},
    );

    const optionTexts = await renderModelProfileField();

    expect(optionTexts).toEqual(['a · deepseek-flash']);
    expect(container!.querySelector('[data-slot="model-profile-deleted"]')).not.toBeNull();
    expect(container!.querySelector('[data-slot="model-profile-empty"]')).toBeNull();
  });

  it('modelProfile 没有可选项时禁用下拉并提示先去启用配置', async () => {
    getContributionsMock.mockImplementation(() => [
      {
        ownerId: 'p-a',
        value: {
          id: 'p-a.section',
          titleKey: 'pluginA.sectionTitle',
          fields: [
            {
              type: 'modelProfile',
              key: 'modelProfile',
              labelKey: 'pluginA.modelProfile',
              default: '',
            },
          ],
        },
      },
    ]);
    // 只有已停用的配置且未绑定任何一条：下拉无可用选项。
    listAgentProfilesMock.mockImplementation(() => [modelProfile('b', false)]);

    await renderPanel({
      plugins: [makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' })],
      enabled: { 'p-a': true },
    });
    await click(container!.querySelector('[role="button"]')!);

    const trigger = container!.querySelector('[data-slot="select-trigger"]');
    expect(trigger).not.toBeNull();
    expect(trigger!.hasAttribute('disabled')).toBe(true);
    expect(container!.querySelector('[data-slot="model-profile-empty"]')).not.toBeNull();
  });
});
