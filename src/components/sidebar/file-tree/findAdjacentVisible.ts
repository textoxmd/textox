import type { FileNode } from './types';

export function findAdjacentVisible(
  nodes: FileNode[],
  expandedPaths: Set<string>,
  currentPath: string | null,
  direction: 'up' | 'down',
): string | null {
  const visible: string[] = [];
  function walk(list: FileNode[]) {
    for (const node of list) {
      visible.push(node.path);
      if (node.isDirectory && expandedPaths.has(node.path) && node.children) {
        walk(node.children);
      }
    }
  }
  walk(nodes);

  if (visible.length === 0) return null;

  if (currentPath === null) {
    return direction === 'down' ? visible[0] : visible[visible.length - 1];
  }

  const idx = visible.indexOf(currentPath);
  if (idx === -1) return null;

  if (direction === 'down') {
    return idx + 1 < visible.length ? visible[idx + 1] : null;
  } else {
    return idx - 1 >= 0 ? visible[idx - 1] : null;
  }
}
