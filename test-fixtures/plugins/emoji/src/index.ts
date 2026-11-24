import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from '@texto/markdown-editor-api';
import { definePlugin, OFFICIAL_AUTHOR } from '@texto/plugin-sdk';

import { defaultLocale, locales } from './locales';
import { emojiSyntaxFeature } from './syntax/feature';
import './emoji.css';

export default definePlugin({
  id: 'emoji',
  displayNameKey: 'emoji.pluginName',
  descriptionKey: 'emoji.pluginDescription',
  locales,
  defaultLocale,
  version: '1.0.0',
  author: OFFICIAL_AUTHOR,
  category: 'editor',
  icon: 'smile',
  defaultEnabled: true,
  contributes: {
    [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [emojiSyntaxFeature],
  },
});
