import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';

export interface SearchHighlightRange {
  from: number;
  to: number;
  current: boolean;
}

export const setSearchHighlights = StateEffect.define<SearchHighlightRange[]>();

/** 复用同一份 mark 装饰描述，避免每个匹配都新建一个 Decoration（大文档可达上万条） */
const MATCH_MARK = Decoration.mark({ class: 'cm-search-match' });
const CURRENT_MARK = Decoration.mark({ class: 'cm-search-match cm-search-match-current' });

const searchHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setSearchHighlights)) {
        const ranges = [];
        for (const range of effect.value) {
          if (range.from >= range.to) continue;
          ranges.push((range.current ? CURRENT_MARK : MATCH_MARK).range(range.from, range.to));
        }
        decorations = Decoration.set(ranges, true);
      }
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const searchHighlightExtension = searchHighlightField;

export function updateSearchHighlights(
  view: EditorView | null,
  matches: { from: number; to: number }[],
  currentIndex: number
): void {
  if (!view) return;
  view.dispatch({
    effects: setSearchHighlights.of(
      matches.map((match, index) => ({
        from: match.from,
        to: match.to,
        current: index === currentIndex,
      }))
    ),
  });
}
