import type { AgentProviderId } from './providers-catalog';
import { availableProviders, providerMeta } from './providers-catalog';

/** 同意文本版本号；仅写入审计记录，不参与可用性判定。 */
export const AI_CONSENT_VERSION = 1;

export interface AgentConsentRecord {
  version: number;
  acceptedAt: string;
  providers: AgentProviderId[];
}

/**
 * 覆盖集合里是否有境外服务商。
 *
 * `custom` 没有固定地区，不参与判定（页面另给中性提示）。
 * 目录外的未知 provider 同样按境内处理（类型与 `normalizeConsent` 已过滤）。
 */
export function hasOverseasProvider(coverage: readonly AgentProviderId[]): boolean {
  return coverage.some(
    (provider) => provider !== 'custom' && providerMeta(provider)?.availableInMainlandChina === false,
  );
}

/** 当前地区可用 ∪ 已有配置的 provider（去重、按地区顺序）。 */
export function coverageOf(
  mainland: boolean,
  profileProviders: readonly AgentProviderId[],
): AgentProviderId[] {
  const base = availableProviders(mainland);
  const extra = [...new Set(profileProviders)].filter((provider) => !base.includes(provider));
  return [...base, ...extra];
}
