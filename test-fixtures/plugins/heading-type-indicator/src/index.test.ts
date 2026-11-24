import { describe, expect, it } from 'vitest';
import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from '@texto/markdown-editor-api';

import plugin from './index';
import { headingTypeIndicatorSyntaxFeature } from './syntax/feature';

describe('heading-type-indicator plugin manifest', () => {
  it('contributes the heading-type-indicator syntax feature', () => {
    expect(plugin.id).toBe('heading-type-indicator');
    expect(plugin.defaultEnabled).toBe(true);
    expect(plugin.category).toBe('editor');
    expect(plugin.contributes?.[MARKDOWN_EDITOR_SYNTAX_FEATURE]?.[0]).toBe(
      headingTypeIndicatorSyntaxFeature,
    );
  });

  it('declares plugin card i18n keys', () => {
    expect(plugin.displayNameKey).toBe('heading-type-indicator.pluginName');
    expect(plugin.descriptionKey).toBe('heading-type-indicator.pluginDescription');
  });
});
