import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Plugin } from 'prosemirror-state';
import type { NodeView } from 'prosemirror-view';
import {
  declareExtensionPoint,
  hasExtensionPoint,
  ownerOfExtensionPoint,
  registerContributions,
  resetExtensionPointsForTests,
  resetPluginConfigSnapshotsForTests,
  setPluginConfigSnapshot,
} from '@texto/plugin-sdk';
import {
  MARKDOWN_EDITOR_CONTEXT_MENU,
  MARKDOWN_EDITOR_EXTENSION,
  MARKDOWN_EDITOR_FORMAT_TOOLBAR,
  MARKDOWN_EDITOR_OWNER,
  MARKDOWN_EDITOR_SYNTAX_FEATURE,
  MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT,
} from '@texto/markdown-editor-api';
import type {
  EditorContext,
  EditorContextMenuItemMeta,
  EditorExtension,
  EditorViewKit,
  FormatToolbarItemMeta,
  HighlightLanguage,
  InsertCommandMeta,
  NodeViewFactory,
} from '@texto/markdown-editor-api';

import {
  collectEditorExtensions,
  declareMarkdownEditorExtensionPoint,
  editorContextMenuItems,
  editorEmbedInserts,
  editorExtensionLanguages,
  editorFormatToolbarItems,
  editorHighlightLanguages,
  editorInsertCommands,
} from '../src/extension/registry';
import { getSchema } from '../src/schema';

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});

// 全局 plugins-setup 会声明编辑器扩展点，这里每个用例前清空，
// 让「声明前不存在」等断言保持确定性。
beforeEach(() => {
  resetExtensionPointsForTests();
  resetPluginConfigSnapshotsForTests();
});

afterEach(() => {
  resetExtensionPointsForTests();
  vi.restoreAllMocks();
});

const views: EditorViewKit = {
  codeBlock: () => ({ dom: document.createElement('div') }) as unknown as NodeView,
  embed: () => ({ dom: document.createElement('div') }) as unknown as NodeView,
};

function ctx(): EditorContext {
  return {
    schema,
    views,
    documentPath: 'x.md',
    config: { get: () => undefined, all: <T,>() => ({}) as T },
  };
}

const fakeNodeView: NodeView = { dom: document.createElement('div') };

describe('declareMarkdownEditorExtensionPoint', () => {
  it('declares all editor extension points under the editor owner', () => {
    expect(hasExtensionPoint(MARKDOWN_EDITOR_EXTENSION)).toBe(false);
    expect(hasExtensionPoint(MARKDOWN_EDITOR_SYNTAX_FEATURE)).toBe(false);
    expect(hasExtensionPoint(MARKDOWN_EDITOR_FORMAT_TOOLBAR)).toBe(false);
    expect(hasExtensionPoint(MARKDOWN_EDITOR_CONTEXT_MENU)).toBe(false);

    declareMarkdownEditorExtensionPoint();

    expect(hasExtensionPoint(MARKDOWN_EDITOR_EXTENSION)).toBe(true);
    expect(hasExtensionPoint(MARKDOWN_EDITOR_SYNTAX_FEATURE)).toBe(true);
    expect(hasExtensionPoint(MARKDOWN_EDITOR_FORMAT_TOOLBAR)).toBe(true);
    expect(hasExtensionPoint(MARKDOWN_EDITOR_CONTEXT_MENU)).toBe(true);
    expect(ownerOfExtensionPoint(MARKDOWN_EDITOR_CONTEXT_MENU)).toBe(MARKDOWN_EDITOR_OWNER);
    expect(ownerOfExtensionPoint(MARKDOWN_EDITOR_EXTENSION)).toBe(MARKDOWN_EDITOR_OWNER);
    expect(ownerOfExtensionPoint(MARKDOWN_EDITOR_SYNTAX_FEATURE)).toBe(MARKDOWN_EDITOR_OWNER);
    expect(ownerOfExtensionPoint(MARKDOWN_EDITOR_FORMAT_TOOLBAR)).toBe(MARKDOWN_EDITOR_OWNER);
  });

  it('is idempotent across repeated calls', () => {
    declareMarkdownEditorExtensionPoint();
    expect(() => declareMarkdownEditorExtensionPoint()).not.toThrow();

    expect(hasExtensionPoint(MARKDOWN_EDITOR_EXTENSION)).toBe(true);
    expect(hasExtensionPoint(MARKDOWN_EDITOR_SYNTAX_FEATURE)).toBe(true);
    expect(hasExtensionPoint(MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT)).toBe(true);
    expect(ownerOfExtensionPoint(MARKDOWN_EDITOR_SYNTAX_FEATURE)).toBe(MARKDOWN_EDITOR_OWNER);
  });

  it('declares the syntax highlight point under the editor owner', () => {
    expect(hasExtensionPoint(MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT)).toBe(false);

    declareMarkdownEditorExtensionPoint();

    expect(hasExtensionPoint(MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT)).toBe(true);
    expect(ownerOfExtensionPoint(MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT)).toBe(MARKDOWN_EDITOR_OWNER);
  });
});

