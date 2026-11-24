/**
 * 计算引用在 markdown 中的写入路径（`![](...)` 的 src）：
 * - 选中文件位于文档目录下 → 返回相对路径（`/` 分隔）
 * - 否则返回绝对路径（POSIX 或 Windows 盘符）
 */
export function toDocumentRelativePath(
  absPath: string,
  documentPath: string,
): string {
  const normAbs = absPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const normDoc = documentPath.replace(/\\/g, "/");
  const docDir = normDoc.includes("/")
    ? normDoc.replace(/\/[^/]*$/, "")
    : "";
  if (!docDir) return normAbs;

  const absParts = normAbs.split("/");
  const dirParts = docDir.split("/");
  // Windows 不同盘符（如 C: vs D:）不可能有公共前缀 → 直接用绝对路径
  if (absParts[0] !== dirParts[0]) return normAbs;

  let common = 0;
  while (
    common < absParts.length - 1 &&
    common < dirParts.length &&
    absParts[common] === dirParts[common]
  ) {
    common++;
  }
  // 选中文件不在文档目录下 → 绝对路径
  if (common < dirParts.length) return normAbs;
  return absParts.slice(common).join("/") || normAbs;
}
