import { APP_SETTINGS_SECTION } from '@texto/app-api';
import { MARKDOWN_EDITOR_EXTENSION } from '@texto/markdown-editor-api';
import { definePlugin, OFFICIAL_AUTHOR } from '@texto/plugin-sdk';

import { typingParticleEditorExtension } from './editor-extension';
import { defaultLocale, locales } from './locales';
import { createTypingParticleSettingsSection } from './settings';
import './typing-particle.css';

export default definePlugin({
  id: 'typing-particle',
  displayNameKey: 'typing-particle.pluginName',
  descriptionKey: 'typing-particle.pluginDescription',
  locales,
  defaultLocale,
  version: '1.0.0',
  author: OFFICIAL_AUTHOR,
  category: 'editor',
  icon: 'sparkles',
  defaultEnabled: false,
  settingsApply: 'immediate',
  contributes: {
    [MARKDOWN_EDITOR_EXTENSION]: [typingParticleEditorExtension],
    [APP_SETTINGS_SECTION]: [createTypingParticleSettingsSection()],
  },
});
