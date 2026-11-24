import { listen } from '@tauri-apps/api/event';

import { readAppConfig, writeAppConfig } from '@/utils/appConfig';

import { coverageOf, type AgentConsentRecord } from './consent';
import {
  availableProviders,
  defaultModelFor as catalogDefaultModel,
  isAgentProviderId,
  type AgentProviderId,
} from './providers-catalog';
import { currentRegion, isMainlandChina, loadStoreRegion } from './region';

export type AgentSurface = 'floating' | 'sidebar';

export interface AgentProfile {
  id: string;
  name: string;
  provider: AgentProviderId;
  model: string;
  apiKey: string;
  baseUrl: string;
  /** 是否出现在插件配置下拉里；运行时不拦截已绑定的插件 */
  enabled: boolean;
}

export interface AgentSettings {
  enabled: boolean;
  profiles: AgentProfile[];
  /** 仅作审计：不参与可用性判定（判定只看 enabled + profile 完整性）。 */
  consent: AgentConsentRecord | null;
  surface: AgentSurface;
}

export type { AgentConsentRecord, AgentProviderId };

const INITIAL: AgentSettings = {
  enabled: false,
  profiles: [],
  consent: null,
  surface: 'floating',
};

let settings: AgentSettings = { ...INITIAL };
let loaded = false;
/** 每个生命周期（init/reset）一代；迟到的异步结果不写进新一代状态。 */
let generation = 0;
let unsubscribeConfig: (() => void) | null = null;
let pendingInit: Promise<void> | null = null;
let writeQueue: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function normalizeSurface(raw: unknown): AgentSurface {
  return raw === 'sidebar' ? 'sidebar' : 'floating';
}

function normalizeConsent(raw: unknown): AgentConsentRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.version !== 'number' || typeof value.accepted_at !== 'string') return null;
  const providers = Array.isArray(value.providers)
    ? value.providers.filter(isAgentProviderId)
    : [];
  return { version: value.version, acceptedAt: value.accepted_at, providers };
}

/**
 * 解析磁盘上的 profile 列表（只读视图用，不用于写回）。
 *
 * 重复 id 时**首个胜出**（与插件贡献的 last-wins 相反）：配置 id 由前端生成，
 * 出现重复即意味着数据损坏，保留首条更可预测。
 */
function normalizeProfiles(raw: unknown): AgentProfile[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: AgentProfile[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!id || !name || seen.has(id)) continue;
    if (!isAgentProviderId(value.provider)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      provider: value.provider,
      model: typeof value.model === 'string' ? value.model : '',
      apiKey: typeof value.api_key === 'string' ? value.api_key : '',
      baseUrl: typeof value.base_url === 'string' ? value.base_url : '',
      enabled: value.enabled === true,
    });
  }
  return out;
}

function applyConfig(raw: Record<string, unknown>) {
  const next: AgentSettings = {
    enabled: raw.agent_enabled === true,
    profiles: normalizeProfiles(raw.agent_profiles),
    consent: normalizeConsent(raw.agent_consent),
    surface: normalizeSurface(raw.agent_result_surface),
  };
  loaded = true;
  const unchanged =
    next.enabled === settings.enabled &&
    next.surface === settings.surface &&
    JSON.stringify(next.consent) === JSON.stringify(settings.consent) &&
    JSON.stringify(next.profiles) === JSON.stringify(settings.profiles);
  if (unchanged) return;
  settings = next;
  notify();
}

export async function loadAgentSettings(): Promise<void> {
  const gen = generation;
  try {
    const raw = await readAppConfig<Record<string, unknown>>();
    if (gen !== generation) return;
    applyConfig(raw);
  } catch {
    // 浏览器或未初始化：保持默认
  }
}

export function subscribeAgentSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAgentSettings(): AgentSettings {
  return settings;
}

export function listAgentProfiles(): AgentProfile[] {
  return [...settings.profiles];
}

export function findAgentProfile(id: string | null | undefined): AgentProfile | null {
  if (!id) return null;
  return settings.profiles.find((profile) => profile.id === id) ?? null;
}

export function isProfileComplete(profile: AgentProfile): boolean {
  if (!profile.model.trim() || !profile.apiKey.trim()) return false;
  return profile.provider !== 'custom' || profile.baseUrl.trim().length > 0;
}

/** 仅用于同意页展示与审计写入，不参与可用性判定。 */
export function consentCoverage(): AgentProviderId[] {
  const mainland = isMainlandChina(currentRegion());
  return coverageOf(mainland, settings.profiles.map((profile) => profile.provider));
}

/** 已加载且总开关打开；不含 profile 完整性与同意。 */
export function agentEnabled(): boolean {
  return loaded && settings.enabled;
}

export function isAgentSwitchOn(): boolean {
  return settings.enabled;
}

export function agentAvailable(profileId: string): boolean {
  const profile = findAgentProfile(profileId);
  return agentEnabled() && !!profile && isProfileComplete(profile);
}

/**
 * 新建 profile 的默认 name：`<显示名> · <模型>`。
 *
 * `label` 由调用方传本地化后的 provider 显示名，缺省回退 provider id
 * （骨架不持有文案，也不硬编码 provider 分支）。
 */
export function defaultProfileName(
  provider: AgentProviderId,
  model: string,
  label: string = provider,
): string {
  return model ? `${label} · ${model}` : label;
}

