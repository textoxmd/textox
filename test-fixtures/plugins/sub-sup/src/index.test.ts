import { describe, expect, it } from 'vitest';
import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from '@texto/markdown-editor-api';

import plugin from './index';
import { subSupSyntaxFeature } from './syntax/feature';

describe('sub-sup plugin manifest', () => {
  it('contributes the sub-sup syntax feature', () => {
    expect(plugin.id).toBe('sub-sup');
    expect(plugin.defaultEnabled).toBe(true);
    expect(plugin.category).toBe('editor');
    expect(plugin.contributes?.[MARKDOWN_EDITOR_SYNTAX_FEATURE]?.[0]).toBe(subSupSyntaxFeature);
  });

  it('declares plugin card i18n keys', () => {
    expect(plugin.displayNameKey).toBe('sub-sup.pluginName');
    expect(plugin.descriptionKey).toBe('sub-sup.pluginDescription');
  });
});
