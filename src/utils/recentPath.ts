// 归一化最近打开文件/目录路径：去除末尾的路径分隔符（/ 和 \），
// 避免同一目录因末尾斜杠差异被重复记录到最近打开列表。
// macOS 从 Finder/Dock 打开目录时路径可能带末尾斜杠（file:///.../Documents/），
// 而目录选择对话框返回的路径不带，二者应视为同一路径。
export function normalizeRecentPath(path: string): string {
  if (!path) return path;
  const trimmed = path.replace(/[/\\]+$/, '');
  // 根目录（/）或 Windows 盘符根目录（如 C:\）保留原始分隔符
  if (trimmed === '' || /^[A-Za-z]:$/.test(trimmed)) return path;
  return trimmed;
}
