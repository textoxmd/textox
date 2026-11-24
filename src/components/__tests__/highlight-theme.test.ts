import { describe, expect, it } from 'vitest';
import { CODE_HIGHLIGHT_THEMES } from '@texto/markdown-editor-api';

import { THEME_CSS_LOADERS } from '../TextoEditor/src/highlight-theme';

describe('highlight theme catalog', () => {
  it('has a CSS entry (key) for every catalog theme', () => {
    // 测试环境对 `.css?raw` 可能返回空串，故断言“键存在”而非内容真值。
    const keys = new Set(Object.keys(THEME_CSS_LOADERS));
    for (const theme of CODE_HIGHLIGHT_THEMES) {
      expect(keys.has(theme.value), `no CSS entry for ${theme.value}`).toBe(true);
    }
  });

  it('has no extra CSS entry absent from the catalog', () => {
    const catalog = new Set(CODE_HIGHLIGHT_THEMES.map((t) => t.value));
    for (const key of Object.keys(THEME_CSS_LOADERS)) {
      expect(catalog.has(key), `extra CSS entry ${key}`).toBe(true);
    }
  });
});
