/**
 * 工作区路径解析（纯函数，便于单测）。
 *
 * MCP 的 `textox_create_entry` 允许传相对路径或绝对路径，但必须落在当前工作区内；
 * 只做字符串前缀比较是不够的 —— `../secret.md` 会以「工作区/../secret.md」的
 * 形式通过检查，所以这里先做 posix 归一（折叠 `.` / `..`），再比较边界。
 */

/** 统一斜杠方向并折叠重复分隔符（前端各处路径都以 `/` 拼接）。 */
export function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:\//.test(normalizeSlashes(path));
}

/**
 * 归一 `.` / `..`（posix 语义）。`..` 吃掉根目录时返回 null —— 这是「逃出边界」的
 * 信号，调用方必须把它当成错误而不是继续拼接。
 */
export function normalizePath(path: string): string | null {
  const unified = normalizeSlashes(path);
  const absolute = unified.startsWith('/');
  const segments: string[] = [];
  for (const segment of unified.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      // 不允许越过根（含 Windows 盘符根）。
      if (segments.length === 0) return null;
      if (segments.length === 1 && /^[a-zA-Z]:$/.test(segments[0])) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `${absolute ? '/' : ''}${segments.join('/')}`;
}

/**
 * 把请求里的 path 解析成工作区内的绝对路径；越界或无法解析时抛错。
 *
 * 注意：这里只做**词法**归一，不解析符号链接 —— 工作区内的链接仍可指向外部。
 */
export function resolveWorkspacePath(raw: string, root: string): string {
  const normalizedRoot = normalizePath(root);
  if (!normalizedRoot) throw new Error(`工作区路径无法解析: ${root}`);
  const combined = isAbsolutePath(raw) ? raw : `${normalizedRoot}/${raw}`;
  const resolved = normalizePath(combined);
  if (!resolved) throw new Error(`路径不在当前工作区内: ${raw}`);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}/`)) {
    throw new Error(`路径不在当前工作区内: ${resolved}`);
  }
  return resolved;
}
