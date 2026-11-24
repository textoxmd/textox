/** 引导完成时主窗口用于决定是否立即打开工作区的配置快照。 */
export interface OnboardingStartupConfig {
  startup_behavior?: string;
  workspace_folder?: string | null;
}

/** 主窗口当前状态：已打开的工作区、需要保留的正文、文档句柄类型。 */
export interface ApplyWorkspaceContext {
  /** 当前已打开的工作区目录（null = 未打开）。 */
  currentFolder: string | null;
  /** 当前缓冲是否有需要保留的正文。 */
  hasBufferToKeep: boolean;
  /** 当前文档句柄类型；已打开磁盘文件时不应自动切目录。 */
  fileHandleKind: 'none' | 'temp' | 'persistent';
}

/**
 * 引导关闭后需要立即打开的工作区目录，`null` 表示不切换。
 *
 * 主窗口在引导期间已按**旧配置**初始化（通常是一个空白临时文档），
 * 因此向导里选中的「工作区模式」必须在关闭时补一次打开动作，
 * 否则首次启动会停在空白窗口、直到下次启动才生效。
 *
 * 只在该切换不会破坏当前工作时才返回目录：
 * - 必须选了工作区且目录有效；
 * - 当前没有需要保留的正文（避免临时文件被删除导致内容丢失）；
 * - 当前没有打开磁盘文件；
 * - 目录与当前已打开的工作区不同（避免重复加载同一目录）。
 */
export function resolveOnboardingWorkspace(
  config: OnboardingStartupConfig | null | undefined,
  ctx: ApplyWorkspaceContext,
): string | null {
  if (!config || config.startup_behavior !== 'workspace') return null;

  const folder = config.workspace_folder;
  if (typeof folder !== 'string' || folder.length === 0) return null;

  if (ctx.currentFolder === folder) return null;
  if (ctx.hasBufferToKeep) return null;
  if (ctx.fileHandleKind === 'persistent') return null;

  return folder;
}
