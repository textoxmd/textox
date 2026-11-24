import type { AgentAnchorRect, AgentRequest, AgentRunHandle } from '@texto/plugin-sdk';
import { findAgentProfile, isProfileComplete } from './config';
import { AgentRequestError } from './errors';
import { resolveAgentModel } from './providers';
import { runAgent } from './runtime';
import { setAgentSession } from './session';

let active: AgentRunHandle | null = null;

/**
 * 发起一轮运行：同一时刻只允许一条请求在跑。
 * 旧请求先中止（已终结的 handle 的 abort 是 no-op），再整体替换会话并开跑。
 *
 * `profileId` 是本轮使用的模型配置；运行前的可用性校验由 `runAgent` 负责。
 */
export function startAgentRun(
  request: AgentRequest,
  anchor: AgentAnchorRect | null,
  title: string,
  tabLabel = '',
  sourceText = '',
  profileId = '',
): AgentRunHandle {
  abortActiveAgentRun();
  setAgentSession({ title, tabLabel, sourceText, anchor, request, profileId });
  const handle = runAgent(request, { onEvent: () => {} }, { profileId });
  active = handle;
  return handle;
}

/** 中止当前运行并清空引用；不改写 session（由调用方决定是否 reset）。 */
export function abortActiveAgentRun(): void {
  const handle = active;
  active = null;
  handle?.abort();
}

/**
 * 设置页「测试连接」：只验证 provider/模型/凭据，不写 session、不挂视图。
 *
 * 不检查总开关与同意状态：设置页需要在开启 AI 之前就能验证配置。
 */
export async function testAgentConnection(
  profileId: string,
  signal?: AbortSignal,
): Promise<void> {
  const profile = findAgentProfile(profileId);
  if (!profile) throw new AgentRequestError('所选模型配置不存在');
  if (!isProfileComplete(profile)) throw new AgentRequestError('所选模型配置不完整');
  const { models, model } = await resolveAgentModel(profile);
  const response = await models.complete(
    model,
    { messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }] },
    { apiKey: profile.apiKey, signal },
  );
  if (response.errorMessage) throw new Error(response.errorMessage);
}
