/**
 * 计算节点路径相对于根目录的路径，统一使用 `/` 分隔符输出。
 * 当节点就是根目录本身时返回 `.`。
 */
export function getPathRelativeToRoot(rootPath: string, nodePath: string): string {
  const cleanRoot = rootPath.replace(/[/\\]+$/, '');
  if (cleanRoot === nodePath) return '.';

  const separator = cleanRoot.includes('\\') ? '\\' : '/';
  const prefix = cleanRoot + separator;
  if (nodePath.startsWith(prefix)) {
    return nodePath.slice(prefix.length).split(/[\\/]/).join('/');
  }
  return nodePath;
}
