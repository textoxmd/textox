import { describe, it, expect } from 'vitest';
import { findAdjacentVisible } from '../findAdjacentVisible';
import type { FileNode } from '../types';

const tree: FileNode[] = [
  {
    name: 'src',
    path: '/root/src',
    isDirectory: true,
    children: [
      { name: 'index.ts', path: '/root/src/index.ts', isDirectory: false },
      { name: 'utils', path: '/root/src/utils', isDirectory: true, children: [
        { name: 'helper.ts', path: '/root/src/utils/helper.ts', isDirectory: false },
      ]},
      { name: 'app.ts', path: '/root/src/app.ts', isDirectory: false },
    ],
  },
  { name: 'README.md', path: '/root/README.md', isDirectory: false },
];

const expanded = new Set(['/root/src', '/root/src/utils']);

describe('findAdjacentVisible', () => {
  it('returns next node after current in DFS order', () => {
    const next = findAdjacentVisible(tree, expanded, '/root/src/index.ts', 'down');
    expect(next).toBe('/root/src/utils');
  });

  it('returns null when current is last visible', () => {
    const next = findAdjacentVisible(tree, expanded, '/root/README.md', 'down');
    expect(next).toBeNull();
  });

  it('returns prev node before current in DFS order', () => {
    const prev = findAdjacentVisible(tree, expanded, '/root/src/app.ts', 'up');
    expect(prev).toBe('/root/src/utils/helper.ts');
  });

  it('returns null when current is first visible', () => {
    const prev = findAdjacentVisible(tree, expanded, '/root/src', 'up');
    expect(prev).toBeNull();
  });

  it('skips children of collapsed directories', () => {
    const next = findAdjacentVisible(tree, new Set(), '/root/src', 'down');
    expect(next).toBe('/root/README.md');
  });

  it('returns first visible when currentPath is null and direction is down', () => {
    const first = findAdjacentVisible(tree, expanded, null, 'down');
    expect(first).toBe('/root/src');
  });

  it('returns last visible when currentPath is null and direction is up', () => {
    const last = findAdjacentVisible(tree, expanded, null, 'up');
    expect(last).toBe('/root/README.md');
  });
});
