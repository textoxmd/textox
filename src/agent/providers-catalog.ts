export type AgentProviderId =
  | 'deepseek'
  | 'zhipu'
  | 'moonshot'
  | 'qwen'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'custom';

export type AgentProviderApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai';

/** pi 自带适配器的 provider id，同时也是该适配器在 pi 目录里的 provider id。 */
export type PiProviderId =
  | 'deepseek'
  | 'moonshotai-cn'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai';

export interface ProviderMeta {
  id: Exclude<AgentProviderId, 'custom'>;
  /** 显示名的 i18n key（文案由任务 14 落到 translations）。 */
  labelKey: string;
  availableInMainlandChina: boolean;
  /** pi 的 api id；piProvider 存在时仍以原生适配为准 */
  api: AgentProviderApi;
  baseUrl: string;
  piProvider?: PiProviderId;
  piProviderId?: PiProviderId;
  defaultModel: string;
  models: readonly string[];
  privacyUrl: string;
}

export const PROVIDERS: Record<Exclude<AgentProviderId, 'custom'>, ProviderMeta> = {
  deepseek: {
    id: 'deepseek',
    labelKey: 'settings.ai.providerDeepseek',
    availableInMainlandChina: true,
    api: 'openai-completions',
    baseUrl: 'https://api.deepseek.com',
    piProvider: 'deepseek',
    piProviderId: 'deepseek',
    defaultModel: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    privacyUrl: 'https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html',
  },
  zhipu: {
    id: 'zhipu',
    labelKey: 'settings.ai.providerZhipu',
    availableInMainlandChina: true,
    api: 'openai-completions',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5.3',
    models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2'],
    privacyUrl: 'https://docs.bigmodel.cn/cn/terms/privacy-policy',
  },
  moonshot: {
    id: 'moonshot',
    labelKey: 'settings.ai.providerMoonshot',
    availableInMainlandChina: true,
    api: 'openai-completions',
    baseUrl: 'https://api.moonshot.cn/v1',
    piProvider: 'moonshotai-cn',
    piProviderId: 'moonshotai-cn',
    defaultModel: 'kimi-k3',
    models: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6'],
    privacyUrl: 'https://platform.moonshot.cn/docs/agreement/privacy-policy',
  },
  qwen: {
    id: 'qwen',
    labelKey: 'settings.ai.providerQwen',
    availableInMainlandChina: true,
    api: 'openai-completions',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.8-max',
    models: ['qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus'],
    privacyUrl: 'https://help.aliyun.com/zh/model-studio/privacy-policy',
  },
  openai: {
    id: 'openai',
    labelKey: 'settings.ai.providerOpenai',
    availableInMainlandChina: false,
    api: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    piProvider: 'openai',
    piProviderId: 'openai',
    defaultModel: 'gpt-6-luna',
    models: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'],
    privacyUrl: 'https://openai.com/policies/privacy-policy',
  },
  anthropic: {
    id: 'anthropic',
    labelKey: 'settings.ai.providerAnthropic',
    availableInMainlandChina: false,
    api: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    piProvider: 'anthropic',
    piProviderId: 'anthropic',
    defaultModel: 'claude-opus-5',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    privacyUrl: 'https://www.anthropic.com/legal/privacy',
  },
  google: {
    id: 'google',
    labelKey: 'settings.ai.providerGoogle',
    availableInMainlandChina: false,
    api: 'google-generative-ai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    piProvider: 'google',
    piProviderId: 'google',
    defaultModel: 'gemini-3.8-flash',
    models: ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-pro-preview'],
    privacyUrl: 'https://policies.google.com/privacy',
  },
  xai: {
    id: 'xai',
    labelKey: 'settings.ai.providerXai',
    availableInMainlandChina: false,
    api: 'openai-responses',
    baseUrl: 'https://api.x.ai/v1',
    piProvider: 'xai',
    piProviderId: 'xai',
    defaultModel: 'grok-4.7',
    models: ['grok-4.7', 'grok-4.6', 'grok-4.5'],
    privacyUrl: 'https://x.ai/legal/privacy-policy',
  },
};

/** 只认 catalog 自身键；`in` 会把 `toString` / `constructor` 也算合法。 */
function isCatalogKey(key: string): key is keyof typeof PROVIDERS {
  // `Object.hasOwn` 需要 lib ES2022，本仓 tsconfig 为 ES2020，用等价写法。
  return Object.prototype.hasOwnProperty.call(PROVIDERS, key);
}

export function isAgentProviderId(raw: unknown): raw is AgentProviderId {
  return typeof raw === 'string' && (raw === 'custom' || isCatalogKey(raw));
}

export function providerMeta(id: AgentProviderId | string): ProviderMeta | null {
  if (id === 'custom') return null;
  return isCatalogKey(id) ? PROVIDERS[id] : null;
}

export function availableProviders(mainland: boolean): AgentProviderId[] {
  const ids = Object.values(PROVIDERS)
    .filter((meta) => !mainland || meta.availableInMainlandChina)
    .map((meta) => meta.id);
  return [...ids, 'custom'];
}

export function defaultModelFor(provider: AgentProviderId): string {
  return provider === 'custom' ? '' : PROVIDERS[provider].defaultModel;
}

export function modelOptionsFor(provider: AgentProviderId, currentModel = ''): string[] {
  const meta = providerMeta(provider);
  const presets = meta ? [...meta.models] : [];
  if (currentModel && !presets.includes(currentModel)) presets.unshift(currentModel);
  return presets;
}
