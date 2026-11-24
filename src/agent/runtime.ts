import type { AgentEvent, AgentRequest, AgentRunHandle } from '@texto/plugin-sdk';
import type { MutableModels } from '@earendil-works/pi-ai';
import { agentAvailable, findAgentProfile, isProfileComplete } from './config';
import { AgentRequestError, classifyAgentError } from './errors';
import { resolveAgentModel } from './providers';
import {
  appendAgentText,
  failAgentSession,
  finishAgentSession,
  getAgentSession,
} from './session';

export interface AgentHandle {
  prompt(text: string): Promise<void>;
  abort(): void;
  dispose(): void;
}

export interface CreateAgentArgs {
  system?: string;
  model: unknown;
  onDelta(delta: string, kind: 'text' | 'reasoning'): void;
  onDone(): void;
  onError(error: unknown): void;
  /** 模型/传输被中止（非用户主动 abort）；缺省不产生回调。 */
  onAborted?(): void;
  getApiKey(): string;
}

export interface RuntimeDeps {
  /** 测试注入；缺省使用 pi-agent-core 的 Agent。 */
  createAgent?: (args: CreateAgentArgs) => AgentHandle;
  /** 是否写共享会话；`capability.run` 传 false（只走 handlers，不产生 UI）。 */
  writeSession?: boolean;
  /** 本轮运行使用的模型配置 id（插件经 `PluginHost.agent` 传入）。 */
  profileId?: string;
}

/** pi 事件的最小结构（测试无需依赖 SDK 类型）。 */
export interface PiLikeEvent {
  type: string;
  assistantMessageEvent?: { type: string; delta?: string };
  messages?: Array<{ role: string; stopReason?: string; errorMessage?: string }>;
}

export interface PiEventHandlers {
  onDelta(delta: string, kind: 'text' | 'reasoning'): void;
  onDone(): void;
  onError(error: unknown): void;
  /** `stopReason: 'aborted'`；缺省忽略。 */
  onAborted?(): void;
}

/**
 * 把 pi 的 Agent 事件映射成运行时回调。
 *
 * pi 不 reject 失败：provider 错误与中止都编码在 `agent_end` 的最后一条
 * assistant 消息上（`stopReason` + `errorMessage`）。
 */
export function dispatchPiEvent(event: PiLikeEvent, handlers: PiEventHandlers): void {
  if (event.type === 'message_update') {
    const assistantEvent = event.assistantMessageEvent;
    if (!assistantEvent) return;
    if (assistantEvent.type === 'text_delta' && typeof assistantEvent.delta === 'string') {
      handlers.onDelta(assistantEvent.delta, 'text');
    } else if (
      assistantEvent.type === 'thinking_delta' &&
      typeof assistantEvent.delta === 'string'
    ) {
      handlers.onDelta(assistantEvent.delta, 'reasoning');
    }
    return;
  }

  if (event.type !== 'agent_end') return;

  const messages = event.messages;
  const lastAssistant = messages
    ? [...messages].reverse().find((message) => message.role === 'assistant')
    : undefined;
  if (lastAssistant) {
    if (lastAssistant.stopReason === 'error') {
      handlers.onError(new Error(lastAssistant.errorMessage || 'agent run failed'));
      return;
    }
    if (lastAssistant.stopReason === 'aborted') {
      handlers.onAborted?.();
      return;
    }
  }
  handlers.onDone();
}

/**
 * 发起一次 Agent 运行：把 pi 的事件映射成契约事件，并按需写入共享会话。
 *
 * pi 相关模块只在真正运行时动态加载（见 `loadPiAgentFactory`），
 * 启动路径不会因此拉起 SDK。
 */
