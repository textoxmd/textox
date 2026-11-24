import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(null));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  compactThemeQuickSettings,
  hasThemeQuickSettings,
  loadThemeQuickSettings,
  quickSettingsToCss,
  resetThemeQuickSettingsCacheForTests,
  saveThemeQuickSettings,
} from './theme-quick-settings';

beforeEach(() => {
  invokeMock.mockReset();
  resetThemeQuickSettingsCacheForTests();
  vi.useRealTimers();
});

describe('theme quick settings cache', () => {
  it('dedupes concurrent loads for the same theme', async () => {
    invokeMock.mockResolvedValue({ breatheLight: 'red' });

    const [a, b] = await Promise.all([
      loadThemeQuickSettings('default'),
      loadThemeQuickSettings('default'),
    ]);

    expect(a).toEqual({ breatheLight: 'red' });
    expect(b).toEqual(a);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('get_theme_quick_settings', {
      themeId: 'default',
    });
  });

  it('serves the cache within TTL and refetches after it', async () => {
    vi.useFakeTimers();
    invokeMock
      .mockResolvedValueOnce({ breatheLight: 'red' })
      .mockResolvedValueOnce({ breatheLight: 'blue' });

    expect(await loadThemeQuickSettings('default')).toEqual({ breatheLight: 'red' });
    expect(await loadThemeQuickSettings('default')).toEqual({ breatheLight: 'red' });
    expect(invokeMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1001);
    expect(await loadThemeQuickSettings('default')).toEqual({ breatheLight: 'blue' });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('invalidates a theme after saving', async () => {
    invokeMock
      .mockResolvedValueOnce({ breatheLight: 'red' })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ breatheLight: 'green' });

    await loadThemeQuickSettings('default');
    await saveThemeQuickSettings('default', { breatheLight: 'green' });
    expect(await loadThemeQuickSettings('default')).toEqual({ breatheLight: 'green' });
    expect(invokeMock).toHaveBeenCalledWith('set_theme_quick_settings', {
      themeId: 'default',
      settings: { breatheLight: 'green' },
    });
  });

  it('keeps themes isolated', async () => {
    invokeMock
      .mockResolvedValueOnce({ breatheLight: 'red' })
      .mockResolvedValueOnce({ breatheLight: 'blue' });

    expect(await loadThemeQuickSettings('default')).toEqual({ breatheLight: 'red' });
    expect(await loadThemeQuickSettings('pastel')).toEqual({ breatheLight: 'blue' });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});

describe('quickSettingsToCss', () => {
  it('returns empty css when nothing is configured', () => {
    expect(quickSettingsToCss({})).toBe('')
    expect(hasThemeQuickSettings({})).toBe(false)
    expect(hasThemeQuickSettings(null)).toBe(false)
  });

  it('maps every field to its css selector and variable', () => {
    const css = quickSettingsToCss({
      breatheLight: 'oklch(0.646 0.222 41.116)',
      breatheDark: 'oklch(0.715 0.152 253.3)',
      sourceCodeThemeLight: 'oneDark',
      sourceCodeThemeDark: 'vscodeDark',
    })

    expect(css).toContain(':root {')
    expect(css).toContain('--breathe-color: oklch(0.646 0.222 41.116);')
    expect(css).toContain('.dark {')
    expect(css).toContain('--breathe-color: oklch(0.715 0.152 253.3);')
    expect(css).toContain('#writer {')
    expect(css).not.toContain('--code-editor-theme-light')
    expect(css).not.toContain('--code-editor-theme-dark')
    expect(css).toContain('--source-code-theme-light: oneDark;')
    expect(css).toContain('--source-code-theme-dark: vscodeDark;')
  })

  it('ignores null/undefined fields', () => {
    const css = quickSettingsToCss({
      breatheLight: null,
      sourceCodeThemeLight: 'oneDark',
    })
    expect(css).toContain('--source-code-theme-light')
    expect(css).not.toContain('--breathe-color')
    expect(css).not.toContain('--code-editor-theme-light')
  })

  it('strips null/undefined entries so css defaults are not hidden', () => {
    const compacted = compactThemeQuickSettings({
      breatheLight: null,
      breatheDark: undefined,
      sourceCodeThemeLight: 'oneDark',
    })
    expect(compacted).toEqual({ sourceCodeThemeLight: 'oneDark' })
    expect(compactThemeQuickSettings(null)).toEqual({})
  })
})
