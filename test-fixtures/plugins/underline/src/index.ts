import {
  MARKDOWN_EDITOR_FORMAT_TOOLBAR,
  MARKDOWN_EDITOR_SYNTAX_FEATURE,
} from '@texto/markdown-editor-api';
import { definePlugin, OFFICIAL_AUTHOR } from '@texto/plugin-sdk';

import { underlineFormatItem } from './format-item';
import { defaultLocale, locales } from './locales';
import { underlineSyntaxFeature } from './syntax/feature';

export default definePlugin({
  id: 'underline',
  displayNameKey: 'underline.pluginName',
  descriptionKey: 'underline.pluginDescription',
  locales,
  defaultLocale,
  version: '1.0.0',
  author: OFFICIAL_AUTHOR,
  category: 'editor',
  icon: 'underline',
  defaultEnabled: true,
  contributes: {
    [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [underlineSyntaxFeature],
    [MARKDOWN_EDITOR_FORMAT_TOOLBAR]: [underlineFormatItem],
  },
});