export function runAgent(
  request: AgentRequest,
  handlers: { onEvent(event: AgentEvent): void },
  deps: RuntimeDeps = {},
): AgentRunHandle {
  const writeSession = deps.writeSession ?? true;
  const profileId = deps.profileId ?? '';
  // 迟到的终态/增量不得污染后续会话（重试或 reset 之后）。
  const sessionId = getAgentSession().id;
  const canWriteSession = () => writeSession && getAgentSession().id === sessionId;

  let disposed = false;
  let settled = false;
  let text = '';
  let agent: AgentHandle | null = null;

  const emit = (event: AgentEvent) => {
    if (disposed) return;
    try {
      handlers.onEvent(event);
    } catch (error) {
      // 单个 handler 抛错不影响运行本身。
      console.error('[agent] onEvent handler failed', error);
    }
  };

  /** 释放 pi 句柄（幂等）：终态后不再持有订阅。 */
  const release = () => {
    const current = agent;
    agent = null;
    current?.dispose();
  };

  const fail = (error: unknown) => {
    if (disposed || settled) return;
    settled = true;
    const info = classifyAgentError(error);
    if (canWriteSession()) failAgentSession(info.message);
    release();
    emit({ type: 'error', message: info.message, retryable: info.retryable });
  };

  const start = async () => {
    const last = request.messages[request.messages.length - 1];
    if (!last || last.role !== 'user') {
      throw new AgentRequestError('agent request 需要以 user 消息结尾');
    }

    const profile = findAgentProfile(profileId);
    if (!profile) throw new AgentRequestError('所选模型配置不存在');
    if (!isProfileComplete(profile)) throw new AgentRequestError('所选模型配置不完整');
    if (!agentAvailable(profileId)) {
      throw new AgentRequestError('AI 功能未开启');
    }
    const { models, model } = await resolveAgentModel(profile);
    if (disposed) return;

    const create = deps.createAgent ?? (await loadPiAgentFactory(models));
    if (disposed) return;

    const handle = create({
      system: request.system,
      model,
      // v1 只取最后一条 user 作为本轮输入；历史暂不转发给 pi。
      // pi 的 `initialState.messages` 要求完整的 AssistantMessage（content 为数组等），
      // 骨架的 `{ role, content }` 简化历史会在多轮时抛错，等专门做多轮时再补转换。
      onDelta: (delta, kind) => {
        if (disposed || settled) return;
        if (kind === 'text') {
          text += delta;
          if (canWriteSession()) appendAgentText(delta);
          emit({ type: 'text-delta', text: delta });
        } else {
          emit({ type: 'reasoning-delta', text: delta });
        }
      },
      onDone: () => {
        if (disposed || settled) return;
        settled = true;
        if (canWriteSession()) finishAgentSession(text);
        release();
        emit({ type: 'done', text });
      },
      onError: (error) => {
        fail(error);
      },
      onAborted: () => {
        if (disposed || settled) return;
        settled = true;
        // 中止不发 done 事件，但会话必须离开 streaming。
        if (canWriteSession()) finishAgentSession(text);
        release();
      },
      getApiKey: () => profile.apiKey,
    });
    agent = handle;

    // abort() 可能在 resolve 模型期间发生：此时不要再启动请求。
    if (disposed) {
      handle.abort();
      release();
      return;
    }

    await handle.prompt(last.content);
  };

  void start().catch((error: unknown) => {
    fail(error);
  });

  return {
    abort() {
      // 已终结（done/error）或已中止：不得覆盖终态（尤其不能把 error 改成 done）。
      if (disposed || settled) return;
      disposed = true;
      agent?.abort();
      if (canWriteSession()) finishAgentSession();
      release();
    },
  };
}

/**
 * 加载 pi 的 Agent 工厂：v1 不使用 `initialState.messages`（不转发历史），
 * 未来做多轮时再补齐完整 AssistantMessage 转换。
 */
async function loadPiAgentFactory(
  models: MutableModels,
): Promise<(args: CreateAgentArgs) => AgentHandle> {
  const { Agent } = await import('@earendil-works/pi-agent-core');
  return (args) => {
    const instance = new Agent({
      initialState: {
        systemPrompt: args.system,
        model: args.model as never,
      },
      streamFn: models.streamSimple.bind(models),
      getApiKey: () => args.getApiKey(),
    });
    const unsub = instance.subscribe((event) => {
      dispatchPiEvent(event as unknown as PiLikeEvent, args);
    });
    return {
      prompt: (text: string) => instance.prompt(text),
      abort: () => instance.abort(),
      dispose: () => unsub(),
    };
  };
}
