import { APP_SETTINGS_SECTION } from '@texto/app-api';
import { MARKDOWN_EDITOR_SELECTION_ACTION } from '@texto/markdown-editor-api';
import { definePlugin, OFFICIAL_AUTHOR } from '@texto/plugin-sdk';

import { bindHost, selectionActions } from './actions';
import { locales } from './locales';
import { createSettingsSection } from './settings';

export default definePlugin({
  id: 'ai-explain',
  displayNameKey: 'ai-explain.pluginName',
  descriptionKey: 'ai-explain.pluginDescription',
  version: '0.1.0',
  author: OFFICIAL_AUTHOR,
  defaultEnabled: false,
  icon: 'book-open-text',
  category: 'llm',
  locales,
  defaultLocale: 'en-US',
  settingsApply: 'immediate',
  activate(host) {
    bindHost(host);
  },
  contributes: {
    [MARKDOWN_EDITOR_SELECTION_ACTION]: selectionActions,
    [APP_SETTINGS_SECTION]: [createSettingsSection()],
  },
});