describe('collectEditorExtensions', () => {
  it('collects plugins and nodeViews, forwarding the context', () => {
    declareMarkdownEditorExtensionPoint();
    let captured: EditorContext | undefined;
    const marker = new Plugin({});
    const ext: EditorExtension = {
      id: 'a',
      languages: ['mermaid'],
      create: (c) => {
        captured = c;
        return {
          plugins: [marker],
          nodeViews: { code_block: () => fakeNodeView },
        };
      },
    };
    registerContributions('a', { [MARKDOWN_EDITOR_EXTENSION]: [ext] });

    const result = collectEditorExtensions(ctx());
    expect(result.plugins).toContain(marker);
    expect(result.nodeViews.code_block).toHaveLength(1);
    expect(captured?.schema).toBe(schema);
    expect(captured?.documentPath).toBe('x.md');
  });

  it('preserves contribution order per node type and skips falsy factories', () => {
    declareMarkdownEditorExtensionPoint();
    const f1: NodeViewFactory = () => null;
    const f2: NodeViewFactory = () => null;
    registerContributions('p', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        { id: 'p1', create: () => ({ nodeViews: { code_block: f1, image_ref: undefined } }) },
        { id: 'p2', create: () => ({ nodeViews: { code_block: f2 } }) },
      ],
    });
    const result = collectEditorExtensions(ctx());
    expect(result.nodeViews.code_block).toEqual([f1, f2]);
    expect(result.nodeViews.image_ref).toBeUndefined();
  });

  it('isolates a throwing extension and keeps the rest', () => {
    declareMarkdownEditorExtensionPoint();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = new Plugin({});
    const bad: EditorExtension = {
      id: 'bad',
      create: () => {
        throw new Error('boom');
      },
    };
    const ok: EditorExtension = { id: 'ok', create: () => ({ plugins: [good] }) };
    registerContributions('p', { [MARKDOWN_EDITOR_EXTENSION]: [bad, ok] });

    const result = collectEditorExtensions(ctx());
    expect(result.plugins).toEqual([good]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('returns empty when nothing is registered', () => {
    declareMarkdownEditorExtensionPoint();
    expect(collectEditorExtensions(ctx())).toEqual({ plugins: [], nodeViews: {} });
  });

  it('aggregates declared code block languages', () => {
    declareMarkdownEditorExtensionPoint();
    registerContributions('a', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        { id: 'm', languages: ['mermaid'], create: () => ({}) },
        { id: 'x', languages: ['plantuml', 'mermaid'], create: () => ({}) },
      ],
    });
    expect(editorExtensionLanguages().sort()).toEqual(['mermaid', 'plantuml']);
  });
});

