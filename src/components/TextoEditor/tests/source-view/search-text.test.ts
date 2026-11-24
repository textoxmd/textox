import { describe, expect, it } from 'vitest';
import {
  escapeRegExp,
  findMatches,
  isWholeWord,
  MAX_SEARCH_MATCHES,
} from '../../src/source-view/search-text';

const opts = { caseSensitive: false, wholeWord: false, regex: false };

describe('search-text: findMatches', () => {
  it('finds case-sensitive plain matches', () => {
    const { matches, truncated } = findMatches('foo Foo foo', 'foo', {
      ...opts,
      caseSensitive: true,
    });
    expect(matches).toEqual([
      { from: 0, to: 3 },
      { from: 8, to: 11 },
    ]);
    expect(truncated).toBe(false);
  });

  it('finds case-insensitive matches without a lowercased copy', () => {
    const { matches } = findMatches('foo Foo FOO', 'foo', opts);
    expect(matches).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
      { from: 8, to: 11 },
    ]);
  });

  it('treats query metacharacters literally in plain mode', () => {
    const { matches } = findMatches('a.b axb a.b', 'a.b', opts);
    expect(matches).toEqual([
      { from: 0, to: 3 },
      { from: 8, to: 11 },
    ]);
  });

  it('respects whole-word matching', () => {
    const { matches } = findMatches('foo foobar barfoo foo', 'foo', {
      ...opts,
      wholeWord: true,
    });
    expect(matches).toEqual([
      { from: 0, to: 3 },
      { from: 18, to: 21 },
    ]);
  });

  it('supports regex mode with whole-word filtering', () => {
    const { matches } = findMatches('cat category cat', 'cat', {
      ...opts,
      regex: true,
      wholeWord: true,
    });
    expect(matches).toEqual([
      { from: 0, to: 3 },
      { from: 13, to: 16 },
    ]);
  });

  it('does not loop forever on zero-length regex matches', () => {
    const { matches } = findMatches('abc', 'x*', { ...opts, regex: true });
    // 每个位置都能空匹配，但空匹配不应产生装饰范围
    expect(matches).toEqual([]);
  });

  it('returns an empty result for invalid regex instead of throwing', () => {
    expect(findMatches('abc', '(', { ...opts, regex: true })).toEqual({
      matches: [],
      truncated: false,
    });
  });

  it('caps the number of matches', () => {
    const doc = 'ab'.repeat(MAX_SEARCH_MATCHES + 10);
    const { matches, truncated } = findMatches(doc, 'ab', opts);
    expect(matches.length).toBe(MAX_SEARCH_MATCHES);
    expect(truncated).toBe(true);
  });

  it('returns empty for empty inputs', () => {
    expect(findMatches('', 'a', opts)).toEqual({ matches: [], truncated: false });
    expect(findMatches('abc', '', opts)).toEqual({ matches: [], truncated: false });
  });
});

describe('search-text: helpers', () => {
  it('isWholeWord checks both sides', () => {
    expect(isWholeWord('foo bar', 0, 3)).toBe(true);
    expect(isWholeWord('foobar', 0, 3)).toBe(false);
    expect(isWholeWord('barfoo', 3, 6)).toBe(false);
  });

  it('escapeRegExp escapes metacharacters', () => {
    expect(new RegExp(escapeRegExp('a.b*c')).test('a.b*c')).toBe(true);
    expect(new RegExp(escapeRegExp('a.b*c')).test('axbbc')).toBe(false);
  });
});