export function newProfileId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultModelFor(provider: AgentProviderId): string {
  return catalogDefaultModel(provider);
}

export function providerChoices(): AgentProviderId[] {
  return availableProviders(isMainlandChina(currentRegion()));
}

export type AgentSettingsPatch = Partial<
  Pick<AgentSettings, 'enabled' | 'surface' | 'profiles'>
> & {
  /** undefined = 不改；null = 清除同意记录 */
  consent?: AgentConsentRecord | null;
};

/** TS camelCase → AppConfig snake_case（Rust `AgentModelProfile`）。 */
function toRawProfile(profile: AgentProfile) {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    model: profile.model,
    api_key: profile.apiKey,
    base_url: profile.baseUrl,
    enabled: profile.enabled,
  };
}

async function writeAgentSettings(patch: AgentSettingsPatch): Promise<void> {
  const gen = generation;
  const raw = await readAppConfig<Record<string, unknown>>();
  if (gen !== generation) return;
  // 未提供 profiles 时原样保留磁盘内容：normalize 后的子集只用于读取展示，
  // 写回它会丢掉未知 provider / 非法条目（以及其 API Key）。
  const profiles =
    patch.profiles !== undefined
      ? patch.profiles.map(toRawProfile)
      : Array.isArray(raw.agent_profiles)
        ? (raw.agent_profiles as unknown[])
        : [];
  const next = {
    ...raw,
    agent_enabled: patch.enabled ?? (raw.agent_enabled === true),
    agent_result_surface: patch.surface ?? normalizeSurface(raw.agent_result_surface),
    agent_profiles: profiles,
    agent_consent:
      patch.consent === undefined
        ? (raw.agent_consent ?? null)
        : patch.consent === null
          ? null
          : {
              version: patch.consent.version,
              accepted_at: patch.consent.acceptedAt,
              providers: patch.consent.providers,
            },
  };
  await writeAppConfig(next);
  if (gen !== generation) return;
  applyConfig(next);
}

export function updateAgentSettings(patch: AgentSettingsPatch): Promise<void> {
  return enqueueWrite(() => writeAgentSettings(patch));
}

/** 串行化写配置：同一时刻只有一条 writeAppConfig 在飞。 */
function enqueueWrite(task: () => Promise<void>): Promise<void> {
  const run = writeQueue.then(task);
  writeQueue = run.catch(() => {});
  return run;
}

/**
 * 新增或更新单条 profile：以磁盘原始数组为底按 id 合并。
 *
 * 不能用 `listAgentProfiles()`（normalize 后的只读子集）整表替换——那会连带
 * 删掉未知 provider / 非法条目的 API Key。
 */
export function upsertAgentProfile(profile: AgentProfile): Promise<void> {
  const gen = generation;
  return enqueueWrite(async () => {
    const raw = await readAppConfig<Record<string, unknown>>();
    if (gen !== generation) return;
    const list = Array.isArray(raw.agent_profiles) ? [...(raw.agent_profiles as unknown[])] : [];
    const nextProfile = toRawProfile(profile);
    const index = list.findIndex(
      (item) => !!item && typeof item === 'object' && (item as { id?: unknown }).id === profile.id,
    );
    if (index >= 0) {
      list[index] = { ...(list[index] as Record<string, unknown>), ...nextProfile };
    } else {
      list.push(nextProfile);
    }
    const next = { ...raw, agent_profiles: list };
    await writeAppConfig(next);
    if (gen === generation) applyConfig(next);
  });
}

/** 按 id 删除单条 profile，保留其它（含未知）条目。 */
export function removeAgentProfile(id: string): Promise<void> {
  const gen = generation;
  return enqueueWrite(async () => {
    const raw = await readAppConfig<Record<string, unknown>>();
    if (gen !== generation) return;
    const list = Array.isArray(raw.agent_profiles) ? (raw.agent_profiles as unknown[]) : [];
    const next = {
      ...raw,
      agent_profiles: list.filter(
        (item) => !item || typeof item !== 'object' || (item as { id?: unknown }).id !== id,
      ),
    };
    await writeAppConfig(next);
    if (gen === generation) applyConfig(next);
  });
}

/**
 * 启动期初始化：先订阅 `config-changed` 广播（多窗口同步），再读地区与配置，
 * 避免订阅建立之前到达的变更丢失。并发调用复用同一个 promise，只订阅一次。
 */
export function initAgentSettings(): Promise<void> {
  if (pendingInit) return pendingInit;
  const gen = generation;
  pendingInit = (async () => {
    if (!unsubscribeConfig) {
      try {
        const unsubscribe = await listen<Record<string, unknown>>('config-changed', (event) => {
          applyConfig(event.payload);
        });
        if (gen !== generation) {
          unsubscribe();
        } else {
          unsubscribeConfig = unsubscribe;
        }
      } catch {
        // 非 Tauri：忽略
      }
    }
    if (gen !== generation) return;
    await Promise.all([loadStoreRegion(), loadAgentSettings()]);
  })().finally(() => {
    if (gen === generation) pendingInit = null;
  });
  return pendingInit;
}

export function resetAgentConfigForTests(): void {
  generation += 1;
  loaded = false;
  settings = { ...INITIAL };
  listeners.clear();
  unsubscribeConfig?.();
  unsubscribeConfig = null;
  pendingInit = null;
  writeQueue = Promise.resolve();
}
