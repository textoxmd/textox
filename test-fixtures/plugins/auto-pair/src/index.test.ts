import { describe, expect, it } from 'vitest';
import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from '@texto/markdown-editor-api';

import plugin from './index';
import { autoPairSyntaxFeature } from './syntax/feature';

describe('auto-pair plugin manifest', () => {
  it('contributes the auto-pair syntax feature', () => {
    expect(plugin.id).toBe('auto-pair');
    expect(plugin.defaultEnabled).toBe(true);
    expect(plugin.category).toBe('editor');
    expect(plugin.contributes?.[MARKDOWN_EDITOR_SYNTAX_FEATURE]?.[0]).toBe(autoPairSyntaxFeature);
  });

  it('declares plugin card i18n keys', () => {
    expect(plugin.displayNameKey).toBe('auto-pair.pluginName');
    expect(plugin.descriptionKey).toBe('auto-pair.pluginDescription');
  });
});