describe('collectEditorExtensions config binding', () => {
  it('reads live per-owner config and isolates owners', () => {
    declareMarkdownEditorExtensionPoint();
    let readerA: EditorContext['config'] | undefined;
    let readerB: EditorContext['config'] | undefined;
    let seenA: unknown;
    let seenB: unknown;
    registerContributions('typing-particle', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        {
          id: 'p.ext',
          create(c) {
            readerA = c.config;
            seenA = c.config.all();
            return {};
          },
        },
      ],
    });
    registerContributions('owner-b', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        {
          id: 'b.ext',
          create(c) {
            readerB = c.config;
            seenB = c.config.all();
            return {};
          },
        },
      ],
    });
    setPluginConfigSnapshot('typing-particle', { count: 7 });
    setPluginConfigSnapshot('owner-b', { color: '#fff' });

    collectEditorExtensions(ctx());

    // 按 owner 隔离：各自的 reader 只看到自己的快照。
    expect(seenA).toEqual({ count: 7 });
    expect(seenB).toEqual({ color: '#fff' });

    // 实时：创建后更新快照，已有 reader 反映新值（而非创建时固化的拷贝）。
    setPluginConfigSnapshot('typing-particle', { count: 9 });
    expect(readerA?.all()).toEqual({ count: 9 });
    // 隔离：更新一个 owner 不影响另一个 owner 的 reader。
    expect(readerB?.all()).toEqual({ color: '#fff' });
  });
});

describe('editorEmbedInserts', () => {
  it('maps embed metadata from contributions and skips plain extensions', () => {
    declareMarkdownEditorExtensionPoint();
    registerContributions('e', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        { id: 'e.embed', embed: { extensions: ['.excalidraw'], insertLabelKey: 'x.insert' }, create: () => ({}) },
        { id: 'e.plain', create: () => ({}) },
      ],
    });

    expect(editorEmbedInserts()).toEqual([
      { id: 'e.embed', extensions: ['.excalidraw'], insertLabelKey: 'x.insert' },
    ]);
  });

  it('returns an empty list when no embed extensions are registered', () => {
    declareMarkdownEditorExtensionPoint();
    expect(editorEmbedInserts()).toEqual([]);
  });

  it('preserves registration order for multiple embeds', () => {
    declareMarkdownEditorExtensionPoint();
    registerContributions('e', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        { id: 'e.a', embed: { extensions: ['.a'], insertLabelKey: 'a.insert' }, create: () => ({}) },
        { id: 'e.b', embed: { extensions: ['.b'], insertLabelKey: 'b.insert' }, create: () => ({}) },
      ],
    });
    expect(editorEmbedInserts().map((e) => e.id)).toEqual(['e.a', 'e.b']);
  });
});

describe('editorInsertCommands', () => {
  beforeEach(() => resetExtensionPointsForTests());

  it('collects insert metadata from editor extensions', () => {
    declareExtensionPoint({ id: MARKDOWN_EDITOR_EXTENSION }, 'markdown-editor');
    registerContributions('demo', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        {
          id: 'demo.ins',
          insert: {
            id: 'demo',
            keyword: 'demo',
            labelKey: 'demo.label',
            icon: [['path', 'M0 0h1v1H0z']],
            insert: () => {},
          },
          create: () => ({}),
        },
      ],
    });
    expect(editorInsertCommands().map((c) => c.id)).toEqual(['demo']);
  });

  it('skips extensions without insert metadata and preserves order', () => {
    declareMarkdownEditorExtensionPoint();
    registerContributions('t', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        { id: 't.plain', create: () => ({}) },
        {
          id: 't.a',
          insert: {
            id: 'a',
            keyword: 'a',
            labelKey: 'a.label',
            icon: [['path', 'M0 0h1v1H0z']],
            insert: () => {},
          },
          create: () => ({}),
        },
        {
          id: 't.b',
          insert: {
            id: 'b',
            keyword: 'b',
            labelKey: 'b.label',
            icon: [['path', 'M0 0h1v1H0z']],
            insert: () => {},
          },
          create: () => ({}),
        },
      ],
    });
    expect(editorInsertCommands().map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('returns an empty list when nothing is registered', () => {
    declareMarkdownEditorExtensionPoint();
    expect(editorInsertCommands()).toEqual([]);
  });

  it('dedupes by id with last-wins while keeping the first position', () => {
    declareMarkdownEditorExtensionPoint();
    const mk = (keyword: string): InsertCommandMeta => ({
      id: 'dup',
      keyword,
      labelKey: `${keyword}.label`,
      icon: [['path', 'M0 0h1v1H0z']],
      insert: () => {},
    });
    registerContributions('t', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        { id: 't.first', insert: mk('dup-first'), create: () => ({}) },
        {
          id: 't.other',
          insert: {
            id: 'other',
            keyword: 'other',
            labelKey: 'other.label',
            icon: [['path', 'M0 0h1v1H0z']],
            insert: () => {},
          },
          create: () => ({}),
        },
        { id: 't.last', insert: mk('dup-last'), create: () => ({}) },
      ],
    });

    const cmds = editorInsertCommands();
    // 原位置保留（dup 在 other 之前），值取后注册者。
    expect(cmds.map((c) => c.id)).toEqual(['dup', 'other']);
    expect(cmds[0]!.keyword).toBe('dup-last');
  });
});

