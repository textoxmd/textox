import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SettingsField } from '@texto/plugin-sdk';
import type { PluginManifest } from '@textox/plugin-sdk';

const { runManifestActionMock, capturedProps } = vi.hoisted(() => ({
  runManifestActionMock: vi.fn(async () => true),
  capturedProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/plugins/runtime/app', () => ({ runManifestAction: runManifestActionMock }));

// 用桩替换字段渲染器：只验证「透传了什么」，字段控件本身另有单测。
vi.mock('@/components/settings/PluginSettingsFields', () => ({
  PluginSettingsFields: (props: Record<string, unknown>) => {
    capturedProps.push(props);
    return <div data-slot="plugin-settings-fields-stub" />;
  },
}));

// 与生产 i18next 行为对齐：第二参传字符串即缺省文案，传对象时取 defaultValue 并做插值。
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

import { PluginDetailView, type PluginDetailViewProps } from '../PluginDetailView';
import type { PluginSettingsApi } from '../usePluginSettings';
import type { RuntimeEntry } from '@/plugins/runtime/index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = 'app.textox.hello';

function makeEntry(overrides: Partial<RuntimeEntry> = {}): RuntimeEntry {
  const manifest: PluginManifest = {
    id: ID,
    name: 'Hello World',
    version: '2.1.0',
    minAppVersion: '2.3.8',
    description: 'Says hello to the world',
    author: { name: 'Textox' },
  };
  return {
    id: ID,
    dir: `/plugins/${ID}`,
    manifest,
    enabled: true,
    error: null,
    status: 'enabled',
    ...overrides,
  };
}

function makeSettings(overrides: Partial<PluginSettingsApi> = {}): PluginSettingsApi {
  return {
    fields: [],
    values: {},
    setValue: vi.fn(async () => true),
    setPatch: vi.fn(async () => true),
    resetToDefaults: vi.fn(async () => true),
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  capturedProps.length = 0;
  runManifestActionMock.mockClear();
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

function baseProps(overrides: Partial<PluginDetailViewProps> = {}): PluginDetailViewProps {
  return {
    entry: makeEntry(),
    origin: 'seed',
    settings: makeSettings(),
    busy: false,
    onBack: vi.fn(),
    onToggle: vi.fn(),
    onRestore: vi.fn(),
    onResetSettings: vi.fn(),
    onUninstall: vi.fn(),
    ...overrides,
  };
}

async function render(props: PluginDetailViewProps): Promise<HTMLElement> {
  await act(async () => {
    root?.render(<PluginDetailView {...props} />);
  });
  return container!;
}

function buttonWithText(view: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...view.querySelectorAll('button')].find(
    (button) => button.textContent === label,
  ) as HTMLButtonElement | undefined;
}

const BOOLEAN_FIELD: SettingsField = {
  type: 'boolean',
  key: 'shout',
  default: false,
  labelKey: 'shout',
};

const RESTART_FIELD: SettingsField = {
  type: 'boolean',
  key: 'needsRestart',
  default: false,
  labelKey: 'needsRestart',
  apply: 'restart',
};

describe('PluginDetailView header', () => {
  it('renders name, origin badge, version and author, and navigates back', async () => {
    const props = baseProps();
    const view = await render(props);

    expect(view.textContent).toContain('Hello World');
    expect(view.textContent).toContain('内置');
    expect(view.textContent).toContain('v2.1.0 · Textox');
    expect(view.textContent).toContain('Says hello to the world');

    const back = view.querySelector('[data-slot="plugin-detail-back"]') as HTMLButtonElement;
    expect(back).not.toBeNull();
    // 圆形图标按钮：不带文字，可访问名走 aria-label
    expect(back.textContent).toBe('');
    expect(back.getAttribute('aria-label')).toBe('返回已安装插件');
    await act(async () => {
      back.click();
    });
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it('toggles through the header checkbox without navigating back', async () => {
    const props = baseProps();
    const view = await render(props);

    const checkbox = view.querySelector('[data-slot="checkbox"]') as HTMLElement;
    expect(checkbox).not.toBeNull();
    await act(async () => {
      checkbox.click();
    });

    expect(props.onToggle).toHaveBeenCalledWith(false);
    expect(props.onBack).not.toHaveBeenCalled();
  });

  it('locks the header toggle for a third-party plugin blocked by safe mode', async () => {
    const view = await render(
      baseProps({
        locked: true,
        entry: makeEntry({ enabled: false }),
      }),
    );

    const checkbox = view.querySelector('[data-slot="checkbox"]') as HTMLElement;
    expect(checkbox.hasAttribute('disabled') || checkbox.hasAttribute('data-disabled')).toBe(true);
  });

  it('keeps the header toggle usable when the plugin is already enabled', async () => {
    const view = await render(baseProps({ locked: true, entry: makeEntry({ enabled: true }) }));

    const checkbox = view.querySelector('[data-slot="checkbox"]') as HTMLElement;
    expect(checkbox.hasAttribute('disabled')).toBe(false);
  });

  it('surfaces the load failure message in danger colour', async () => {
    const view = await render(
      baseProps({ entry: makeEntry({ status: 'load-failed', errorMessage: 'onload timed out' }) }),
    );

    const error = view.querySelector('[data-slot="plugin-detail-error"]');
    expect(error).not.toBeNull();
    expect(error!.textContent).toContain('onload timed out');
    expect(error!.className).toContain('text-destructive');
  });
});

describe('PluginDetailView settings', () => {
  it('renders the fields renderer and forwards changes to setValue', async () => {
    const settings = makeSettings({ fields: [BOOLEAN_FIELD], values: { shout: false } });
    const view = await render(baseProps({ settings }));

    expect(view.querySelector('[data-slot="plugin-settings-fields-stub"]')).not.toBeNull();
    expect(capturedProps).toHaveLength(1);
    const passed = capturedProps[0];
    expect(passed.fields).toEqual([BOOLEAN_FIELD]);
    expect(passed.allFields).toEqual([BOOLEAN_FIELD]);
    expect(passed.values).toEqual({ shout: false });
    expect(passed.disabled).toBe(false);
    expect(typeof passed.t).toBe('function');

    await act(async () => {
      (passed.onChange as (key: string, value: unknown) => void)('shout', true);
    });
    expect(settings.setValue).toHaveBeenCalledWith(ID, 'shout', true);

    await act(async () => {
      (passed.onChangePatch as (patch: Record<string, unknown>) => void)({ shout: false });
    });
    expect(settings.setPatch).toHaveBeenCalledWith(ID, { shout: false });

    await act(async () => {
      (passed.onAction as (field: SettingsField) => void)(BOOLEAN_FIELD);
    });
    expect(runManifestActionMock).toHaveBeenCalledWith(ID, BOOLEAN_FIELD);
  });

  it('disables the fields renderer while a request is pending', async () => {
    await render(baseProps({ settings: makeSettings({ fields: [BOOLEAN_FIELD] }), busy: true }));

    expect(capturedProps[0].disabled).toBe(true);
  });

  it('shows the restart hint above the fields when a restart field exists', async () => {
    const view = await render(
      baseProps({ settings: makeSettings({ fields: [RESTART_FIELD, BOOLEAN_FIELD] }) }),
    );

    const hint = view.querySelector('[data-slot="plugin-settings-restart"]');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toBe('此插件的设置需重启应用后生效');
    expect(hint!.parentElement?.getAttribute('data-slot')).toBe('plugin-detail-settings');
    expect(hint!.parentElement?.firstElementChild).toBe(hint);
  });

  it('omits the restart hint when every field applies immediately', async () => {
    const view = await render(baseProps({ settings: makeSettings({ fields: [BOOLEAN_FIELD] }) }));

    expect(view.querySelector('[data-slot="plugin-settings-restart"]')).toBeNull();
  });

  it('omits the settings card entirely when the plugin declares no field', async () => {
    const view = await render(baseProps());

    expect(view.querySelector('[data-slot="plugin-settings-fields-stub"]')).toBeNull();
    expect(view.textContent).not.toContain('设置');
  });
});

describe('PluginDetailView actions', () => {
  it('offers reinstall only for a bundled plugin overridden by a local copy', async () => {
    const props = baseProps({ origin: 'user', canReinstall: true });
    const view = await render(props);

    expect(buttonWithText(view, '重装内置版本')).not.toBeUndefined();

    await act(async () => {
      buttonWithText(view, '重装内置版本')!.click();
    });
    expect(props.onRestore).toHaveBeenCalledTimes(1);
  });

  it('hides reinstall for a plain factory plugin', async () => {
    const view = await render(baseProps({ origin: 'seed' }));
    expect(buttonWithText(view, '重装内置版本')).toBeUndefined();
  });

  it('keeps "restore default settings" disabled until a value differs from its default', async () => {
    const fields: SettingsField[] = [
      { type: 'boolean', key: 'enabledFeature', labelKey: 'x', default: true },
    ];
    const clean = baseProps({
      settings: makeSettings({ fields, values: {} }),
    });
    const dirty = baseProps({
      settings: makeSettings({ fields, values: { enabledFeature: false } }),
    });

    const cleanView = await render(clean);
    const cleanButton = buttonWithText(cleanView, '恢复默认设置') as HTMLButtonElement;
    expect(cleanButton.disabled).toBe(true);

    const dirtyView = await render(dirty);
    const dirtyButton = buttonWithText(dirtyView, '恢复默认设置') as HTMLButtonElement;
    expect(dirtyButton.disabled).toBe(false);
    await act(async () => {
      dirtyButton.click();
    });
    expect(dirty.onResetSettings).toHaveBeenCalledTimes(1);
  });

  it('offers uninstall for a locally imported plugin and nothing else', async () => {
    const props = baseProps({ origin: 'user' });
    const view = await render(props);

    expect(buttonWithText(view, '卸载')).not.toBeUndefined();
    expect(buttonWithText(view, '重装内置版本')).toBeUndefined();

    await act(async () => {
      buttonWithText(view, '卸载')!.click();
    });
    expect(props.onUninstall).toHaveBeenCalledTimes(1);
    expect(props.onRestore).not.toHaveBeenCalled();
  });

  it('only notifies the container: confirmations are not handled here', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const props = baseProps({ origin: 'user' });
    const view = await render(props);

    try {
      await act(async () => {
        buttonWithText(view, '卸载')!.click();
      });
      expect(confirm).not.toHaveBeenCalled();
      expect(props.onUninstall).toHaveBeenCalledTimes(1);
    } finally {
      confirm.mockRestore();
    }
  });
});
