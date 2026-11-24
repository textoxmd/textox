import type { SyntaxFeature } from '@textox/plugin-sdk/markdown';

import type {
  EditorContextMenuItemMeta,
  EditorExtension,
  FormatToolbarItemMeta,
  SelectionActionMeta,
  SyntaxHighlightContribution,
} from './editor-types';

declare module './types' {
  interface ExtensionPointMap {
    'markdown-editor:extension': EditorExtension;
    'markdown-editor:syntaxFeature': SyntaxFeature;
    'markdown-editor:syntaxHighlight': SyntaxHighlightContribution;
    'markdown-editor:formatToolbar': FormatToolbarItemMeta;
    'markdown-editor:contextMenu': EditorContextMenuItemMeta;
    'markdown-editor:selectionAction': SelectionActionMeta;
  }
}

/** 编辑器扩展点 id；所有者 id 为 `markdown-editor`。 */
export const MARKDOWN_EDITOR_EXTENSION = 'markdown-editor:extension';

/** 编辑器语法功能扩展点 id；所有者 id 为 `markdown-editor`。 */
export const MARKDOWN_EDITOR_SYNTAX_FEATURE = 'markdown-editor:syntaxFeature';

/** 编辑器语法高亮扩展点 id；所有者 id 为 `markdown-editor`。 */
export const MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT = 'markdown-editor:syntaxHighlight';

/** 编辑器行内格式工具栏扩展点 id；所有者 id 为 `markdown-editor`。 */
export const MARKDOWN_EDITOR_FORMAT_TOOLBAR = 'markdown-editor:formatToolbar';

/** 编辑器正文右键菜单扩展点 id；所有者 id 为 `markdown-editor`。 */
export const MARKDOWN_EDITOR_CONTEXT_MENU = 'markdown-editor:contextMenu';

/** 编辑器选区动作扩展点 id；所有者 id 为 `markdown-editor`。 */
export const MARKDOWN_EDITOR_SELECTION_ACTION = 'markdown-editor:selectionAction';

/** 编辑器扩展点所有者 id。 */
export const MARKDOWN_EDITOR_OWNER = 'markdown-editor';

// 编辑器契约的类型与值（原 `@texto/markdown-editor-api` 的公开面）。
// 契约本体在作者包 `@textox/plugin-sdk`，此处只做转发；语法引擎类型从 `./markdown` 子路径转出。
export * from './editor-types';
export { CODE_HIGHLIGHT_THEMES, type CodeHighlightTheme } from './code-highlight-themes';
export type {
  SyntaxFeature,
  InlineFeatureSpec,
} from '@textox/plugin-sdk/markdown';
export type {
  SourcePreserveReconciler,
  SourcePreserveUnitSet,
  SourcePreserveCollected,
  BlockSpan,
} from '@textox/plugin-sdk/markdown';
export type {
  SourceVerbatimRegion,
  SourceVerbatimReconciler,
} from '@textox/plugin-sdk/markdown';
