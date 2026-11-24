import type { Node as PMNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import {
  alignDelim,
  parseAlignFromStyle,
  renderCellInline,
  tableCanonicalRows,
} from './serialize';

type FakeChild = { isText: boolean; text?: string | null };

/** Minimal node stand-in exposing just the `content.forEach`/`isText`/`text`
 *  surface that `renderCellInline` reads from a ProseMirror node. */
function fakeCell(children: FakeChild[]): PMNode {
  return {
    content: {
      forEach: (fn: (child: FakeChild) => void) => {
        for (const child of children) fn(child);
      },
    },
  } as unknown as PMNode;
}

describe('table serialize helpers', () => {
  it('parseAlignFromStyle reads text-align with optional space/semicolon', () => {
    expect(parseAlignFromStyle('text-align:center')).toBe('center');
    expect(parseAlignFromStyle('text-align: right;')).toBe('right');
    expect(parseAlignFromStyle(null)).toBe(null);
    expect(parseAlignFromStyle('color:red')).toBe(null);
  });

  it('alignDelim encodes left/right/center/none with min width 3', () => {
    expect(alignDelim(null, 1)).toBe('---');
    expect(alignDelim('left', 5)).toBe(':----');
    expect(alignDelim('right', 5)).toBe('----:');
    expect(alignDelim('center', 5)).toBe(':---:');
  });

  it('renderCellInline concatenates text children', () => {
    expect(
      renderCellInline(
        fakeCell([
          { isText: true, text: 'a' },
          { isText: true, text: 'b' },
        ]),
      ),
    ).toBe('ab');
  });

  it('renderCellInline escapes pipes as \\|', () => {
    expect(renderCellInline(fakeCell([{ isText: true, text: 'a|b' }]))).toBe(
      'a\\|b',
    );
  });

  it('renderCellInline ignores non-text children', () => {
    expect(
      renderCellInline(
        fakeCell([
          { isText: false, text: 'inline-atom' },
          { isText: true, text: 'kept' },
        ]),
      ),
    ).toBe('kept');
  });

  it('tableCanonicalRows drops the divider row, keeping header + body order', () => {
    expect(
      tableCanonicalRows(() => '| h |\n| --- |\n| b |', fakeCell([])),
    ).toEqual(['| h |', '| b |']);
  });

  it('tableCanonicalRows handles a table with no body rows', () => {
    expect(
      tableCanonicalRows(() => '| h |\n| --- |', fakeCell([])),
    ).toEqual(['| h |']);
  });
});
