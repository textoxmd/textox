import type { EditorContextMenuItemMeta } from '@texto/markdown-editor-api';

import { copySelectionAsHtml, copySelectionAsMarkdown } from './copy-actions.ts';

/**
 * 编辑器内置的正文右键菜单项。
 * 与插件贡献项同用 `EditorContextMenuItemMeta` 形状，走同一条装配路径。
 */
export const CORE_CONTEXT_MENU_ITEMS: EditorContextMenuItemMeta[] = [
  {
    id: 'copy',
    labelKey: 'contextMenu.copy',
    order: 0,
    enabled: (ctx) => ctx.hasSelection,
    run: (ctx) => copySelectionAsMarkdown(ctx.view),
  },
  {
    id: 'copy-html',
    labelKey: 'contextMenu.copyAsHtml',
    order: 1,
    enabled: (ctx) => ctx.hasSelection,
    run: (ctx) => copySelectionAsHtml(ctx.view),
  },
];
