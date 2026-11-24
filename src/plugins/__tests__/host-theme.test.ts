import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, applyHighlightThemeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async () => ({})),
  applyHighlightThemeMock: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'main' }) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn(), open: vi.fn() }));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock('@/i18n', () => ({ default: { t: (k: string) => k, language: 'en' } }));
// 根 vitest 配置默认把 `.css?raw` 处理为空串（真实 highlight-theme 因此提前 return），
// 这里只替身注入点，断言宿主选择并传入了正确的亮/暗主题，不改生产代码。
vi.mock('@/components/TextoEditor/src/highlight-theme', () => ({
  applyHighlightTheme: applyHighlightThemeMock,
}));

import { resetThemeQuickSettingsCacheForTests } from '@/components/styles/theme-quick-settings';

import { createPluginHost, NOOP_HOST_DEPS } from '../host';

beforeEach(() => {
  resetThemeQuickSettingsCacheForTests();
  document.documentElement.classList.remove('dark');
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({});
  applyHighlightThemeMock.mockClear();
});

describe('host.theme.applyCodeHighlightTheme', () => {
  it('applies the light theme when not in dark mode', () => {
    createPluginHost(NOOP_HOST_DEPS, 'syntax-highlight').theme.applyCodeHighlightTheme(
      'githubLight',
      'githubDark',
    );
    expect(applyHighlightThemeMock).toHaveBeenCalledWith('githubLight');
  });

  it('applies the dark theme when the .dark class is set', () => {
    document.documentElement.classList.add('dark');
    createPluginHost(NOOP_HOST_DEPS, 'syntax-highlight').theme.applyCodeHighlightTheme(
      'githubLight',
      'githubDark',
    );
    expect(applyHighlightThemeMock).toHaveBeenCalledWith('githubDark');
  });

  it('does not call the applier when the selected theme is empty', () => {
    createPluginHost(NOOP_HOST_DEPS, 'syntax-highlight').theme.applyCodeHighlightTheme('', '');
    expect(applyHighlightThemeMock).not.toHaveBeenCalled();
  });
});

describe('host.theme.codeHighlightThemeDefaults', () => {
  it('reads legacy quick-settings keys', async () => {
    invokeMock.mockResolvedValue({ codeEditorThemeLight: 'eclipse', codeEditorThemeDark: 'dracula' });
    const result = await createPluginHost(
      NOOP_HOST_DEPS,
      'syntax-highlight',
    ).theme.codeHighlightThemeDefaults();
    expect(result).toEqual({ light: 'eclipse', dark: 'dracula' });
  });

  it('returns empty when nothing stored', async () => {
    invokeMock.mockResolvedValue({});
    const result = await createPluginHost(
      NOOP_HOST_DEPS,
      'syntax-highlight',
    ).theme.codeHighlightThemeDefaults();
    expect(result).toEqual({ light: undefined, dark: undefined });
  });

  it('treats stored empty strings as unset', async () => {
    invokeMock.mockResolvedValue({ codeEditorThemeLight: '', codeEditorThemeDark: '' });
    const result = await createPluginHost(
      NOOP_HOST_DEPS,
      'syntax-highlight',
    ).theme.codeHighlightThemeDefaults();
    expect(result).toEqual({ light: undefined, dark: undefined });
  });
});
