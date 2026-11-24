export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  has_children?: boolean;
  /** Finder 标签颜色键（macOS），未设置颜色时为 null */
  tagColor?: string | null;
}

export interface RenamingNode {
  path: string;
  name: string;
}

export function findNodeInTree(nodes: FileNode[], path: string): FileNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children) {
      const found = findNodeInTree(n.children, path);
      if (found) return found;
    }
  }
  return null;
}

export function getFileNameWithoutExt(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex > 0) return fileName.substring(0, lastDotIndex);
  return fileName;
}

export function getFileExt(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex > 0 && lastDotIndex < fileName.length - 1) {
    return fileName.substring(lastDotIndex + 1).toLowerCase();
  }
  return '';
}

export function generateUniqueNameWithExisting(
  existingNames: Set<string>,
  baseName: string,
  isDirectory: boolean,
): string {
  if (!existingNames.has(baseName)) return baseName;
  const dotIndex = baseName.lastIndexOf('.');
  let name: string;
  let ext: string;
  if (dotIndex > 0) {
    name = baseName.substring(0, dotIndex);
    ext = baseName.substring(dotIndex);
  } else {
    name = baseName;
    ext = isDirectory ? '' : '.md';
  }
  let counter = 1;
  let newName: string;
  while (true) {
    newName = isDirectory ? `${name} ${counter}` : `${name} ${counter}${ext}`;
    if (!existingNames.has(newName)) return newName;
    counter++;
  }
}
