import { describe, expect, it } from 'vitest';

import {
  MARKDOWN_EDITOR_CONTEXT_MENU,
  MARKDOWN_EDITOR_EXTENSION,
  MARKDOWN_EDITOR_FORMAT_TOOLBAR,
  MARKDOWN_EDITOR_OWNER,
  MARKDOWN_EDITOR_SELECTION_ACTION,
  MARKDOWN_EDITOR_SYNTAX_FEATURE,
  MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT,
  contextMenuItemAppliesTo,
  formatToolbarItemIncludesSurface,
  parseEmbedRef,
} from './editor';
import type { EditorContextMenuItemMeta, FormatToolbarItemMeta, InsertCommandMeta } from './editor';

describe('editor contract', () => {
  it('exposes the same point ids as before', () => {
    expect(MARKDOWN_EDITOR_SYNTAX_FEATURE).toBe('markdown-editor:syntaxFeature');
  });

  it('parses embed refs', () => {
    expect(parseEmbedRef('![alt](a.png "t")')).toMatchObject({ src: 'a.png', alt: 'alt' });
  });

  it('matches toolbar surfaces', () => {
    const item: FormatToolbarItemMeta = {
      id: 'demo.item',
      markName: 'demo',
      delim: '<demo>',
      labelKey: 'demo.label',
      icon: [['path', 'M0 0h1v1H0z']],
      surfaces: ['floating'],
    };
    expect(formatToolbarItemIncludesSurface(item, 'floating')).toBe(true);
    expect(formatToolbarItemIncludesSurface(item, 'toolbar')).toBe(false);
  });
});

// 字面量对照表：不引用常量本身，避免「常量等于自己」的恒真断言。
it('keeps the six extension point ids and the owner id stable', () => {
  const expected = {
    extension: [MARKDOWN_EDITOR_EXTENSION, 'markdown-editor:extension'],
    syntaxFeature: [MARKDOWN_EDITOR_SYNTAX_FEATURE, 'markdown-editor:syntaxFeature'],
    syntaxHighlight: [MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT, 'markdown-editor:syntaxHighlight'],
    formatToolbar: [MARKDOWN_EDITOR_FORMAT_TOOLBAR, 'markdown-editor:formatToolbar'],
    contextMenu: [MARKDOWN_EDITOR_CONTEXT_MENU, 'markdown-editor:contextMenu'],
    selectionAction: [MARKDOWN_EDITOR_SELECTION_ACTION, 'markdown-editor:selectionAction'],
  } as const;
  for (const [actual, literal] of Object.values(expected)) expect(actual).toBe(literal);
  expect(MARKDOWN_EDITOR_OWNER).toBe('markdown-editor');
});

// 以下迁移自 markdown-editor-api 的 index.test.ts（断言保持不变）。

describe('MARKDOWN_EDITOR_SYNTAX_FEATURE', () => {
  it('暴露稳定的扩展点 id', () => {
    expect(MARKDOWN_EDITOR_SYNTAX_FEATURE).toBe('markdown-editor:syntaxFeature');
  });
});

it('暴露正文右键菜单扩展点 id', () => {
  expect(MARKDOWN_EDITOR_CONTEXT_MENU).toBe('markdown-editor:contextMenu');
});

it('值导出 contextMenuItemAppliesTo（场景可用性判定）', () => {
  const onlyBlock: EditorContextMenuItemMeta = {
    id: 'demo.copy',
    labelKey: 'demo.copy',
    requires: ['block'],
    run: () => {},
  };
  expect(contextMenuItemAppliesTo(onlyBlock, ['block'])).toBe(true);
  expect(contextMenuItemAppliesTo(onlyBlock, ['selection'])).toBe(false);
});

it('InsertCommandMeta 形状可被类型接受', () => {
  const cmd: InsertCommandMeta = {
    id: 'demo',
    keyword: 'demo',
    labelKey: 'demo.label',
    icon: [['path', 'M0 0h1v1H0z']],
    insert: () => {},
  };
  expect(cmd.id).toBe('demo');
});

it('InsertCommandMeta 接受全部可选字段', () => {
  const cmd: InsertCommandMeta = {
    id: 'demo',
    keyword: 'demo',
    labelKey: 'demo.label',
    descriptionKey: 'demo.description',
    icon: [['path', 'M0 0h1v1H0z']],
    defaultShortcut: 'Cmd+Opt+D',
    category: 'paragraph',
    order: 10,
    insert: () => {},
    isDisabled: () => false,
  };
  expect(cmd.descriptionKey).toBe('demo.description');
  expect(cmd.defaultShortcut).toBe('Cmd+Opt+D');
  expect(cmd.category).toBe('paragraph');
  expect(cmd.order).toBe(10);
  expect(cmd.isDisabled).toBeTypeOf('function');
});
