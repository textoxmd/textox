import { describe, expect, it, vi } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { extractSelectionContext, readSelectionContext } from '../selection-context';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    heading: { attrs: { level: { default: 2 } }, content: 'text*', group: 'block' },
    paragraph: { content: 'text*', group: 'block' },
    horizontal_rule: { group: 'block' },
    text: {},
  },
  marks: {},
});

const DOM_RECT = { left: 1, top: 2, right: 101, bottom: 42, width: 100, height: 40 };

function fakeView(state: EditorState, opts: { coordsThrows?: boolean } = {}): EditorView {
  return {
    state,
    coordsAtPos: vi.fn(() => {
      if (opts.coordsThrows) throw new Error('no layout');
      return { left: 10, top: 20, right: 30, bottom: 40 };
    }),
    dom: { getBoundingClientRect: () => DOM_RECT },
  } as unknown as EditorView;
}

describe('extractSelectionContext', () => {
  it('提取选区、段落与标题链', () => {
    const doc = schema.node('doc', null, [
      schema.node('heading', { level: 2 }, [schema.text('概念')]),
      schema.node('paragraph', null, [schema.text('Markdown 是一种轻量标记语言。')]),
    ]);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 5, 13) });

    const ctx = extractSelectionContext(state);

    expect(ctx?.selection).toContain('Markdown');
    expect(ctx?.paragraph).toContain('轻量标记语言');
    expect(ctx?.headings).toContain('概念');
  });

  it('选区在 heading 内时，同级兄弟标题不进入祖先链', () => {
    const doc = schema.node('doc', null, [
      schema.node('heading', { level: 1 }, [schema.text('A')]),
      schema.node('heading', { level: 2 }, [schema.text('B')]),
      schema.node('heading', { level: 2 }, [schema.text('C')]),
    ]);
    // 位置：H1 A 的 A 在 1..2，H2 B 的 B 在 4..5，H2 C 的 C 在 7..8。
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 7, 8) });

    expect(extractSelectionContext(state)?.headings).toEqual(['A', 'C']);
  });

  it('超长选区与段落会被截断', () => {
    const longText = '字'.repeat(5000);
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text(longText)])]);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1, 1 + longText.length) });

    const ctx = extractSelectionContext(state);

    expect(ctx?.selection).toBe(`${'字'.repeat(4000)}\n（已截断）`);
    expect(ctx?.paragraph).toBe(`${'字'.repeat(2000)}\n（已截断）`);
  });

  it('顶层 leaf 选区不把全文当段落，且空选区返回 null', () => {
    const doc = schema.node('doc', null, [
      schema.node('horizontal_rule'),
      schema.node('paragraph', null, [schema.text('正文')]),
    ]);
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, 0) });

    expect(extractSelectionContext(state)).toBeNull();
  });

  it('无标题文档的 headings 为空', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('第一段内容。')]),
      schema.node('paragraph', null, [schema.text('第二段内容。')]),
    ]);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1, 4) });

    expect(extractSelectionContext(state)?.headings).toEqual([]);
  });

  it('跨块选区不抛错，按起始块取上下文', () => {
    const doc = schema.node('doc', null, [
      schema.node('heading', { level: 1 }, [schema.text('标题')]),
      schema.node('paragraph', null, [schema.text('正文内容')]),
      schema.node('paragraph', null, [schema.text('另一段')]),
    ]);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1, 11) });

    let ctx: ReturnType<typeof extractSelectionContext> | undefined;
    expect(() => {
      ctx = extractSelectionContext(state);
    }).not.toThrow();
    expect(ctx?.selection).toContain('标题');
    expect(ctx?.selection).toContain('正文');
    expect(ctx?.headings).toContain('标题');
  });
});

describe('readSelectionContext', () => {
  const doc = schema.node('doc', null, [
    schema.node('heading', { level: 2 }, [schema.text('概念')]),
    schema.node('paragraph', null, [schema.text('Markdown 是一种轻量标记语言。')]),
  ]);

  it('无视图时返回 null', () => {
    expect(readSelectionContext(null)).toBeNull();
    expect(readSelectionContext(undefined)).toBeNull();
  });

  it('空选区返回 null', () => {
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 5) });
    expect(readSelectionContext(fakeView(state))).toBeNull();
  });

  it('带上选区并集锚点（视口坐标）', () => {
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 5, 13) });

    const ctx = readSelectionContext(fakeView(state));

    expect(ctx?.selection).toContain('Markdown');
    expect(ctx?.anchor).toEqual({ left: 10, top: 20, right: 30, bottom: 40, width: 20, height: 20 });
  });

  it('coordsAtPos 抛错时回退到编辑器矩形', () => {
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 5, 13) });

    const ctx = readSelectionContext(fakeView(state, { coordsThrows: true }));

    expect(ctx?.anchor).toEqual(DOM_RECT);
  });
});
