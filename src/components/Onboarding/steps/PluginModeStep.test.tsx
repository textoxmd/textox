import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

// 该用例断言渲染出的**已翻译**插件名，因此需要真实资源。
// 注意：i18next 是模块级单例，可能已被同 worker 内的其它测试初始化过，
// 因此这里不依赖 fallbackNS，而是把插件名与向导文案都放进默认命名空间
// （`t('table.pluginName')` 直接按嵌套键解析），并强制切到 en。
if (!i18next.isInitialized) {
  await i18next.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    returnNull: false,
    resources: {},
  });
}

i18next.addResourceBundle(
  'en',
  'translation',
  {
    onboarding: {
      pluginMode: {
        title: 'Plugin mode',
        desc: 'desc',
        warnTitle: 'warn',
        warnDesc: 'warn desc',
      },
    },
    table: { pluginName: 'Table' },
    math: { pluginName: 'Math' },
  },
  true,
  true,
);

await i18next.changeLanguage('en');

const { listPluginsMock } = vi.hoisted(() => ({ listPluginsMock: vi.fn() }));

vi.mock('@/plugins/registry', () => ({ listPlugins: listPluginsMock }));
vi.mock('@/assets/onboarding/plugin-mode.svg?raw', () => ({
  default: '<svg data-testid="illustration"></svg>',
}));

import { PluginModeStep } from './PluginModeStep';

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  listPluginsMock.mockReset();
});

function render(): void {
  act(() => {
    root?.render(createElement(PluginModeStep));
  });
}

describe('PluginModeStep', () => {
  it('渲染插画（内联 SVG）', () => {
    listPluginsMock.mockReturnValue([]);
    render();
    expect(
      container?.querySelector('[data-slot="plugin-mode-illustration"] svg'),
    ).not.toBeNull();
  });

  it('为每个声明了 displayNameKey 的插件渲染一个图标格子，名称只作为无障碍标签', () => {
    listPluginsMock.mockReturnValue([
      { id: 'table', version: '1.0.0', displayNameKey: 'table.pluginName' },
      { id: 'math', version: '1.0.0', displayNameKey: 'math.pluginName' },
    ]);
    render();
    const tiles = Array.from(
      container!.querySelectorAll<HTMLElement>('[data-slot="plugin-tile"]'),
    );
    expect(tiles.length).toBe(2);
    expect(tiles[0]!.getAttribute('aria-label')).toBe('Table');
    expect(tiles[1]!.getAttribute('aria-label')).toBe('Math');
    expect(tiles[0]!.getAttribute('title')).toBe('Table');
    // 只渲染图标：不出现文字节点
    expect(container?.textContent).not.toContain('Table');
    expect(container?.querySelector('.plugin-mode-tile-name')).toBeNull();
  });

  it('跳过未声明 displayNameKey 的插件', () => {
    listPluginsMock.mockReturnValue([
      { id: 'table', version: '1.0.0', displayNameKey: 'table.pluginName' },
      { id: 'sample-without-name', version: '1.0.0' },
    ]);
    render();
    expect(container?.querySelectorAll('[data-slot="plugin-tile"]').length).toBe(1);
  });

  it('网格项按顺序写入 --i（用于错峰动画）', () => {
    listPluginsMock.mockReturnValue([
      { id: 'table', version: '1.0.0', displayNameKey: 'table.pluginName' },
      { id: 'math', version: '1.0.0', displayNameKey: 'math.pluginName' },
    ]);
    render();
    const tiles = Array.from(
      container!.querySelectorAll<HTMLElement>('[data-slot="plugin-tile"]'),
    );
    expect(tiles[0]!.style.getPropertyValue('--i')).toBe('0');
    expect(tiles[1]!.style.getPropertyValue('--i')).toBe('1');
  });

  it('浮动参数由插件 id 稳定派生（重渲染不变，非 Math.random）', () => {
    listPluginsMock.mockReturnValue([
      { id: 'table', version: '1.0.0', displayNameKey: 'table.pluginName' },
    ]);
    render();
    const tile = container!.querySelector<HTMLElement>('[data-slot="plugin-tile"]')!;
    const delay = tile.style.getPropertyValue('--float-delay');
    expect(delay).toMatch(/^[\d.]+s$/);
    expect(tile.style.getPropertyValue('--float-duration')).toMatch(/^[\d.]+s$/);
    expect(tile.style.getPropertyValue('--float-distance')).toMatch(/^\d+px$/);

    render();
    const again = container!.querySelector<HTMLElement>('[data-slot="plugin-tile"]')!;
    expect(again.style.getPropertyValue('--float-delay')).toBe(delay);
  });
});
