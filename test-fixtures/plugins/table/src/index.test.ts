import { describe, expect, it } from 'vitest';
import { MARKDOWN_EDITOR_EXTENSION, MARKDOWN_EDITOR_SYNTAX_FEATURE } from '@texto/markdown-editor-api';
import plugin from './index';

describe('table plugin manifest', () => {
  it('contributes a syntax feature and an editor insert extension', () => {
    expect(plugin.id).toBe('table');
    expect(plugin.defaultEnabled).toBe(true);
    expect(plugin.contributes?.[MARKDOWN_EDITOR_SYNTAX_FEATURE]?.[0]?.name).toBe('table');
    expect(plugin.contributes?.[MARKDOWN_EDITOR_EXTENSION]?.[0]?.insert?.id).toBe('table');
  });
});
