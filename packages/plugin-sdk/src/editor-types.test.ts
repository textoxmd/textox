import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';

import {
  contextMenuItemAppliesTo,
  defineCodeBlockExtension,
  defineEmbedExtension,
  defineInsertExtension,
  formatToolbarItemIncludesSurface,
  parseEmbedRef,
} from './editor-types';
import type {
  EditorContext,
  EditorContextMenuCtx,
  EditorContextMenuItemMeta,
  EditorContextMenuRequirement,
  EditorViewKit,
  FormatToolbarItemMeta,
  IconDef,
  IconSpec,
  InsertCommandMeta,
  PreviewRegion,
} from './editor-types';

const fakeDom = {} as unknown as HTMLElement;
const nodeView: NodeView = { dom: fakeDom };
const preview: PreviewRegion = { dom: fakeDom };

function ctx(): EditorContext {
  const views: EditorViewKit = {
    codeBlock: () => nodeView,
    embed: () => nodeView,
  };
  return {
    schema: {} as EditorContext['schema'],
    views,
    config: { get: () => undefined, all: <T,>() => ({}) as T },
  };
}

function node(name: string, attrs: Record<string, unknown>, text = ''): PMNode {
  return { attrs, textContent: text, type: { name } } as unknown as PMNode;
}

const noView = {} as EditorView;
const at0 = () => 0;

describe('parseEmbedRef', () => {
  it('parses src/alt/title', () => {
    expect(parseEmbedRef('![alt](a/b.excalidraw "t")')).toEqual({
      src: 'a/b.excalidraw',
      alt: 'alt',
      title: 't',
    });
  });

  it('allows a missing title', () => {
    expect(parseEmbedRef('![](x.excalidraw)')).toEqual({
      src: 'x.excalidraw',
      alt: '',
      title: null,
    });
  });

  it('trims and returns null for non references', () => {
    expect(parseEmbedRef('  ![a](x.png)  ')).toEqual({ src: 'x.png', alt: 'a', title: null });
    expect(parseEmbedRef('hello')).toBeNull();
  });
});

describe('defineCodeBlockExtension', () => {
  it('claims matching languages, rejects others', () => {
    const ext = defineCodeBlockExtension({
      id: 'm',
      languages: ['mermaid'],
      createPreview: () => preview,
    });
    expect(ext.languages).toEqual(['mermaid']);
    const factory = ext.create(ctx()).nodeViews!.code_block!;
    expect(factory(node('code_block', { lang: 'mermaid' }), noView, at0, [])).toBe(nodeView);
    expect(factory(node('code_block', { lang: 'javascript' }), noView, at0, [])).toBeNull();
  });
});

describe('defineEmbedExtension', () => {
  it('sets embed metadata and claims matching srcs', () => {
    const ext = defineEmbedExtension({
      id: 'e',
      extensions: ['.excalidraw'],
      insertLabelKey: 'k',
      matches: (s) => s.endsWith('.excalidraw'),
      createPreview: () => preview,
    });
    expect(ext.embed).toMatchObject({ extensions: ['.excalidraw'], insertLabelKey: 'k' });
    expect(typeof ext.embed?.matches).toBe('function');
    const factory = ext.create(ctx()).nodeViews!.image_ref!;
    expect(factory(node('image_ref', {}, '![](x.excalidraw)'), noView, at0, [])).toBe(nodeView);
    expect(factory(node('image_ref', {}, '![](x.png)'), noView, at0, [])).toBeNull();
  });
});

describe('defineInsertExtension', () => {
  it('wraps insert metadata into an editor extension with an empty create', () => {
    const insert: InsertCommandMeta = {
      id: 'demo',
      keyword: 'demo',
      labelKey: 'demo.label',
      icon: [['path', 'M0 0h1v1H0z']],
      insert: () => {},
    };
    const ext = defineInsertExtension({ id: 'demo.insert', insert });
    expect(ext.id).toBe('demo.insert');
    expect(ext.insert).toBe(insert);
    expect(ext.create(ctx())).toEqual({});
  });
});

const formatBase: FormatToolbarItemMeta = {
  id: 'x',
  markName: 'm',
  delim: '**',
  labelKey: 'k',
  icon: [['path', 'M0 0h1v1H0z']],
};

describe('formatToolbarItemIncludesSurface', () => {
  it('surfaces 缺省时两面都投', () => {
    expect(formatToolbarItemIncludesSurface(formatBase, 'floating')).toBe(true);
    expect(formatToolbarItemIncludesSurface(formatBase, 'toolbar')).toBe(true);
  });

  it('显式 surfaces 只投声明面', () => {
    const only: FormatToolbarItemMeta = { ...formatBase, surfaces: ['floating'] };
    expect(formatToolbarItemIncludesSurface(only, 'floating')).toBe(true);
    expect(formatToolbarItemIncludesSurface(only, 'toolbar')).toBe(false);
  });
});

