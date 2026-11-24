import { describe, expect, it } from 'vitest';
import {
  MARKDOWN_EDITOR_FORMAT_TOOLBAR,
  MARKDOWN_EDITOR_SYNTAX_FEATURE,
} from '@texto/markdown-editor-api';

import plugin from './index';
import { underlineFormatItem } from './format-item';
import { underlineSyntaxFeature } from './syntax/feature';

describe('underline plugin manifest', () => {
  it('contributes the underline syntax feature and format toolbar item', () => {
    expect(plugin.id).toBe('underline');
    expect(plugin.defaultEnabled).toBe(true);
    expect(plugin.category).toBe('editor');
    expect(plugin.contributes?.[MARKDOWN_EDITOR_SYNTAX_FEATURE]?.[0]).toBe(underlineSyntaxFeature);
    expect(plugin.contributes?.[MARKDOWN_EDITOR_FORMAT_TOOLBAR]?.[0]).toBe(underlineFormatItem);
  });
});
