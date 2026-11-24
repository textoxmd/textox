/**
 * 外部文件变更检测的纯判定函数（供 App 的文件监听流程使用，便于单元测试）。
 */

/** 已知安全的磁盘状态（修改时间 + 大小） */
export interface FileFingerprint {
  size: number;
  mtimeMs: number | null;
}

/** 事件附带的 stat 信息（字段可选，兼容后端未附带 stat 的情况） */
export interface EventStat {
  size?: number;
  mtimeMs?: number | null;
}

/** get_file_metadata 命令的返回结构 */
export type FileMetadata = FileFingerprint;

/** compare_file_content 命令的返回结构 */
export interface FileContentStatus {
  changed: boolean;
  size: number;
  mtimeMs: number | null;
}

/** 计算内容的 SHA-256 十六进制摘要（用于把大内容压缩成小哈希后再走 IPC） */
export async function hashContent(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 去重后的已知内容列表（undefined 项忽略） */
export function uniqueKnownContents(
  knownContents: ReadonlyArray<string | undefined>,
): string[] {
  return [...new Set(knownContents.filter((v): v is string => typeof v === 'string'))];
}

/**
 * 是否为内容类候选事件：
 * - data：原地写入产生的内容修改；
 * - any：macOS 上原子替换保存（临时文件覆盖）产生 Name(Any)，也按内容候选处理。
 */
export function isContentCandidate(modifyKind: string | undefined): boolean {
  return modifyKind === 'data' || modifyKind === 'any';
}

/**
 * 是否为元数据（扩展属性）修改事件。
 *
 * Finder 改文件颜色只写扩展属性，notify 会报成 `Metadata(Extended)`，
 * 这类事件虽然与文件内容无关，但需要刷新目录树，否则侧边栏的颜色圆点
 * 会一直停留在旧颜色上。
 */
export function isMetadataKind(modifyKind: string | undefined): boolean {
  return modifyKind === 'metadata';
}

/**
 * fs 事件是否针对当前打开文件（目录事件不参与比对）。
 * “删除 + 同名重建”处理依赖这个判断：只有事件路径等于当前文件路径时才保留缓冲。
 */
export function isFsEventForPath(
  currentPath: string | null | undefined,
  eventPath: string | undefined,
  isDirectory?: boolean,
): boolean {
  return !isDirectory && !!currentPath && currentPath === eventPath;
}

/**
 * stat 与指纹一致 → 磁盘状态已知且未变化，可安全跳过内容读取。
 * 任一字段缺失（如后端未附带 stat）时返回 false，回退到内容比对。
 */
export function statMatchesFingerprint(
  fingerprint: FileFingerprint | undefined,
  eventStat: EventStat | undefined,
): boolean {
  return (
    fingerprint !== undefined &&
    eventStat?.mtimeMs != null &&
    eventStat.size != null &&
    eventStat.mtimeMs === fingerprint.mtimeMs &&
    eventStat.size === fingerprint.size
  );
}

/**
 * 磁盘内容与任一已知内容一致 → 无真实变化（覆盖自身写入回显、元数据噪音、同内容重写）。
 * 未定义项（如“应用从未写入过该文件”）不参与比较。
 */
export function isDiskContentUnchanged(
  diskContent: string,
  knownContents: ReadonlyArray<string | undefined>,
): boolean {
  return knownContents.some((content) => content !== undefined && content === diskContent);
}
