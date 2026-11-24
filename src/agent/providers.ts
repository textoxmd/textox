import type { Api, Model, MutableModels, Provider } from '@earendil-works/pi-ai';

import type { AgentProfile } from './config';
import { AgentRequestError } from './errors';
import { providerMeta, type PiProviderId, type ProviderMeta } from './providers-catalog';

export interface ResolvedAgentModel {
  models: MutableModels;
  model: Model<Api>;
}

let cache: { key: string; value: ResolvedAgentModel } | null = null;

function cacheKey(profile: AgentProfile): string {
  return `${profile.id}|${profile.provider}|${profile.model}|${profile.baseUrl}|${profile.apiKey}`;
}

function baseUrlOf(profile: AgentProfile, meta: ProviderMeta | null): string {
  const raw = profile.provider === 'custom' ? profile.baseUrl : (meta?.baseUrl ?? '');
  return raw.trim().replace(/\/+$/, '');
}

/**
 * 目录外的模型 id 按目录元数据构造内联模型。
 *
 * `provider` 必须用**已注册**的 provider id：moonshot 的适配器注册为
 * `moonshotai-cn`，写成 `moonshot` 会让 `Models` 报 `Unknown provider`。
 */
function inlineModel(profile: AgentProfile, meta: ProviderMeta | null): Model<Api> {
  return {
    id: profile.model,
    name: profile.model,
    api: meta?.api ?? 'openai-completions',
    provider: meta?.piProviderId ?? profile.provider,
    baseUrl: baseUrlOf(profile, meta),
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  };
}

/** 只在这里出现字面量 import，保证打包器能静态切分 chunk。 */
const NATIVE_LOADERS: Record<PiProviderId, () => Promise<Provider<Api>>> = {
  deepseek: async () =>
    (await import('@earendil-works/pi-ai/providers/deepseek')).deepseekProvider(),
  'moonshotai-cn': async () =>
    (await import('@earendil-works/pi-ai/providers/moonshotai-cn')).moonshotaiCnProvider(),
  openai: async () => (await import('@earendil-works/pi-ai/providers/openai')).openaiProvider(),
  anthropic: async () =>
    (await import('@earendil-works/pi-ai/providers/anthropic')).anthropicProvider(),
  google: async () => (await import('@earendil-works/pi-ai/providers/google')).googleProvider(),
  xai: async () => (await import('@earendil-works/pi-ai/providers/xai')).xaiProvider(),
};

/**
 * 把 profile 解析成 pi 的 `Models` 集合 + 选中的模型。
 *
 * 目录里有原生适配（`piProvider`）的走 pi 自带 provider，模型元数据（api /
 * baseUrl / 能力）以 pi 目录为准，未收录的模型 id 退化为同 api 的内联模型；
 * 其余（zhipu / qwen / custom 等 OpenAI 兼容端点）统一自建
 * `openai-completions` provider。
 *
 * pi 全部经动态 import 加载：启动期不经 `config.ts` 拉起 SDK，浏览器环境下
 * 也不会因为缺少 Node 能力而炸。只做本地解析，不发网络请求。
 */
export async function resolveAgentModel(profile: AgentProfile): Promise<ResolvedAgentModel> {
  const key = cacheKey(profile);
  if (cache?.key === key) return cache.value;

  if (profile.provider === 'custom' && !profile.baseUrl.trim()) {
    throw new AgentRequestError('自定义服务需要填写 Base URL');
  }

  const meta = providerMeta(profile.provider);
  const { createModels, createProvider } = await import('@earendil-works/pi-ai/models');
  const models = createModels();

  let model: Model<Api>;
  const provider = meta?.piProvider ? await NATIVE_LOADERS[meta.piProvider]() : null;
  if (provider) {
    models.setProvider(provider);
    const found = models.getModel(provider.id, profile.model);
    if (!found && import.meta.env.DEV) {
      console.warn(`[agent] 模型 ${profile.model} 不在 pi 目录中，按内联配置解析`);
    }
    model = found ?? inlineModel(profile, meta);
  } else {
    const { openAICompletionsApi } = await import('@earendil-works/pi-ai/api/openai-completions.lazy');
    model = inlineModel(profile, meta);
    models.setProvider(
      createProvider({
        id: profile.provider,
        name: profile.provider,
        baseUrl: model.baseUrl,
        auth: {
          apiKey: {
            name: profile.provider,
            resolve: async () => ({ auth: { apiKey: profile.apiKey } }),
          },
        },
        models: [model],
        api: openAICompletionsApi(),
      }),
    );
  }

  cache = { key, value: { models, model } };
  return cache.value;
}

export function resetAgentProviderCacheForTests(): void {
  cache = null;
}
