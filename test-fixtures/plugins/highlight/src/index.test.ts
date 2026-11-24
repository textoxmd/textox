import { describe, expect, it } from 'vitest';
import { APP_SETTINGS_SECTION } from '@texto/app-api';
import {
  MARKDOWN_EDITOR_FORMAT_TOOLBAR,
  MARKDOWN_EDITOR_SYNTAX_FEATURE,
} from '@texto/markdown-editor-api';

import plugin from './index';
import { highlightFormatItem } from './format-item';
import { highlightSettings } from './settings';
import { highlightSyntaxFeature } from './syntax/feature';

describe('highlight plugin manifest', () => {
  it('contributes syntax, format toolbar, and settings', () => {
    expect(plugin.id).toBe('highlight');
    expect(plugin.defaultEnabled).toBe(true);
    expect(plugin.category).toBe('editor');
    expect(plugin.settingsApply).toBe('immediate');
    expect(plugin.contributes?.[MARKDOWN_EDITOR_SYNTAX_FEATURE]?.[0]).toBe(
      highlightSyntaxFeature,
    );
    expect(plugin.contributes?.[MARKDOWN_EDITOR_FORMAT_TOOLBAR]?.[0]).toBe(highlightFormatItem);
    expect(plugin.contributes?.[APP_SETTINGS_SECTION]?.[0]).toBe(highlightSettings);
  });
});
