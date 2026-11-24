import type { AgentProfile } from './config';

export type ProfileBindingState = 'unset' | 'ok' | 'inactive' | 'deleted';

export interface ProfileOption {
  id: string;
  label: string;
  /** 仅表示该配置已停用：仍可被当前绑定选中，但会标注「已停用」。 */
  inactive: boolean;
}

function labelOf(profile: AgentProfile): string {
  return [profile.name, profile.model].filter(Boolean).join(' · ');
}

/**
 * 插件配置下拉的选项与绑定状态：
 * - 只列已启用的配置；
 * - 当前绑定的配置即使已停用也保留（避免下拉显示为空）；
 * - 已删除的绑定不出现在选项里，由 `state = 'deleted'` 表达。
 */
export function profileOptions(
  profiles: readonly AgentProfile[],
  currentId: string,
): { options: ProfileOption[]; state: ProfileBindingState } {
  const options = profiles
    .filter((profile) => profile.enabled || profile.id === currentId)
    .map((profile) => ({
      id: profile.id,
      label: labelOf(profile),
      inactive: !profile.enabled,
    }));

  if (!currentId) return { options, state: 'unset' };
  const bound = profiles.find((profile) => profile.id === currentId);
  if (!bound) return { options, state: 'deleted' };
  return { options, state: bound.enabled ? 'ok' : 'inactive' };
}
