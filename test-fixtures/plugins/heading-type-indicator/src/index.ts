import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from '@texto/markdown-editor-api';
import { definePlugin, OFFICIAL_AUTHOR } from '@texto/plugin-sdk';

import { defaultLocale, locales } from './locales';
import { headingTypeIndicatorSyntaxFeature } from './syntax/feature';
import './heading-type-indicator.css';

export default definePlugin({
  id: 'heading-type-indicator',
  displayNameKey: 'heading-type-indicator.pluginName',
  descriptionKey: 'heading-type-indicator.pluginDescription',
  locales,
  defaultLocale,
  version: '1.0.0',
  author: OFFICIAL_AUTHOR,
  category: 'editor',
  icon: 'heading',
  defaultEnabled: true,
  contributes: {
    [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [headingTypeIndicatorSyntaxFeature],
  },
});
