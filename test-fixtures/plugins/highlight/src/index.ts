import { APP_SETTINGS_SECTION } from '@texto/app-api';
import {
  MARKDOWN_EDITOR_FORMAT_TOOLBAR,
  MARKDOWN_EDITOR_SYNTAX_FEATURE,
} from '@texto/markdown-editor-api';
import { definePlugin, OFFICIAL_AUTHOR } from '@texto/plugin-sdk';

import './highlight.css';
import { highlightFormatItem } from './format-item';
import { defaultLocale, locales } from './locales';
import { applyHighlightColorStyle, highlightSettings } from './settings';
import { highlightSyntaxFeature } from './syntax/feature';

export default definePlugin({
  id: 'highlight',
  displayNameKey: 'highlight.pluginName',
  descriptionKey: 'highlight.pluginDescription',
  locales,
  defaultLocale,
  version: '1.0.0',
  author: OFFICIAL_AUTHOR,
  category: 'editor',
  icon: 'highlighter',
  defaultEnabled: true,
  settingsApply: 'immediate',
  contributes: {
    [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [highlightSyntaxFeature],
    [MARKDOWN_EDITOR_FORMAT_TOOLBAR]: [highlightFormatItem],
    [APP_SETTINGS_SECTION]: [highlightSettings],
  },
  async activate(host) {
    applyHighlightColorStyle(await host.config.getAll());
    host.config.subscribe((config) => applyHighlightColorStyle(config));
  },
});
