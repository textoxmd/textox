import type { AgentSessionStatus } from './session';

export type AgentSidebarTab = 'files' | 'outline';

export function isAgentTabVisible(status: AgentSessionStatus): boolean {
  return status !== 'idle';
}

/**
 * 关闭释义后恢复原 tab；目标不可用时回落到可用项。
 * 返回 null 表示交给 App 的自然默认（无目录时为大纲）。
 */
export function restoreTabAfterClose(
  previous: AgentSidebarTab,
  opts: { hasFile: boolean; hasRoot: boolean },
): AgentSidebarTab | null {
  if (previous === 'outline' && opts.hasFile) return 'outline';
  if (previous === 'files' && opts.hasRoot) return 'files';
  if (opts.hasRoot) return 'files';
  return null;
}

export interface ActiveTabInput {
  agentTabVisible: boolean;
  showAgent: boolean;
  /** showAgent 仍为 true 但 tab 已隐藏时，关闭后应回到的 tab；否则 null */
  closingTarget: AgentSidebarTab | null;
  showOutline: boolean;
  hasRoot: boolean;
  isSingleFileMode: boolean;
}

export function resolveActiveTab(input: ActiveTabInput): 'files' | 'outline' | 'ai' {
  if (input.agentTabVisible && input.showAgent) return 'ai';
  if (input.closingTarget) return input.closingTarget;
  return input.showOutline || !input.hasRoot || input.isSingleFileMode ? 'outline' : 'files';
}
