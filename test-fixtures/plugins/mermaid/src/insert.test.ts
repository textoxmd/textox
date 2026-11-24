import { describe, expect, it, vi } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { IconDef } from '@texto/markdown-editor-api';

import { mermaidInsert } from './insert';

function makeSchema() {
  return new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'inline*' },
      text: { group: 'inline' },
      code_block: {
        group: 'block',
        content: 'text*',
        attrs: { lang: { default: '' } },
      },
    },
  });
}

describe('mermaidInsert', () => {
  it('exposes metadata for toolbar / slash / shortcut', () => {
    expect(mermaidInsert.id).toBe('mermaid');
    expect(mermaidInsert.keyword).toBe('mermaid');
    expect(mermaidInsert.defaultShortcut).toBe('Cmd+Opt+M');
    expect((mermaidInsert.icon as IconDef).length).toBeGreaterThan(0);
  });

  it('replaces the current top-level block with a mermaid code block', () => {
    const schema = makeSchema();
    const doc = schema.nodes.doc!.create(null, [schema.nodes.paragraph!.create()]);
    let state = EditorState.create({ doc, selection: TextSelection.create(doc, 1) });
    const view = {
      get state() {
        return state;
      },
      dispatch(tr: Transaction) {
        state = state.apply(tr);
      },
      focus: vi.fn(),
    };

    mermaidInsert.insert(view as unknown as EditorView);

    const block = state.doc.firstChild!;
    expect(block.type.name).toBe('code_block');
    expect(block.attrs.lang).toBe('mermaid');
    expect(view.focus).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the schema has no code_block', () => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: { group: 'block', content: 'inline*' },
        text: { group: 'inline' },
      },
    });
    const doc = schema.nodes.doc!.create(null, [schema.nodes.paragraph!.create()]);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1) });
    const dispatch = vi.fn();
    const view = { state, dispatch, focus: vi.fn() };

    expect(() => mermaidInsert.insert(view as unknown as EditorView)).not.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
