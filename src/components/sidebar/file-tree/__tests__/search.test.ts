import { describe, it, expect } from 'vitest';
import { highlightMatch } from '../search';

describe('highlightMatch', () => {
  it('returns full name as non-highlight when query is empty', () => {
    expect(highlightMatch('README.md', '')).toEqual([{ text: 'README.md', highlight: false }]);
  });

  it('returns full name as non-highlight when query is only whitespace', () => {
    expect(highlightMatch('README.md', '   ')).toEqual([{ text: 'README.md', highlight: false }]);
  });

  it('highlights a case-insensitive match', () => {
    expect(highlightMatch('README.md', 'readme')).toEqual([
      { text: 'README', highlight: true },
      { text: '.md', highlight: false },
    ]);
  });

  it('highlights multiple occurrences', () => {
    expect(highlightMatch('abab', 'ab')).toEqual([
      { text: 'ab', highlight: true },
      { text: 'ab', highlight: true },
    ]);
  });

  it('returns non-highlight segments when no match', () => {
    expect(highlightMatch('alpha.md', 'zzz')).toEqual([{ text: 'alpha.md', highlight: false }]);
  });

  it('preserves leading and trailing non-matching text', () => {
    expect(highlightMatch('my-report-final.md', 'report')).toEqual([
      { text: 'my-', highlight: false },
      { text: 'report', highlight: true },
      { text: '-final.md', highlight: false },
    ]);
  });
});
