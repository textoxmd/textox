import {
  defineCodeBlockExtension,
  defineInsertExtension,
  MARKDOWN_EDITOR_CONTEXT_MENU,
  MARKDOWN_EDITOR_EXTENSION,
  MARKDOWN_EDITOR_SYNTAX_FEATURE,
} from '@texto/markdown-editor-api';
import { definePlugin, OFFICIAL_AUTHOR } from '@texto/plugin-sdk';

import { mathContextMenuItem } from './context-menu';
import { mathInsert } from './insert';
import { defaultLocale, locales } from './locales';
import { createMathPreview } from './math-renderer';
import { mathSyntaxFeature } from './syntax/feature';

const MATH_LANGUAGES = ['latex', 'math'];

export default definePlugin({
  id: 'math',
  displayNameKey: 'math.pluginName',
  descriptionKey: 'math.pluginDescription',
  locales,
  defaultLocale,
  version: '1.0.0',
  author: OFFICIAL_AUTHOR,
  category: 'editor',
  icon: 'sigma',
  defaultEnabled: true,
  settingsApply: 'immediate',
  contributes: {
    [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [mathSyntaxFeature],
    [MARKDOWN_EDITOR_EXTENSION]: [
      defineCodeBlockExtension({
        id: 'math.renderer',
        languages: MATH_LANGUAGES,
        createPreview: createMathPreview,
      }),
      defineInsertExtension({ id: 'math.insert', insert: mathInsert }),
    ],
    [MARKDOWN_EDITOR_CONTEXT_MENU]: [mathContextMenuItem],
  },
});
