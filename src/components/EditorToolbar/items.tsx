import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Quote,
  Code2,
  Minus,
  List,
  ListOrdered,
  CheckSquare,
  Image as ImageIcon,
  Link,
} from 'lucide-react';
import type { FormatToolbarItemMeta, InsertCommandMeta } from '@texto/markdown-editor-api';
import { toggleInlineDelim } from '../TextoEditor/src/features/inline-toggle';
import { runFormatToolbarItem } from '../TextoEditor/src/features/inline-format-toolbar/items';
import { toggleTaskList } from '../TextoEditor/src/features/task';
import {
  toggleBlockquote,
  toggleBulletList,
  toggleCodeBlock,
  toggleOrderedList,
} from '../TextoEditor/src/features/toolbar-toggle';
import { iconComponentFromSpec } from '../TextoEditor/src/editorIcons';
import { canInsertBlockAt } from '../TextoEditor/src/features/block-insert';
import type { ToolbarItem } from './types';

/** 编辑器区内置 item 的唯一真源：bar 与溢出下拉共用。 */
export const BUILTIN_TOOLBAR_ITEMS: ToolbarItem[] = [
  // inline
  {
    id: 'bold', group: 'inline', order: 0, labelKey: 'common.bold', icon: Bold, activeKey: 'bold',
    run: (ctx) => { const v = ctx.getView(); if (v) toggleInlineDelim(v, '**'); },
  },
  {
    id: 'italic', group: 'inline', order: 1, labelKey: 'common.italic', icon: Italic, activeKey: 'italic',
    run: (ctx) => { const v = ctx.getView(); if (v) toggleInlineDelim(v, '*'); },
  },
  {
    id: 'strikethrough', group: 'inline', order: 2, labelKey: 'common.strikethrough', icon: Strikethrough, activeKey: 'strikethrough',
    run: (ctx) => { const v = ctx.getView(); if (v) toggleInlineDelim(v, '~~'); },
  },
  {
    id: 'inlineCode', group: 'inline', order: 5, labelKey: 'common.inlineCode', icon: Code, activeKey: 'inlineCode',
    run: (ctx) => { const v = ctx.getView(); if (v) toggleInlineDelim(v, '`'); },
  },

  // blocks
  {
    id: 'blockquote', group: 'blocks', order: 0, labelKey: 'common.blockquote', icon: Quote, activeKey: 'blockquote',
    run: (ctx) => { const v = ctx.getView(); if (!v) return; toggleBlockquote()(v.state, v.dispatch, v); v.focus(); },
  },
  {
    id: 'codeBlock', group: 'blocks', order: 1, labelKey: 'common.codeBlock', icon: Code2, activeKey: 'codeBlock',
    run: (ctx) => { const v = ctx.getView(); if (!v) return; toggleCodeBlock()(v.state, v.dispatch, v); v.focus(); },
  },
  {
    id: 'horizontalRule', group: 'blocks', order: 2, labelKey: 'common.horizontalRule', icon: Minus,
    run: (ctx) => { ctx.editorRef.current?.insertHorizontalRule(); },
    isDisabled: (ctx) => ctx.active.blockInsertDisabled,
  },

  // lists
  {
    id: 'bulletList', group: 'lists', order: 0, labelKey: 'common.bulletList', icon: List, activeKey: 'bulletList',
    run: (ctx) => { const v = ctx.getView(); if (!v) return; toggleBulletList()(v.state, v.dispatch, v); v.focus(); },
  },
  {
    id: 'orderedList', group: 'lists', order: 1, labelKey: 'common.orderedList', icon: ListOrdered, activeKey: 'orderedList',
    run: (ctx) => { const v = ctx.getView(); if (!v) return; toggleOrderedList()(v.state, v.dispatch, v); v.focus(); },
  },
  {
    id: 'taskList', group: 'lists', order: 2, labelKey: 'common.taskList', icon: CheckSquare, activeKey: 'taskList',
    run: (ctx) => { const v = ctx.getView(); if (!v) return; toggleTaskList()(v.state, v.dispatch, v); v.focus(); },
  },

  // insert
  {
    id: 'image', group: 'insert', order: 1, labelKey: 'common.image', icon: ImageIcon,
    run: (ctx) => { ctx.editorRef.current?.insertImage(); },
    isDisabled: (ctx) => ctx.isSingleFileMode,
  },
  {
    id: 'link', group: 'insert', order: 2, labelKey: 'common.link', icon: Link,
    run: (ctx) => { ctx.editorRef.current?.insertLink(); },
  },
];

/** 把插件贡献的插入命令投影成工具栏项（骨架不写死任何具体插件）。 */
export function contributedToolbarItem(cmd: InsertCommandMeta): ToolbarItem {
  return {
    id: cmd.id,
    group: 'insert',
    order: cmd.order ?? 0,
    labelKey: cmd.labelKey,
    icon: iconComponentFromSpec(cmd.icon),
    run: (ctx) => {
      if (ctx.editorRef.current?.editorView?.editable === false) return;
      const v = ctx.getView();
      if (!v) return;
      if (cmd.isDisabled ? cmd.isDisabled(v.state) : !canInsertBlockAt(v.state)) return;
      cmd.insert(v);
      v.focus();
    },
    isDisabled: (ctx) => {
      const v = ctx.getView();
      return v ? (cmd.isDisabled ? cmd.isDisabled(v.state) : !canInsertBlockAt(v.state)) : true;
    },
  };
}

/** 把插件贡献的行内格式项投影成顶部工具栏项（骨架不写死任何具体插件）。 */
export function contributedFormatToolbarItem(meta: FormatToolbarItemMeta): ToolbarItem {
  return {
    id: meta.id,
    group: 'inline',
    order: meta.order ?? 0,
    labelKey: meta.labelKey,
    icon: iconComponentFromSpec(meta.icon),
    activeMark: meta.markName,
    isActive: meta.isActive
      ? (ctx) => {
          const v = ctx.getView();
          return v ? !!meta.isActive!(v.state) : false;
        }
      : undefined,
    run: (ctx) => {
      const v = ctx.getView();
      if (v) runFormatToolbarItem(v, meta);
    },
  };
}
