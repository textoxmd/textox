import { describe, expect, it } from 'vitest';
import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from '@texto/markdown-editor-api';

import plugin from './index';
import { emojiSyntaxFeature } from './syntax/feature';

describe('emoji plugin manifest', () => {
  it('contributes the emoji syntax feature', () => {
    expect(plugin.id).toBe('emoji');
    expect(plugin.defaultEnabled).toBe(true);
    expect(plugin.category).toBe('editor');
    expect(plugin.contributes?.[MARKDOWN_EDITOR_SYNTAX_FEATURE]?.[0]).toBe(emojiSyntaxFeature);
  });

  it('declares plugin card i18n keys', () => {
    expect(plugin.displayNameKey).toBe('emoji.pluginName');
    expect(plugin.descriptionKey).toBe('emoji.pluginDescription');
  });
});