describe('editorHighlightLanguages', () => {
  const grammar = (() => ({})) as unknown as HighlightLanguage['grammar'];

  it('merges contributions and dedupes by id with last-wins keeping first position', () => {
    declareMarkdownEditorExtensionPoint();
    registerContributions('a', {
      [MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT]: [
        { languages: [{ id: 'javascript', label: 'JavaScript', grammar }] },
      ],
    });
    registerContributions('b', {
      [MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT]: [
        { languages: [{ id: 'javascript', label: 'JS', grammar }, { id: 'python', grammar }] },
      ],
    });

    const langs = editorHighlightLanguages();
    expect(langs.map((l) => l.id)).toEqual(['javascript', 'python']);
    expect(langs[0]!.label).toBe('JS');
  });

  it('returns an empty list when nothing is registered', () => {
    declareMarkdownEditorExtensionPoint();
    expect(editorHighlightLanguages()).toEqual([]);
  });
});

describe('editorFormatToolbarItems', () => {
  const mkFmt = (id: string, labelKey = `${id}.label`): FormatToolbarItemMeta => ({
    id,
    markName: 'm',
    delim: '**',
    labelKey,
    icon: [['path', 'M0 0h1v1H0z']],
  });

  it('collects format toolbar items from contributions', () => {
    declareMarkdownEditorExtensionPoint();
    registerContributions('demo', {
      [MARKDOWN_EDITOR_FORMAT_TOOLBAR]: [mkFmt('a'), mkFmt('b')],
    });
    expect(editorFormatToolbarItems().map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('last-wins on duplicate id（冲突项按 SDK 语义移到末尾）', () => {
    declareMarkdownEditorExtensionPoint();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerContributions('t', {
      [MARKDOWN_EDITOR_FORMAT_TOOLBAR]: [mkFmt('dup', 'first'), mkFmt('other'), mkFmt('dup', 'last')],
    });
    const items = editorFormatToolbarItems();
    expect(items.map((i) => i.id)).toEqual(['other', 'dup']);
    expect(items.find((i) => i.id === 'dup')!.labelKey).toBe('last');
    warn.mockRestore();
  });

  it('returns an empty list when nothing is registered', () => {
    declareMarkdownEditorExtensionPoint();
    expect(editorFormatToolbarItems()).toEqual([]);
  });
});

describe('editorContextMenuItems', () => {
  const mkMenu = (id: string, labelKey = `${id}.label`): EditorContextMenuItemMeta => ({
    id,
    labelKey,
    run: () => {},
  });

  it('collects context menu items from contributions', () => {
    declareMarkdownEditorExtensionPoint();
    registerContributions('demo', {
      [MARKDOWN_EDITOR_CONTEXT_MENU]: [mkMenu('a'), mkMenu('b')],
    });
    expect(editorContextMenuItems().map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('last-wins on duplicate id（冲突项按 SDK 语义移到末尾）', () => {
    declareMarkdownEditorExtensionPoint();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerContributions('t', {
      [MARKDOWN_EDITOR_CONTEXT_MENU]: [mkMenu('dup', 'first'), mkMenu('other'), mkMenu('dup', 'last')],
    });
    const items = editorContextMenuItems();
    expect(items.map((i) => i.id)).toEqual(['other', 'dup']);
    expect(items.find((i) => i.id === 'dup')!.labelKey).toBe('last');
    warn.mockRestore();
  });

  it('returns an empty list when nothing is registered', () => {
    declareMarkdownEditorExtensionPoint();
    expect(editorContextMenuItems()).toEqual([]);
  });
});
