import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import {
  agentAvailable,
  agentEnabled,
  consentCoverage,
  findAgentProfile,
  getAgentSettings,
  isProfileComplete,
  listAgentProfiles,
  loadAgentSettings,
  removeAgentProfile,
  resetAgentConfigForTests,
  updateAgentSettings,
  upsertAgentProfile,
} from '../config';
import { resetAppConfigCacheForTests } from '@/utils/appConfig';
import { AI_CONSENT_VERSION } from '../consent';
import type { AgentProviderId } from '../providers-catalog';
import { resetRegionForTests } from '../region';

/** 领域对象（camelCase，供 `isProfileComplete` / 写回 patch 使用）。 */
const profile = (id: string, provider: AgentProviderId, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  provider,
  model: 'm',
  apiKey: 'k',
  baseUrl: '',
  enabled: true,
  ...extra,
});

/** AppConfig 线上格式（snake_case，与 Rust serde 字段一致）。 */
const rawProfile = (id: string, provider: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  provider,
  model: 'm',
  api_key: 'k',
  base_url: '',
  enabled: true,
  ...extra,
});

function config(overrides: Record<string, unknown> = {}) {
  return {
    agent_enabled: true,
    agent_profiles: [rawProfile('p1', 'deepseek')],
    agent_consent: {
      version: AI_CONSENT_VERSION,
      accepted_at: '2026-11-01T00:00:00Z',
      providers: ['deepseek', 'zhipu', 'moonshot', 'qwen', 'custom'],
    },
    agent_result_surface: 'floating',
    ...overrides,
  };
}

beforeEach(() => {
  resetAgentConfigForTests();
  resetAppConfigCacheForTests();
  resetRegionForTests({ country: 'CN', source: 'locale' });
  invoke.mockReset();
});

/** 最近一次 `set_config` 写入的完整 AppConfig（lib 为 ES2020，不能用 `.at()`）。 */
function lastWrittenConfig(): Record<string, unknown> {
  const calls = invoke.mock.calls;
  return (calls[calls.length - 1][1] as { config: Record<string, unknown> }).config;
}

