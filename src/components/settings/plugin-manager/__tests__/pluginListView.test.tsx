import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PluginManifest } from '@textox/plugin-sdk';

// 只用到 id 前缀判定；mock 掉运行时的其余部分，避免把 Tauri IPC / 启动链拖进单测。
vi.mock('@/plugins/runtime/index', () => ({
  isBuiltinPluginId: (pluginId: string) => pluginId.startsWith('app.textox.'),
}));

// 与生产 i18next 行为对齐：第二参传字符串即缺省文案，传对象时取 defaultValue 并做插值，
// 这样断言的是真实中文文案，而不是裸 key。
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

import { PluginListView, type PluginListViewProps } from '../PluginListView';
import type { RuntimeEntry } from '@/plugins/runtime/index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BUILTIN_ID = 'app.textox.hello';
const THIRD_PARTY_ID = 'io.github.acme.local';

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: BUILTIN_ID,
    name: 'Hello World',
    version: '1.0.0',
    minAppVersion: '2.3.8',
    description: 'Says hello to the world',
    author: { name: 'Textox' },
    ...overrides,
  };
}

function makeEntry(overrides: Partial<RuntimeEntry> = {}): RuntimeEntry {
  const id = overrides.id ?? BUILTIN_ID;
  return {
    id,
    dir: `/plugins/${id}`,
    manifest: makeManifest({ id }),
    enabled: false,
    error: null,
    status: 'installed',
    ...overrides,
  };
}

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
});

function baseProps(overrides: Partial<PluginListViewProps> = {}): PluginListViewProps {
  return {
    entries: [],
    seeded: undefined,
    safeMode: false,
    busyId: null,
    query: '',
    origin: 'all',
    importing: false,
    onQueryChange: vi.fn(),
    onOriginChange: vi.fn(),
    onOpen: vi.fn(),
    onToggle: vi.fn(),
    onDisableSafeMode: vi.fn(),
    onImport: vi.fn(),
    ...overrides,
  };
}

async function render(props: PluginListViewProps): Promise<HTMLElement> {
  await act(async () => {
    root?.render(<PluginListView {...props} />);
  });
  return container!;
}

function rows(view: HTMLElement): HTMLElement[] {
  return [...view.querySelectorAll('[data-slot="plugin-list-row"]')] as HTMLElement[];
}

