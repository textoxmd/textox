import { describe, expect, it } from 'vitest';
import { normalizePath, resolveWorkspacePath } from '@/utils/workspacePath';

describe('normalizePath', () => {
  it('折叠 . 与重复分隔符', () => {
    expect(normalizePath('/a//b/./c/')).toBe('/a/b/c');
    expect(normalizePath('a\\b\\c')).toBe('a/b/c');
  });

  it('解析 ..', () => {
    expect(normalizePath('/a/b/../c')).toBe('/a/c');
    expect(normalizePath('/a/./b/../c/d/..')).toBe('/a/c');
  });

  it('越过根时返回 null', () => {
    expect(normalizePath('/../etc/passwd')).toBeNull();
    expect(normalizePath('../secret.md')).toBeNull();
    expect(normalizePath('/a/../../b')).toBeNull();
  });
});

describe('resolveWorkspacePath', () => {
  const root = '/Users/me/notes';

  it('接受工作区内的相对路径', () => {
    expect(resolveWorkspacePath('todo.md', root)).toBe('/Users/me/notes/todo.md');
    expect(resolveWorkspacePath('sub/../todo.md', root)).toBe('/Users/me/notes/todo.md');
    expect(resolveWorkspacePath('./a/b/c.md', root)).toBe('/Users/me/notes/a/b/c.md');
  });

  it('接受工作区内的绝对路径', () => {
    expect(resolveWorkspacePath('/Users/me/notes/a.md', root)).toBe('/Users/me/notes/a.md');
  });

  it('拒绝用 .. 逃出工作区', () => {
    expect(() => resolveWorkspacePath('../secret.md', root)).toThrow(/不在当前工作区内/);
    expect(() => resolveWorkspacePath('sub/../../secret.md', root)).toThrow(/不在当前工作区内/);
    expect(() => resolveWorkspacePath('/Users/me/secret.md', root)).toThrow(/不在当前工作区内/);
    expect(() => resolveWorkspacePath('/Users/me/notes-evil/a.md', root)).toThrow(
      /不在当前工作区内/,
    );
  });

  it('工作区根目录本身原样返回（由调用方决定是否拒绝）', () => {
    expect(resolveWorkspacePath('.', root)).toBe(root);
    expect(resolveWorkspacePath(root, root)).toBe(root);
  });
});
