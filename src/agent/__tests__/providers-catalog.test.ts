import { describe, expect, it } from 'vitest';
import {
  availableProviders,
  defaultModelFor,
  isAgentProviderId,
  modelOptionsFor,
  providerMeta,
} from '../providers-catalog';

describe('providers catalog', () => {
  it('offers mainland providers only in mainland', () => {
    expect(availableProviders(true)).toEqual([
      'deepseek',
      'zhipu',
      'moonshot',
      'qwen',
      'custom',
    ]);
  });

  it('adds overseas providers outside mainland', () => {
    expect(availableProviders(false)).toEqual([
      'deepseek',
      'zhipu',
      'moonshot',
      'qwen',
      'openai',
      'anthropic',
      'google',
      'xai',
      'custom',
    ]);
  });

  it('exposes endpoints and presets', () => {
    expect(providerMeta('zhipu')?.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');
    expect(providerMeta('qwen')?.baseUrl).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    );
    expect(providerMeta('anthropic')?.piProvider).toBe('anthropic');
    expect(modelOptionsFor('moonshot', 'kimi-k3')).toContain('kimi-k3');
    expect(defaultModelFor('custom')).toBe('');
  });

  it('keeps a stored non-preset model visible', () => {
    expect(modelOptionsFor('openai', 'gpt-7-unknown')[0]).toBe('gpt-7-unknown');
  });

  it('keeps zhipu and qwen on the OpenAI-compatible endpoint', () => {
    expect(providerMeta('zhipu')?.piProvider).toBeUndefined();
    expect(providerMeta('qwen')?.piProvider).toBeUndefined();
    expect(providerMeta('zhipu')?.api).toBe('openai-completions');
  });

  it('rejects prototype keys', () => {
    expect(isAgentProviderId('toString')).toBe(false);
    expect(providerMeta('toString' as never)).toBeNull();
  });
});