function rowById(view: HTMLElement, id: string): HTMLElement {
  const row = view.querySelector(`[data-plugin-id="${id}"]`);
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

function checkboxIn(row: HTMLElement): HTMLElement {
  const toggle = row.querySelector('[data-slot="plugin-toggle"]');
  expect(toggle).not.toBeNull();
  return toggle as HTMLElement;
}

function text(view: HTMLElement): string {
  return view.textContent ?? '';
}

describe('PluginListView header', () => {
  it('renders names, versions, authors, origin badges and the enabled count', async () => {
    const seededEntry = makeEntry({ id: BUILTIN_ID, enabled: true });
    const userEntry = makeEntry({
      id: THIRD_PARTY_ID,
      enabled: true,
      manifest: makeManifest({ id: THIRD_PARTY_ID, name: 'Local Thing', author: { name: 'Acme' } }),
    });
    const disabledEntry = makeEntry({
      id: 'io.github.acme.off',
      manifest: makeManifest({ id: 'io.github.acme.off', name: 'Off Thing' }),
    });

    const view = await render(
      baseProps({
        entries: [seededEntry, userEntry, disabledEntry],
        seeded: { [BUILTIN_ID]: { version: '1.0.0', origin: 'seed' } },
      }),
    );

    expect(text(view)).toContain('已启用 2 / 3');
    expect(rows(view)).toHaveLength(3);

    const builtinRow = rowById(view, BUILTIN_ID);
    expect(builtinRow.textContent).toContain('Hello World');
    expect(builtinRow.textContent).toContain('v1.0.0 · Textox');
    expect(builtinRow.textContent).toContain('内置');

    const userRow = rowById(view, THIRD_PARTY_ID);
    expect(userRow.textContent).toContain('Local Thing');
    expect(userRow.textContent).toContain('v1.0.0 · Acme');
    expect(userRow.textContent).toContain('本地');
  });

  it('marks plugins that failed to load with a badge', async () => {
    const failed = makeEntry({ status: 'load-failed', errorMessage: 'onload timed out' });

    const view = await render(baseProps({ entries: [failed] }));

    expect(rowById(view, BUILTIN_ID).textContent).toContain('加载失败');
  });

  it('forwards the search query and import action', async () => {
    const props = baseProps({ entries: [makeEntry()] });
    const view = await render(props);

    const input = view.querySelector('[data-slot="plugin-search-input"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe('搜索插件');

    await act(async () => {
      // React 受控输入：直接赋值会被 value tracker 吞掉，必须走原生 setter 再派发 input
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, 'hello');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(props.onQueryChange).toHaveBeenCalledWith('hello');

    const importButton = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === '导入插件',
    ) as HTMLButtonElement;
    await act(async () => {
      importButton.click();
    });
    expect(props.onImport).toHaveBeenCalledTimes(1);
  });
});

describe('PluginListView filtering', () => {
  const entries = [
    makeEntry({ id: 'app.textox.alpha', manifest: makeManifest({ id: 'app.textox.alpha', name: 'Alpha', description: 'first helper' }) }),
    makeEntry({ id: 'app.textox.beta', manifest: makeManifest({ id: 'app.textox.beta', name: 'Beta', description: 'second helper' }) }),
  ];

  it('filters by id', async () => {
    const view = await render(baseProps({ entries, query: 'beta' }));

    expect(rows(view)).toHaveLength(1);
    expect(rowById(view, 'app.textox.beta')).not.toBeNull();
  });

  it('filters by manifest name (case insensitive)', async () => {
    const view = await render(baseProps({ entries, query: 'aLpHa' }));

    expect(rows(view)).toHaveLength(1);
    expect(rowById(view, 'app.textox.alpha')).not.toBeNull();
  });

  it('filters by manifest description', async () => {
    const view = await render(baseProps({ entries, query: 'second' }));

    expect(rows(view)).toHaveLength(1);
    expect(rowById(view, 'app.textox.beta')).not.toBeNull();
  });

  it('filters by origin and reports chip clicks', async () => {
    const props = baseProps({
      entries: [
        makeEntry({ id: BUILTIN_ID }),
        makeEntry({ id: THIRD_PARTY_ID, manifest: makeManifest({ id: THIRD_PARTY_ID }) }),
      ],
      seeded: { [BUILTIN_ID]: { version: '1.0.0', origin: 'seed' } },
      origin: 'user',
    });
    const view = await render(props);

    expect(rows(view)).toHaveLength(1);
    expect(rowById(view, THIRD_PARTY_ID)).not.toBeNull();

    const chips = [...view.querySelectorAll('[data-slot="plugin-origin-filter"] button')];
    expect(chips).toHaveLength(3);
    expect(chips.map((chip) => chip.textContent)).toEqual(['全部', '内置', '本地']);
    expect(chips[2].getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      (chips[1] as HTMLElement).click();
    });
    expect(props.onOriginChange).toHaveBeenCalledWith('seed');

    await act(async () => {
      (chips[0] as HTMLElement).click();
    });
    expect(props.onOriginChange).toHaveBeenCalledWith('all');
  });
});

describe('PluginListView safe mode', () => {
  it('shows the banner with a disable action while safe mode is on', async () => {
    const props = baseProps({ safeMode: true, entries: [makeEntry()] });
    const view = await render(props);

    const banner = view.querySelector('[data-slot="plugin-safe-mode-banner"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('安全模式已开启');
    expect(banner!.textContent).toContain('仅允许 Textox 官方插件运行，第三方插件无法启用');

    const disableButton = [...banner!.querySelectorAll('button')].find(
      (button) => button.textContent === '关闭安全模式',
    ) as HTMLButtonElement;
    expect(disableButton).not.toBeUndefined();
    await act(async () => {
      disableButton.click();
    });
    expect(props.onDisableSafeMode).toHaveBeenCalledTimes(1);
  });

  it('hides the banner while safe mode is off', async () => {
    const view = await render(baseProps({ safeMode: false, entries: [makeEntry()] }));

    expect(view.querySelector('[data-slot="plugin-safe-mode-banner"]')).toBeNull();
  });

  it('locks third-party toggles but keeps built-in ones usable', async () => {
    const view = await render(
      baseProps({
        safeMode: true,
        entries: [
          makeEntry({ id: BUILTIN_ID }),
          makeEntry({ id: THIRD_PARTY_ID, manifest: makeManifest({ id: THIRD_PARTY_ID }) }),
        ],
      }),
    );

    const thirdParty = checkboxIn(rowById(view, THIRD_PARTY_ID)) as HTMLButtonElement;
    expect(thirdParty.disabled).toBe(true);
    expect(thirdParty.getAttribute('title')).toContain('第三方插件无法启用');

    const builtin = checkboxIn(rowById(view, BUILTIN_ID)) as HTMLButtonElement;
    expect(builtin.disabled).toBe(false);
  });

  it('still allows disabling a third-party plugin that is already enabled', async () => {
    const view = await render(
      baseProps({
        safeMode: true,
        entries: [
          makeEntry({
            id: THIRD_PARTY_ID,
            enabled: true,
            manifest: makeManifest({ id: THIRD_PARTY_ID }),
          }),
        ],
      }),
    );

    expect((checkboxIn(rowById(view, THIRD_PARTY_ID)) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('PluginListView row interaction', () => {
  it('opens the detail view when the row is clicked or activated by keyboard', async () => {
    const props = baseProps({ entries: [makeEntry()] });
    const view = await render(props);
    const row = rowById(view, BUILTIN_ID);

    expect(row.getAttribute('role')).toBe('button');
    expect(row.tabIndex).toBe(0);

    await act(async () => {
      row.click();
    });
    expect(props.onOpen).toHaveBeenCalledWith(BUILTIN_ID);

    await act(async () => {
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(props.onOpen).toHaveBeenCalledTimes(2);

    await act(async () => {
      row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(props.onOpen).toHaveBeenCalledTimes(3);
  });

  it('toggles without opening the row when the pill button is clicked', async () => {
    const props = baseProps({ entries: [makeEntry({ enabled: true })] });
    const view = await render(props);

    await act(async () => {
      checkboxIn(rowById(view, BUILTIN_ID)).click();
    });

    expect(props.onOpen).not.toHaveBeenCalled();
    expect(props.onToggle).toHaveBeenCalledWith(BUILTIN_ID, false);
  });
});

describe('PluginListView empty states', () => {
  it('prompts to import when no plugin is installed', async () => {
    const view = await render(baseProps({ entries: [] }));

    expect(text(view)).toContain('尚未安装任何插件，点击「导入插件」添加。');
    expect(rows(view)).toHaveLength(0);
  });

  it('reports an empty search result separately', async () => {
    const view = await render(baseProps({ entries: [makeEntry()], query: 'nothing-matches' }));

    expect(text(view)).toContain('没有匹配的插件');
    expect(text(view)).not.toContain('尚未安装任何插件');
    expect(rows(view)).toHaveLength(0);
  });
});
