import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from '@texto/markdown-editor-api';
import { definePlugin, OFFICIAL_AUTHOR } from '@texto/plugin-sdk';

import { defaultLocale, locales } from './locales';
import { subSupSyntaxFeature } from './syntax/feature';

export default definePlugin({
  id: 'sub-sup',
  displayNameKey: 'sub-sup.pluginName',
  descriptionKey: 'sub-sup.pluginDescription',
  locales,
  defaultLocale,
  version: '1.0.0',
  author: OFFICIAL_AUTHOR,
  category: 'editor',
  // Remix Icon `subscript-2`（24×24 填充 path，Apache-2.0）
  icon: 'superscript',
  defaultEnabled: true,
  contributes: {
    [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [subSupSyntaxFeature],
  },
});
