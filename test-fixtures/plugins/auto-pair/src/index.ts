import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from '@texto/markdown-editor-api';
import { definePlugin, OFFICIAL_AUTHOR } from '@texto/plugin-sdk';

import { defaultLocale, locales } from './locales';
import { autoPairSyntaxFeature } from './syntax/feature';

export default definePlugin({
  id: 'auto-pair',
  displayNameKey: 'auto-pair.pluginName',
  descriptionKey: 'auto-pair.pluginDescription',
  locales,
  defaultLocale,
  version: '1.0.0',
  author: OFFICIAL_AUTHOR,
  category: 'editor',
  icon: 'brackets',
  defaultEnabled: true,
  contributes: {
    [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [autoPairSyntaxFeature],
  },
});