// 以下为编译期契约测试：真正的守卫是 `tsc`（`bun run typecheck`），
// vitest 用 esbuild 擦除类型、不做类型检查，运行时断言只是附带。
it('IconElement 支持 ellipse / polyline / polygon', () => {
  const def: IconDef = [
    ['ellipse', 12, 12, 6, 4],
    ['polyline', '1,2 3,4'],
    ['polygon', '5,6 7,8'],
  ];
  expect(def).toHaveLength(3);
});

it('IconSpec 接受 IconDef 或 lucide 名称', () => {
  const data: IconSpec = [['path', 'M0 0h1']];
  const name: IconSpec = 'underline';
  expect(Array.isArray(data)).toBe(true);
  expect(name).toBe('underline');
});

it('FormatToolbarItemMeta 接受 lucide 名称图标', () => {
  const item: FormatToolbarItemMeta = {
    id: 'underline',
    markName: 'underline',
    delim: '<u>',
    closeDelim: '</u>',
    labelKey: 'common.underline',
    icon: 'underline',
  };
  expect(item.icon).toBe('underline');
});

const menuItemBase: EditorContextMenuItemMeta = {
  id: 'demo.copy',
  labelKey: 'demo.copy',
  run: () => {},
};

describe('contextMenuItemAppliesTo', () => {
  it('未声明 requires 时任何场景都参与', () => {
    expect(contextMenuItemAppliesTo(menuItemBase, ['selection'])).toBe(true);
    expect(contextMenuItemAppliesTo(menuItemBase, ['block'])).toBe(true);
  });

  it('requires 为空数组时任何场景都参与（与未声明等价）', () => {
    const none: EditorContextMenuItemMeta = { ...menuItemBase, requires: [] };
    expect(contextMenuItemAppliesTo(none, ['selection'])).toBe(true);
    expect(contextMenuItemAppliesTo(none, ['block'])).toBe(true);
  });

  it('只声明 block 的项在 block 场景参与、selection 场景不参与', () => {
    const onlyBlock: EditorContextMenuItemMeta = { ...menuItemBase, requires: ['block'] };
    expect(contextMenuItemAppliesTo(onlyBlock, ['selection'])).toBe(false);
    expect(contextMenuItemAppliesTo(onlyBlock, ['block'])).toBe(true);
  });

  it('只声明 selection 的项在 selection 场景参与、block 场景不参与', () => {
    const onlySelection: EditorContextMenuItemMeta = { ...menuItemBase, requires: ['selection'] };
    expect(contextMenuItemAppliesTo(onlySelection, ['selection'])).toBe(true);
    expect(contextMenuItemAppliesTo(onlySelection, ['block'])).toBe(false);
  });

  it('声明两项时任一场景都参与', () => {
    const both: EditorContextMenuItemMeta = {
      ...menuItemBase,
      requires: ['selection', 'block'],
    };
    expect(contextMenuItemAppliesTo(both, ['selection'])).toBe(true);
    expect(contextMenuItemAppliesTo(both, ['block'])).toBe(true);
  });

  it('可用场景集合为空时，声明了 requires 的项都不参与', () => {
    const available: EditorContextMenuRequirement[] = [];
    expect(contextMenuItemAppliesTo(menuItemBase, available)).toBe(true);
    const onlyBlock: EditorContextMenuItemMeta = { ...menuItemBase, requires: ['block'] };
    expect(contextMenuItemAppliesTo(onlyBlock, available)).toBe(false);
  });
});

it('EditorContextMenuCtx 形状可被类型接受', () => {
  const ctxItem: EditorContextMenuCtx = {
    view: noView,
    hasSelection: false,
    block: { pos: 0, node: node('code_block', { lang: 'mermaid' }, 'graph TD;') },
  };
  expect(ctxItem.hasSelection).toBe(false);
  expect(ctxItem.block!.node.attrs.lang).toBe('mermaid');
});

it('EditorContextMenuCtx 允许未命中块（block 为 null）', () => {
  const ctxItem: EditorContextMenuCtx = { view: noView, hasSelection: true, block: null };
  expect(ctxItem.block).toBeNull();
  expect(ctxItem.hasSelection).toBe(true);
});

it('EditorContextMenuItemMeta 接受全部可选字段', () => {
  const item: EditorContextMenuItemMeta = {
    id: 'demo.copy',
    labelKey: 'demo.copy',
    requires: ['block'],
    order: 10,
    when: (c) => c.block?.node.type.name === 'code_block',
    enabled: () => true,
    run: (c) => {
      void c.block;
    },
  };
  expect(item.order).toBe(10);
  expect(item.when).toBeTypeOf('function');
});
