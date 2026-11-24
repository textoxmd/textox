import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentProfile } from '../config';
import { resetAgentProviderCacheForTests, resolveAgentModel } from '../providers';

const profile = (overrides: Partial<AgentProfile>): AgentProfile => ({
  id: 'p1',
  name: 'p1',
  provider: 'deepseek',
  model: 'deepseek-flash',
  apiKey: 'k',
  baseUrl: '',
  enabled: true,
  ...overrides,
});

beforeEach(() => resetAgentProviderCacheForTests());

describe('resolveAgentModel', () => {
  it('resolves native providers from the pi catalog', async () => {
    const anthropic = await resolveAgentModel(
      profile({ provider: 'anthropic', model: 'claude-sonnet-5' }),
    );
    expect(anthropic.model.api).toBe('anthropic-messages');
    expect(anthropic.model.baseUrl).toBe('https://api.anthropic.com');

    const google = await resolveAgentModel(
      profile({ provider: 'google', model: 'gemini-3.8-flash' }),
    );
    expect(google.model.api).toBe('google-generative-ai');
  });

  it('falls back to an inline model for unknown ids', async () => {
    const { model } = await resolveAgentModel(
      profile({ provider: 'anthropic', model: 'claude-unknown-9' }),
    );
    expect(model.id).toBe('claude-unknown-9');
    expect(model.api).toBe('anthropic-messages');
    expect(model.baseUrl).toBe('https://api.anthropic.com');
  });

  it('builds openai-compatible providers from the catalog', async () => {
    const zhipu = await resolveAgentModel(profile({ provider: 'zhipu', model: 'glm-5.3' }));
    expect(zhipu.model.api).toBe('openai-completions');
    expect(zhipu.model.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');

    const custom = await resolveAgentModel(
      profile({ provider: 'custom', model: 'm', baseUrl: 'https://example.com/v1/' }),
    );
    expect(custom.model.baseUrl).toBe('https://example.com/v1');
  });

  it('resolves moonshot through the cn adapter', async () => {
    const moonshot = await resolveAgentModel(profile({ provider: 'moonshot', model: 'kimi-k3' }));
    expect(moonshot.model.api).toBe('openai-completions');
    expect(moonshot.model.baseUrl).toBe('https://api.moonshot.cn/v1');
  });

  it('proves the native adapter is used', async () => {
    const moonshot = await resolveAgentModel(profile({ provider: 'moonshot', model: 'kimi-k3' }));
    expect(moonshot.model.provider).toBe('moonshotai-cn');
    expect(moonshot.model.reasoning).toBe(true);
    expect(moonshot.models.getModel('moonshotai-cn', 'kimi-k3')).toBe(moonshot.model);
  });

  it('uses the registered provider id for inline fallbacks', async () => {
    const { model } = await resolveAgentModel(
      profile({ provider: 'moonshot', model: 'kimi-unknown-1' }),
    );
    expect(model.provider).toBe('moonshotai-cn');
    expect(model.baseUrl).toBe('https://api.moonshot.cn/v1');
  });

  it('registers openai-compatible models under their provider', async () => {
    const zhipu = await resolveAgentModel(profile({ provider: 'zhipu', model: 'glm-5.3' }));
    expect(zhipu.models.getModel('zhipu', 'glm-5.3')).toBe(zhipu.model);

    const custom = await resolveAgentModel(
      profile({ provider: 'custom', model: 'm', baseUrl: 'https://example.com/v1' }),
    );
    expect(custom.models.getModel('custom', 'm')).toBe(custom.model);
  });

  it('rejects a custom profile without a base url', async () => {
    await expect(
      resolveAgentModel(profile({ provider: 'custom', model: 'm', baseUrl: '  ' })),
    ).rejects.toThrow('Base URL');
  });

  it('caches by profile fields', async () => {
    const first = await resolveAgentModel(profile({}));
    const second = await resolveAgentModel(profile({}));
    expect(second.models).toBe(first.models);
    const third = await resolveAgentModel(profile({ apiKey: 'other' }));
    expect(third.models).not.toBe(first.models);
  });
});