describe('agent config', () => {
  it('parses profiles and consent', async () => {
    invoke.mockResolvedValueOnce(config());
    await loadAgentSettings();
    expect(listAgentProfiles()).toHaveLength(1);
    expect(agentEnabled()).toBe(true);
    expect(getAgentSettings().consent?.version).toBe(AI_CONSENT_VERSION);
  });

  it('is disabled before settings load', () => {
    expect(agentEnabled()).toBe(false);
    expect(agentAvailable('p1')).toBe(false);
  });

  it('gates availability on the stored switch', async () => {
    invoke.mockResolvedValueOnce(config({ agent_enabled: false }));
    await loadAgentSettings();
    expect(agentEnabled()).toBe(false);
    expect(agentAvailable('p1')).toBe(false);
  });

  it('drops malformed profiles', async () => {
    invoke.mockResolvedValueOnce(
      config({
        agent_profiles: [rawProfile('bad', 'bogus'), { id: 'p2', provider: 'deepseek' }],
      }),
    );
    await loadAgentSettings();
    expect(listAgentProfiles()).toEqual([]);
  });

  it('drops duplicate profile ids', async () => {
    invoke.mockResolvedValueOnce(
      config({ agent_profiles: [rawProfile('p1', 'deepseek'), rawProfile('p1', 'zhipu')] }),
    );
    await loadAgentSettings();
    expect(listAgentProfiles().map((item) => item.id)).toEqual(['p1']);
    expect(listAgentProfiles()[0].provider).toBe('deepseek');
  });

  it('requires complete profiles', () => {
    expect(isProfileComplete(profile('p', 'deepseek') as never)).toBe(true);
    expect(isProfileComplete(profile('p', 'deepseek', { apiKey: '' }) as never)).toBe(false);
    expect(isProfileComplete(profile('p', 'custom') as never)).toBe(false);
    expect(
      isProfileComplete(profile('p', 'custom', { baseUrl: 'https://x/v1' }) as never),
    ).toBe(true);
  });

  it('does not gate availability on consent coverage', async () => {
    resetRegionForTests({ country: 'US', source: 'locale' });
    invoke.mockResolvedValueOnce(config());
    await loadAgentSettings();
    expect(consentCoverage()).toContain('anthropic');
    expect(getAgentSettings().consent?.providers).not.toContain('anthropic');
    expect(agentEnabled()).toBe(true);
    expect(agentAvailable('p1')).toBe(true);
  });

  it('ignores the profile enabled flag for availability', async () => {
    invoke.mockResolvedValueOnce(
      config({ agent_profiles: [rawProfile('p1', 'deepseek', { enabled: false })] }),
    );
    await loadAgentSettings();
    expect(agentAvailable('p1')).toBe(true);
    expect(agentAvailable('')).toBe(false);
    expect(agentAvailable('missing')).toBe(false);
    expect(() => agentAvailable('missing')).not.toThrow();
    expect(findAgentProfile('missing')).toBeNull();
    expect(getAgentSettings().consent?.version).toBe(AI_CONSENT_VERSION);
  });

  it('writes profiles and consent through set_config', async () => {
    invoke.mockResolvedValueOnce(config());
    await loadAgentSettings();
    // 写回前会再读一次 AppConfig（读取-合并-写回），此处返回当前已存的配置。
    invoke.mockResolvedValueOnce(config());
    await updateAgentSettings({
      profiles: [profile('p1', 'deepseek'), profile('p2', 'zhipu', { model: 'glm-5.3' })],
      consent: {
        version: AI_CONSENT_VERSION,
        acceptedAt: '2026-11-02T00:00:00Z',
        providers: ['deepseek'],
      },
    });
    const writtenCall = invoke.mock.calls.find((call) => call[0] === 'set_config');
    expect(writtenCall).toBeDefined();
    const written = (writtenCall?.[1] as { config: Record<string, unknown> }).config;
    expect(written.agent_profiles).toEqual([
      {
        id: 'p1',
        name: 'p1',
        provider: 'deepseek',
        model: 'm',
        api_key: 'k',
        base_url: '',
        enabled: true,
      },
      {
        id: 'p2',
        name: 'p2',
        provider: 'zhipu',
        model: 'glm-5.3',
        api_key: 'k',
        base_url: '',
        enabled: true,
      },
    ]);
    expect(written.agent_consent).toMatchObject({ providers: ['deepseek'] });
    expect(written.agent_enabled).toBe(true);
  });

  it('keeps untouched profiles on unrelated writes', async () => {
    const raw = config({
      agent_profiles: [rawProfile('p1', 'deepseek'), rawProfile('p2', 'future-ai')],
    });
    invoke.mockResolvedValueOnce(raw);
    await loadAgentSettings();
    // 读取时未知 provider 被丢弃（只影响内存视图）……
    expect(listAgentProfiles().map((item) => item.id)).toEqual(['p1']);
    invoke.mockResolvedValueOnce(raw);
    await updateAgentSettings({ surface: 'sidebar' });
    // ……但写回必须原样保留磁盘上的条目及其 API Key。
    const written = lastWrittenConfig();
    expect(written.agent_profiles).toHaveLength(2);
    expect(written.agent_result_surface).toBe('sidebar');
    expect(written.agent_enabled).toBe(true);
  });

  it('clears consent with null', async () => {
    invoke.mockResolvedValueOnce(config());
    await loadAgentSettings();
    invoke.mockResolvedValueOnce(config());
    await updateAgentSettings({ consent: null });
    const written = lastWrittenConfig();
    expect(written.agent_consent).toBeNull();
    expect(getAgentSettings().consent).toBeNull();
    expect(agentEnabled()).toBe(true);
    expect(agentAvailable('p1')).toBe(true);
  });

  it('lets the patch override the stored switch', async () => {
    invoke.mockResolvedValueOnce(config());
    await loadAgentSettings();
    invoke.mockResolvedValueOnce(config());
    await updateAgentSettings({ enabled: false });
    const written = lastWrittenConfig();
    expect(written.agent_enabled).toBe(false);
  });

  it('keeps the consent record when the switch is turned off', async () => {
    invoke.mockResolvedValueOnce(config());
    await loadAgentSettings();
    invoke.mockResolvedValueOnce(config());
    await updateAgentSettings({ enabled: false });
    const written = lastWrittenConfig();
    expect(written.agent_enabled).toBe(false);
    expect(written.agent_consent).not.toBeNull();
  });

  it('serializes concurrent writes', async () => {
    invoke.mockResolvedValueOnce(config());
    await loadAgentSettings();
    invoke.mockResolvedValue(config());
    await Promise.all([
      updateAgentSettings({ surface: 'sidebar' }),
      updateAgentSettings({ enabled: false }),
    ]);
    const setCalls = invoke.mock.calls
      .filter(([command]) => command === 'set_config')
      .map(([, args]) => (args as { config: Record<string, unknown> }).config);
    expect(setCalls).toHaveLength(2);
    expect(setCalls[0].agent_result_surface).toBe('sidebar');
    expect(setCalls[1].agent_enabled).toBe(false);
  });

  it('upserts a profile without dropping unknown entries', async () => {
    const raw = config({
      agent_profiles: [rawProfile('p1', 'deepseek'), rawProfile('p2', 'future-ai')],
    });
    invoke.mockResolvedValueOnce(raw);
    await loadAgentSettings();
    invoke.mockResolvedValueOnce(raw);
    await upsertAgentProfile({
      id: 'p1',
      name: 'p1',
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      apiKey: 'k',
      baseUrl: '',
      enabled: true,
    });
    const written = lastWrittenConfig();
    const profiles = written.agent_profiles as Array<Record<string, unknown>>;
    expect(profiles).toHaveLength(2);
    expect(profiles[1]).toMatchObject({ id: 'p2', provider: 'future-ai' });
    expect(profiles[0]).toMatchObject({ id: 'p1', model: 'deepseek-v4-pro' });
  });

  it('removes a profile by id only', async () => {
    const raw = config({
      agent_profiles: [rawProfile('p1', 'deepseek'), rawProfile('p2', 'future-ai')],
    });
    invoke.mockResolvedValueOnce(raw);
    await loadAgentSettings();
    invoke.mockResolvedValueOnce(raw);
    await removeAgentProfile('p1');
    const profiles = lastWrittenConfig().agent_profiles as Array<Record<string, unknown>>;
    expect(profiles.map((item) => item.id)).toEqual(['p2']);
  });
});
