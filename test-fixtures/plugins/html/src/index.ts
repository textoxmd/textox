import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from '@texto/markdown-editor-api';
import { definePlugin, OFFICIAL_AUTHOR } from '@texto/plugin-sdk';

import { defaultLocale, locales } from './locales';
import { htmlBlock } from './syntax/block';
import { htmlComment } from './syntax/comment';
import { htmlInline } from './syntax/inline';
import { htmlMdConfig } from './syntax/md-config';

export default definePlugin({
  id: 'html',
  displayNameKey: 'html.pluginName',
  descriptionKey: 'html.pluginDescription',
  locales,
  defaultLocale,
  version: '1.0.0',
  author: OFFICIAL_AUTHOR,
  category: 'editor',
  icon: 'braces',
  defaultEnabled: true,
  settingsApply: 'immediate',
  contributes: {
    [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [htmlMdConfig, htmlBlock, htmlInline, htmlComment],
  },
});
