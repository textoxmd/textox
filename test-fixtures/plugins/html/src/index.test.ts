import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from '@texto/markdown-editor-api';
import { describe, expect, it } from 'vitest';

import plugin from './index';

describe('html plugin manifest', () => {
  it('declares its id and default-enabled state', () => {
    expect(plugin.id).toBe('html');
    expect(plugin.defaultEnabled).toBe(true);
  });

  it('contributes four syntax features including html-block', () => {
    const features = plugin.contributes?.[MARKDOWN_EDITOR_SYNTAX_FEATURE] ?? [];
    expect(features).toHaveLength(4);
    const block = features.find((f) => f.name === 'html-block');
    expect(block?.name).toBe('html-block');
    expect(features.map((f) => f.name)).toEqual([
      'html:md-config',
      'html-block',
      'html-inline',
      'html-comment',
    ]);
  });
});
