import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

/**
 * tooltip 的真实集成（**不 mock** `@/components/ui/tooltip`）。
 *
 * `PluginSettingsPanel.test.tsx` 把 tooltip 三个组件都 mock 掉了，因此这些
 * 接线没有守护：base-ui 是否读取 `delay`、`TooltipTrigger render` 合并后
 * `role` / `tabIndex` / `aria-label` / `data-disabled` 是否还在、Provider/Root
 * 是否注入额外 DOM（会破坏 `.plugin-grid` 的直接子元素布局）。
 *
 * 这里只隔离与 tooltip 无关的宿主依赖（Tauri、宿主构造、扩展点贡献、toast），
 * 让 base-ui 真正跑起来。
 */

// 缺失键回退为键名：初始化空资源 i18next（与 PluginSettingsPanel.test.tsx 一致）。
if (!i18next.isInitialized) {
  await i18next.use(initReactI18next).init({
    lng: 'en',
    resources: {},
    returnNull: false,
    fallbackLng: false,
  });
}

import { PluginSettingsPanel } from '@/components/PluginSettingsPanel';
import type { TextoPlugin } from '@/plugins/types';

const { invokeMock, getContributionsMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (_cmd: string, _args?: unknown) => ({})),
  getContributionsMock: vi.fn(() => [] as unknown[]),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/plugins/host', () => ({ createPluginHost: () => ({}), NOOP_HOST_DEPS: {} }));
vi.mock('@texto/plugin-sdk', () => ({
  getContributionsWithOwner: getContributionsMock,
  declareExtensionPoint: vi.fn(),
  hasExtensionPoint: () => true,
  registerContributions: vi.fn(),
  getContributions: () => [],
  resetExtensionPointsForTests: vi.fn(),
  ownerOfExtensionPoint: () => null,
  setPluginConfigSnapshot: vi.fn(),
  getPluginConfigSnapshot: () => ({}),
  definePlugin: (plugin: unknown) => plugin,
  PLUGIN_CATEGORIES: ['llm', 'editor', 'export', 'image-hosting'],
  OFFICIAL_AUTHOR: 'Textox',
  isOfficialPlugin: (plugin: { author?: string }) => plugin.author === 'Textox',
  isKnownCategory: (category: string) =>
    category === 'llm' || category === 'editor' || category === 'export' || category === 'image-hosting',
}));

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function makePlugin(overrides: Partial<TextoPlugin>): TextoPlugin {
  return { id: 'plugin', version: '1.0.0', ...overrides };
}

async function renderPanel(props: {
  plugins: TextoPlugin[];
  enabled?: Record<string, boolean>;
}): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const element: ReactElement = createElement(PluginSettingsPanel, {
    plugins: props.plugins,
    enabled: props.enabled ?? {},
    onToggle: () => {},
  });
  await act(async () => {
    root!.render(element);
  });
}

/** 推进一帧，给 base-ui 的 open 状态 / portal 渲染留出时间。 */
async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => ({}));
  getContributionsMock.mockReset();
  getContributionsMock.mockImplementation(() => []);
});

afterEach(async () => {
  if (root) {
    const mounted = root;
    await act(async () => {
      mounted.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  // 兜底清掉可能残留的 portal 内容，避免污染同文件后续用例。
  document.querySelectorAll('[data-slot="tooltip-content"]').forEach((el) => el.remove());
  document.querySelectorAll('[data-base-ui-portal]').forEach((el) => el.remove());
});

describe('plugin tile tooltip（真实 base-ui）', () => {
  it('trigger 保留原生可访问属性，Provider/Root 不产生包裹 DOM', async () => {
    const first = makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' });
    const second = makePlugin({ id: 'p-b', displayNameKey: 'pluginB.name' });
    await renderPanel({ plugins: [first, second], enabled: { 'p-a': false } });

    const tiles = [...container!.querySelectorAll<HTMLElement>('[data-slot="plugin-tile"]')];
    expect(tiles.length, '默认视图应为 grid，且每个插件一个方块').toBe(2);

    const tile = tiles[0];
    expect(tile.getAttribute('role')).toBe('button');
    expect(tile.getAttribute('tabindex')).toBe('0');
    expect(tile.getAttribute('aria-label')).toBe('pluginA.name');
    expect(tile.getAttribute('data-disabled')).toBe('true');
    expect(tiles[1].getAttribute('data-disabled')).toBe('false');

    // Provider / Tooltip(Root) / Trigger 都不应插入包裹元素：
    // grid 的直接子元素必须正好是各方块，否则 CSS grid 的方块布局会被打散。
    const grid = container!.querySelector('[data-slot="plugin-grid"]') as HTMLElement | null;
    expect(grid).not.toBeNull();
    expect(grid!.children.length).toBe(2);
    expect([...grid!.children].map((el) => el.getAttribute('data-slot'))).toEqual([
      'plugin-tile',
      'plugin-tile',
    ]);
    expect(grid!.children[0]).toBe(tile);
  });

  it('focus 打开 tooltip，内容为插件名', async () => {
    const plugin = makePlugin({ id: 'p-a', displayNameKey: 'pluginA.name' });
    await renderPanel({ plugins: [plugin] });

    const tile = container!.querySelector('[data-slot="plugin-tile"]') as HTMLElement | null;
    expect(tile).not.toBeNull();

    // happy-dom 下 hover 的 pointer 能力不完整，用 focus 触发（base-ui 的
    // tooltip 在焦点进入时同样打开）。
    await act(async () => {
      tile!.focus();
    });
    await flushFrame();

    const content = document.querySelector('[data-slot="tooltip-content"]');
    expect(content, 'focus 后 base-ui 应把 tooltip 内容挂到 portal').not.toBeNull();
    expect(content!.textContent?.trim()).toBe('pluginA.name');

    // base-ui 在 trigger 上注入 `data-popup-open`（该版本不写 aria-describedby），
    // 证明 Trigger 的合并逻辑生效，且没有覆盖面板传入的 role / tabIndex / aria-label。
    expect(tile!.getAttribute('data-popup-open')).not.toBeNull();
  });
});
