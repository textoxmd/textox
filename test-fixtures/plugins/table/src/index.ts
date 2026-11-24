import { MARKDOWN_EDITOR_EXTENSION, MARKDOWN_EDITOR_SYNTAX_FEATURE } from '@texto/markdown-editor-api';
import { definePlugin, OFFICIAL_AUTHOR } from '@texto/plugin-sdk';

import { tableInsert } from './insert';
import { defaultLocale, locales } from './locales';
import { lazyTableToolbarPlugin } from './view/lazy';
import { tableFeature } from './syntax/feature';

export default definePlugin({
  id: 'table',
  displayNameKey: 'table.pluginName',
  descriptionKey: 'table.pluginDescription',
  locales,
  defaultLocale,
  version: '1.0.0',
  author: OFFICIAL_AUTHOR,
  category: 'editor',
  icon: 'table',
  defaultEnabled: true,
  settingsApply: 'immediate',
  contributes: {
    [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [tableFeature],
    [MARKDOWN_EDITOR_EXTENSION]: [
      {
        id: 'table.editor',
        insert: tableInsert,
        create() {
          // 悬浮工具栏懒加载：lazy.ts 只依赖 prosemirror-state（进主
          // bundle），view/toolbar.ts（React + 图标 + CSS）在 view() 时
          // 才动态 import。
          return { plugins: [lazyTableToolbarPlugin()] };
        },
      },
    ],
  },
});
