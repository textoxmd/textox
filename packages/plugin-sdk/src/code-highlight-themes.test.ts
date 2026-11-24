import { describe, expect, it } from 'vitest';

import { CODE_HIGHLIGHT_THEMES } from './code-highlight-themes';

describe('CODE_HIGHLIGHT_THEMES', () => {
  it('exposes 15 unique themes with 7 light and 8 dark', () => {
    expect(CODE_HIGHLIGHT_THEMES).toHaveLength(15);
    const values = CODE_HIGHLIGHT_THEMES.map((t) => t.value);
    expect(new Set(values).size).toBe(values.length);
    expect(CODE_HIGHLIGHT_THEMES.filter((t) => !t.isDark)).toHaveLength(7);
    expect(CODE_HIGHLIGHT_THEMES.filter((t) => t.isDark)).toHaveLength(8);
  });

  it('includes the defaults used by the highlight plugin', () => {
    const values = CODE_HIGHLIGHT_THEMES.map((t) => t.value);
    expect(values).toContain('githubLight');
    expect(values).toContain('vscodeDark');
    for (const theme of CODE_HIGHLIGHT_THEMES) expect(theme.label).not.toBe('');
  });
});
