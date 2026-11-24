import { beforeEach, describe, expect, it, vi } from 'vitest';

const { applyHighlightThemeMock } = vi.hoisted(() => ({ applyHighlightThemeMock: vi.fn() }));
vi.mock('../TextoEditor/src/highlight-theme', () => ({ applyHighlightTheme: applyHighlightThemeMock }));

import { applyCodeThemeFromCss } from '../styles/theme';

beforeEach(() => {
  applyHighlightThemeMock.mockClear();
});

describe('applyCodeThemeFromCss', () => {
  it('no longer applies a code highlight theme from --code-editor-theme-*', async () => {
    applyCodeThemeFromCss('default { --code-editor-theme-light: eclipse; --code-editor-theme-dark: dracula; }');
    // 旧实现经动态 import().then() 异步调用，等一拍再断言才能真正锁死。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(applyHighlightThemeMock).not.toHaveBeenCalled();
  });

  it('still broadcasts source-code theme changes', () => {
    const listener = vi.fn();
    window.addEventListener('codethemeschanged', listener as EventListener);
    applyCodeThemeFromCss('#writer { --source-code-theme-light: githubLight; --source-code-theme-dark: githubDark; }');
    window.removeEventListener('codethemeschanged', listener as EventListener);
    expect(listener).toHaveBeenCalledTimes(1);
    const detail = (listener.mock.calls[0]![0] as CustomEvent).detail as {
      sourceCodeThemeLight: string | null;
      sourceCodeThemeDark: string | null;
    };
    expect(detail.sourceCodeThemeLight).toBe('githubLight');
    expect(detail.sourceCodeThemeDark).toBe('githubDark');
  });
});
