import { describe, expect, it, vi } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { IconDef } from '@texto/markdown-editor-api';

import { tableInsert } from './insert';
import { tableFeature } from './syntax/feature';

describe('tableInsert', () => {
  it('exposes metadata for toolbar / slash / shortcut', () => {
    expect(tableInsert.id).toBe('table');
    expect(tableInsert.keyword).toBe('table');
    expect(tableInsert.defaultShortcut).toBe('Cmd+Opt+T');
    expect((tableInsert.icon as IconDef).length).toBeGreaterThan(0);
  });

  it('replaces the current top-level block with a 3×3 table', () => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: { group: 'block', content: 'inline*' },
        text: { group: 'inline' },
        ...tableFeature.nodes,
      },
    });
    const doc = schema.nodes.doc!.create(null, [schema.nodes.paragraph!.create()]);
    const initial = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1),
    });

    let state = initial;
    const view = {
      get state() {
        return state;
      },
      dispatch(tr: Transaction) {
        state = state.apply(tr);
      },
      focus: vi.fn(),
    };

    tableInsert.insert(view as unknown as EditorView);

    const table = state.doc.firstChild!;
    expect(table.type.name).toBe('table');
    expect(table.childCount).toBe(3);
    expect(table.firstChild!.childCount).toBe(3);
    expect(view.focus).toHaveBeenCalledTimes(1);
  });
});
