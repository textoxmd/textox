import { describe, expect, it } from 'vitest';
import {
  hashContent,
  isContentCandidate,
  isDiskContentUnchanged,
  isFsEventForPath,
  statMatchesFingerprint,
  uniqueKnownContents,
  type FileFingerprint,
} from '../externalChange';

describe('hashContent', () => {
  it('produces the standard SHA-256 hex digest', async () => {
    expect(await hashContent('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is deterministic for the same input', async () => {
    const content = 'same input 中文内容';
    expect(await hashContent(content)).toBe(await hashContent(content));
  });
});

describe('uniqueKnownContents', () => {
  it('drops undefined and duplicates while keeping order of first occurrence', () => {
    expect(uniqueKnownContents(['a', undefined, 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('keeps empty strings as valid known contents', () => {
    expect(uniqueKnownContents(['', undefined])).toEqual(['']);
  });
});

describe('isContentCandidate', () => {
  it('treats data and any as content candidates', () => {
    expect(isContentCandidate('data')).toBe(true);
    expect(isContentCandidate('any')).toBe(true);
  });

  it('ignores metadata and undefined', () => {
    expect(isContentCandidate('metadata')).toBe(false);
    expect(isContentCandidate(undefined)).toBe(false);
  });
});

describe('isFsEventForPath', () => {
  it('matches a non-directory event for the current file path', () => {
    expect(isFsEventForPath('/a/b.md', '/a/b.md', false)).toBe(true);
  });

  it('does not match directory events or events for other paths', () => {
    expect(isFsEventForPath('/a/b.md', '/a/b.md', true)).toBe(false);
    expect(isFsEventForPath('/a/b.md', '/a/c.md', false)).toBe(false);
  });

  it('does not match when no file is open', () => {
    expect(isFsEventForPath(null, '/a/b.md', false)).toBe(false);
    expect(isFsEventForPath(undefined, '/a/b.md', false)).toBe(false);
  });
});

describe('statMatchesFingerprint', () => {
  const fingerprint: FileFingerprint = { size: 100, mtimeMs: 1234 };

  it('returns true when size and mtime both match', () => {
    expect(statMatchesFingerprint(fingerprint, { size: 100, mtimeMs: 1234 })).toBe(true);
  });

  it('returns false when size differs (external add/delete)', () => {
    expect(statMatchesFingerprint(fingerprint, { size: 90, mtimeMs: 1234 })).toBe(false);
  });

  it('returns false when mtime differs', () => {
    expect(statMatchesFingerprint(fingerprint, { size: 100, mtimeMs: 9999 })).toBe(false);
  });

  it('returns false without a fingerprint or with missing stat fields', () => {
    expect(statMatchesFingerprint(undefined, { size: 100, mtimeMs: 1234 })).toBe(false);
    expect(statMatchesFingerprint(fingerprint, { size: 100 })).toBe(false);
    expect(statMatchesFingerprint(fingerprint, { mtimeMs: 1234 })).toBe(false);
  });
});

describe('isDiskContentUnchanged', () => {
  it('returns true when disk content matches a known content', () => {
    expect(isDiskContentUnchanged('abc', ['abc', 'def'])).toBe(true);
  });

  it('returns false when disk content differs from all known contents', () => {
    expect(isDiskContentUnchanged('xyz', ['abc', 'def'])).toBe(false);
  });

  it('ignores undefined entries', () => {
    expect(isDiskContentUnchanged('abc', [undefined, 'abc'])).toBe(true);
    expect(isDiskContentUnchanged('abc', [undefined])).toBe(false);
  });
});
