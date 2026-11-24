/**
 * 判断图片自定义存储路径是否为绝对路径：
 * - POSIX：以 `/` 开头
 * - Windows 盘符：`X:\` 或 `X:/`
 * - Windows UNC：以 `\\` 开头
 * 相对路径（`assets`、`./assets`、`../images`）与空串返回 false。
 */
export function isAbsoluteImageStoragePath(path: string): boolean {
  if (!path) return false;
  if (path.startsWith("/")) return true;
  if (/^[a-zA-Z]:[\\/]/.test(path)) return true;
  if (path.startsWith("\\\\")) return true;
  return false;
}
