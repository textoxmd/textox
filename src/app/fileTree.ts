import type { FileNode } from '@/components/sidebar/file-tree/types';
import type { OutlineStyle } from './types';

export interface RustFileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: RustFileNode[];
  hasChildren?: boolean;
  tagColor?: string | null;
}

export function convertFileNode(rustNode: RustFileNode): FileNode {
  return {
    name: rustNode.name,
    path: rustNode.path,
    isDirectory: rustNode.isDirectory,
    children: rustNode.children?.map(convertFileNode),
    has_children: rustNode.hasChildren,
    tagColor: rustNode.tagColor ?? null,
  };
}

// 将目录内容包装为根目录节点
export function createRootNode(rootPath: string, children: FileNode[]): FileNode[] {
  const separator = rootPath.includes('\\') ? '\\' : '/';
  const cleanPath = rootPath.replace(/[/\\]+$/, '');
  const name = cleanPath.split(separator).pop() || cleanPath;
  return [{
    name,
    path: rootPath,
    isDirectory: true,
    children,
    has_children: children.length > 0,
  }];
}

export const toOutlineStyle = (v: string | undefined | null): OutlineStyle =>
  v === 'text' || v === 'minimap' ? v : 'off';
