import { describe, it, expect } from 'vitest';
import { getPathRelativeToRoot } from '../relativePath';

describe('getPathRelativeToRoot', () => {
  it('returns "." for the root itself', () => {
    expect(getPathRelativeToRoot('/Users/me/notes', '/Users/me/notes')).toBe('.');
  });

  it('returns the relative path for a direct child', () => {
    expect(getPathRelativeToRoot('/Users/me/notes', '/Users/me/notes/readme.md')).toBe('readme.md');
  });

  it('returns the relative path for a nested node', () => {
    expect(getPathRelativeToRoot('/Users/me/notes', '/Users/me/notes/sub/dir/file.md')).toBe('sub/dir/file.md');
  });

  it('ignores a trailing separator on the root path', () => {
    expect(getPathRelativeToRoot('/Users/me/notes/', '/Users/me/notes/sub/file.md')).toBe('sub/file.md');
  });

  it('handles Windows backslash paths and normalizes output to forward slashes', () => {
    expect(getPathRelativeToRoot('C:\\Users\\me\\notes', 'C:\\Users\\me\\notes\\sub\\file.md')).toBe('sub/file.md');
  });

  it('falls back to the full path when the node is outside the root', () => {
    expect(getPathRelativeToRoot('/Users/me/notes', '/Users/me/other/file.md')).toBe('/Users/me/other/file.md');
  });
});
