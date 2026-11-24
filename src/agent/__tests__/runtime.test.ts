import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@texto/plugin-sdk';
import {
  appendAgentText,
  failAgentSession,
  finishAgentSession,
  flushAgentTextForTests,
  getAgentSession,
  resetAgentSession,
  resetAgentSessionForTests,
  setAgentSession,
  subscribeAgentSession,
} from '../session';
import { dispatchPiEvent, runAgent, type CreateAgentArgs } from '../runtime';

const providers = vi.hoisted(() => ({
  resolveAgentModel: vi.fn(),
}));
vi.mock('../providers', () => ({ resolveAgentModel: providers.resolveAgentModel }));

const config = vi.hoisted(() => ({
  findAgentProfile: vi.fn(),
  isProfileComplete: vi.fn(),
  agentAvailable: vi.fn(),
}));
vi.mock('../config', () => ({
  findAgentProfile: config.findAgentProfile,
  isProfileComplete: config.isProfileComplete,
  agentAvailable: config.agentAvailable,
}));

const profile = {
  id: 'p1',
  name: '工作号',
  provider: 'deepseek' as const,
  model: 'deepseek-flash',
  apiKey: 'sk-live',
  baseUrl: '',
  enabled: true,
};

beforeEach(() => {
  resetAgentSessionForTests();
  providers.resolveAgentModel.mockReset();
  providers.resolveAgentModel.mockResolvedValue({
    models: { streamSimple: vi.fn() },
    model: { id: 'fake-model', api: 'fake', provider: 'fake' },
  });
  config.findAgentProfile.mockReset();
  config.findAgentProfile.mockImplementation((id: string) =>
    id === profile.id ? profile : null,
  );
  config.isProfileComplete.mockReset();
  config.isProfileComplete.mockReturnValue(true);
  config.agentAvailable.mockReset();
  config.agentAvailable.mockReturnValue(true);
});

async function waitFor(predicate: () => boolean, timeout = 1000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function seedSession(): void {
  setAgentSession({
    title: '解释',
    anchor: null,
    request: { messages: [{ role: 'user', content: 'hi' }] },
  });
}

describe('agent session', () => {
  it('写入、增量合并与终态', () => {
    seedSession();
    expect(getAgentSession()).toMatchObject({
      id: 1,
      title: '解释',
      status: 'streaming',
      text: '',
      error: null,
    });

    appendAgentText('你');
    appendAgentText('好');
    flushAgentTextForTests();
    expect(getAgentSession().text).toBe('你好');

    finishAgentSession();
    expect(getAgentSession().status).toBe('done');
    expect(getAgentSession().text).toBe('你好');
    expect(getAgentSession().error).toBeNull();
  });

  it('finishAgentSession 传 text 时以传入值为准', () => {
    seedSession();
    appendAgentText('片');
    finishAgentSession('完整回答');
    expect(getAgentSession().text).toBe('完整回答');
  });

  it('失败时合并未冲刷的增量并保留半截文本', () => {
    seedSession();
    appendAgentText('半');
    failAgentSession('boom');
    expect(getAgentSession()).toMatchObject({
      status: 'error',
      text: '半',
      error: 'boom',
    });
  });

  it('非 streaming 状态的增量被忽略', () => {
    seedSession();
    finishAgentSession('定稿');
    appendAgentText('多余');
    flushAgentTextForTests();
    expect(getAgentSession().text).toBe('定稿');
  });

  it('失败写入错误文案，reset 回到 idle', () => {
    seedSession();
    finishAgentSession('半截');
    // 直接失败（不依赖 finish 状态）
    setAgentSession({
      title: '第二次',
      anchor: null,
      request: { messages: [{ role: 'user', content: 'again' }] },
    });
    expect(getAgentSession().id).toBe(2);
    // failAgentSession 由 runtime 使用，这里通过运行时错误路径覆盖；直接验证 reset。
    resetAgentSession();
    expect(getAgentSession()).toMatchObject({ status: 'idle', text: '', error: null, request: null });
  });

  it('订阅者在快照变化时收到通知', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAgentSession(listener);
    seedSession();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    appendAgentText('x');
    flushAgentTextForTests();
    expect(listener).not.toHaveBeenCalled();
  });

  it('会话保留 profileId，reset 后清空', () => {
    setAgentSession({
      title: '解释',
      anchor: null,
      request: { messages: [{ role: 'user', content: 'hi' }] },
      profileId: 'p1',
    });
    expect(getAgentSession().profileId).toBe('p1');

    resetAgentSession();
    expect(getAgentSession().profileId).toBe('');
  });

  it('缺省 profileId 时为空串', () => {
    seedSession();
    expect(getAgentSession().profileId).toBe('');
  });
});

describe('dispatchPiEvent', () => {
  function createHandlers() {
    return {
      onDelta: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onAborted: vi.fn(),
    };
  }

  it('text_delta → text 增量', () => {
    const handlers = createHandlers();
    dispatchPiEvent(
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '你' } },
      handlers,
    );
    expect(handlers.onDelta).toHaveBeenCalledWith('你', 'text');
    expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it('thinking_delta → reasoning 增量', () => {
    const handlers = createHandlers();
    dispatchPiEvent(
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: '想' },
      },
      handlers,
    );
    expect(handlers.onDelta).toHaveBeenCalledWith('想', 'reasoning');
  });

  it('其他 message_update 子事件与无关事件被忽略', () => {
    const handlers = createHandlers();
    dispatchPiEvent(
      { type: 'message_update', assistantMessageEvent: { type: 'text_start' } },
      handlers,
    );
    dispatchPiEvent({ type: 'agent_start' }, handlers);
    dispatchPiEvent({ type: 'turn_end' }, handlers);
    expect(handlers.onDelta).not.toHaveBeenCalled();
    expect(handlers.onDone).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(handlers.onAborted).not.toHaveBeenCalled();
  });

  it('agent_end 末条 assistant error → onError(errorMessage)', () => {
    const handlers = createHandlers();
    dispatchPiEvent(
      {
        type: 'agent_end',
        messages: [
          { role: 'user' },
          { role: 'assistant', stopReason: 'error', errorMessage: '401 Unauthorized' },
          { role: 'toolResult' },
        ],
      },
      handlers,
    );
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((handlers.onError.mock.calls[0][0] as Error).message).toBe('401 Unauthorized');
    expect(handlers.onDone).not.toHaveBeenCalled();
  });

  it('agent_end aborted → onAborted，不发 done', () => {
    const handlers = createHandlers();
    dispatchPiEvent(
      {
        type: 'agent_end',
        messages: [{ role: 'assistant', stopReason: 'aborted' }],
      },
      handlers,
    );
    expect(handlers.onAborted).toHaveBeenCalledTimes(1);
    expect(handlers.onDone).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('agent_end 正常 → onDone', () => {
    const handlers = createHandlers();
    dispatchPiEvent(
      { type: 'agent_end', messages: [{ role: 'assistant', stopReason: 'stop' }] },
      handlers,
    );
    expect(handlers.onDone).toHaveBeenCalledTimes(1);
    expect(handlers.onAborted).not.toHaveBeenCalled();

    const noMessages = createHandlers();
    dispatchPiEvent({ type: 'agent_end' }, noMessages);
    expect(noMessages.onDone).toHaveBeenCalledTimes(1);
  });
});

describe('runAgent', () => {
  it('正常流：text-delta 两次、done 一次，session 文本为完整回答', async () => {
    seedSession();
    const events: AgentEvent[] = [];
    const prompts: string[] = [];
    const dispose = vi.fn();
    let createArgs: CreateAgentArgs | null = null;

    const handle = runAgent(
      {
        system: '你是助手',
        messages: [
          { role: 'user', content: '第一轮' },
          { role: 'assistant', content: '第一轮回答' },
          { role: 'user', content: 'hi' },
        ],
      },
      { onEvent: (event) => events.push(event) },
      {
        profileId: 'p1',
        createAgent: (args) => {
          createArgs = args;
          return {
            prompt: async (text) => {
              prompts.push(text);
              args.onDelta('你', 'text');
              args.onDelta('好', 'text');
              args.onDone();
            },
            abort: () => {},
            dispose,
          };
        },
      },
    );

    await waitFor(() => getAgentSession().status === 'done');

    expect(events).toEqual([
      { type: 'text-delta', text: '你' },
      { type: 'text-delta', text: '好' },
      { type: 'done', text: '你好' },
    ]);
    expect(getAgentSession().text).toBe('你好');
    expect(getAgentSession().status).toBe('done');
    expect(prompts).toEqual(['hi']);
    expect(createArgs).toMatchObject({ system: '你是助手' });
    // v1 不转发历史：createAgent 已不再接收 messages 字段。
    expect((createArgs as unknown as Record<string, unknown>).messages).toBeUndefined();
    expect(createArgs!.getApiKey()).toBe('sk-live');
    expect(config.findAgentProfile).toHaveBeenCalledWith('p1');
    // 终态释放 pi 资源。
    expect(dispose).toHaveBeenCalledTimes(1);
    handle.abort();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('推理增量映射为 reasoning-delta', async () => {
    seedSession();
    const events: AgentEvent[] = [];
    runAgent(
      { messages: [{ role: 'user', content: 'hi' }] },
      { onEvent: (event) => events.push(event) },
      {
        profileId: 'p1',
        createAgent: (args) => ({
          prompt: async () => {
            args.onDelta('思考中', 'reasoning');
            args.onDelta('答案', 'text');
            args.onDone();
          },
          abort: () => {},
          dispose: () => {},
        }),
      },
    );

    await waitFor(() => getAgentSession().status === 'done');
    expect(events).toEqual([
      { type: 'reasoning-delta', text: '思考中' },
      { type: 'text-delta', text: '答案' },
      { type: 'done', text: '答案' },
    ]);
  });

  it('最后一条不是 user：error 事件且不可重试', async () => {
    seedSession();
    const events: AgentEvent[] = [];
    const prompt = vi.fn();

    runAgent(
      {
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: '已完成的回答' },
        ],
      },
      { onEvent: (event) => events.push(event) },
      {
        profileId: 'p1',
        createAgent: () => ({
          prompt,
          abort: () => {},
          dispose: () => {},
        }),
      },
    );

    await waitFor(() => getAgentSession().status === 'error');
    expect(prompt).not.toHaveBeenCalled();
    expect(providers.resolveAgentModel).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', retryable: false });
    expect(getAgentSession().status).toBe('error');
  });

  it('createAgent 抛错：error 事件并写入 session', async () => {
    seedSession();
    const events: AgentEvent[] = [];

    runAgent(
      { messages: [{ role: 'user', content: 'hi' }] },
      { onEvent: (event) => events.push(event) },
      {
        profileId: 'p1',
        createAgent: () => {
          throw new Error('429 rate limit');
        },
      },
    );

    await waitFor(() => getAgentSession().status === 'error');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', retryable: true });
    expect(getAgentSession().status).toBe('error');
    expect(getAgentSession().error).toBeTruthy();
  });

  it('prompt 拒绝：走 classify 错误路径并释放句柄', async () => {
    seedSession();
    const events: AgentEvent[] = [];
    const dispose = vi.fn();

    runAgent(
      { messages: [{ role: 'user', content: 'hi' }] },
      { onEvent: (event) => events.push(event) },
      {
        profileId: 'p1',
        createAgent: () => ({
          prompt: async () => {
            throw new Error('401 Unauthorized');
          },
          abort: () => {},
          dispose,
        }),
      },
    );

    await waitFor(() => getAgentSession().status === 'error');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', retryable: true });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('失败时保留已收到的半截文本', async () => {
    seedSession();

    const handle = runAgent(
      { messages: [{ role: 'user', content: 'hi' }] },
      { onEvent: () => {} },
      {
        profileId: 'p1',
        createAgent: (args) => ({
          prompt: async () => {
            args.onDelta('部分', 'text');
            args.onError(new Error('boom'));
          },
          abort: () => {},
          dispose: () => {},
        }),
      },
    );

    await waitFor(() => getAgentSession().status === 'error');
    expect(getAgentSession().text).toBe('部分');
    expect(getAgentSession().error).toBe('boom');
    handle.abort();
  });

  it('error 之后 abort 不覆盖终态', async () => {
    seedSession();
    const abort = vi.fn();
    const dispose = vi.fn();

    const handle = runAgent(
      { messages: [{ role: 'user', content: 'hi' }] },
      { onEvent: () => {} },
      {
        profileId: 'p1',
        createAgent: (args) => ({
          prompt: async () => {
            args.onDelta('部分', 'text');
            args.onError(new Error('boom'));
          },
          abort,
          dispose,
        }),
      },
    );

    await waitFor(() => getAgentSession().status === 'error');
    handle.abort();

    expect(getAgentSession().status).toBe('error');
    expect(getAgentSession().error).toBe('boom');
    expect(getAgentSession().text).toBe('部分');
    expect(abort).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('writeSession: false 时不写共享会话', async () => {
    seedSession();
    const events: AgentEvent[] = [];

    runAgent(
      { messages: [{ role: 'user', content: 'hi' }] },
      { onEvent: (event) => events.push(event) },
      {
        profileId: 'p1',
        writeSession: false,
        createAgent: (args) => ({
          prompt: async () => {
            args.onDelta('不该写入', 'text');
            args.onDone();
          },
          abort: () => {},
          dispose: () => {},
        }),
      },
    );

    await waitFor(() => events.some((event) => event.type === 'done'));
    expect(events.some((event) => event.type === 'text-delta')).toBe(true);
    // 会话仍是 seedSession 写入的 streaming 空文本。
    expect(getAgentSession().status).toBe('streaming');
    expect(getAgentSession().text).toBe('');
  });

  it('reset 之后迟到的 done 不会把 idle 改回 done', async () => {
    seedSession();
    let captured: CreateAgentArgs | null = null;

    runAgent(
      { messages: [{ role: 'user', content: 'hi' }] },
      { onEvent: () => {} },
      {
        profileId: 'p1',
        createAgent: (args) => {
          captured = args;
          return {
            prompt: () => new Promise<void>(() => {}),
            abort: () => {},
            dispose: () => {},
          };
        },
      },
    );

    await waitFor(() => captured !== null);
    const args = captured as unknown as CreateAgentArgs;
    resetAgentSession();

    args.onDelta('迟到', 'text');
    args.onDone();

    expect(getAgentSession().status).toBe('idle');
    expect(getAgentSession().text).toBe('');
    expect(getAgentSession().error).toBeNull();
  });

  it('新 run 期间旧 run 的迟到写入不污染新会话', async () => {
    seedSession();
    let captured: CreateAgentArgs | null = null;

    runAgent(
      { messages: [{ role: 'user', content: '旧请求' }] },
      { onEvent: () => {} },
      {
        profileId: 'p1',
        createAgent: (args) => {
          captured = args;
          return {
            prompt: () => new Promise<void>(() => {}),
            abort: () => {},
            dispose: () => {},
          };
        },
      },
    );

    await waitFor(() => captured !== null);
    const oldArgs = captured as unknown as CreateAgentArgs;

    // 模拟重试/新请求：id 递增、文本清空。
    setAgentSession({
      title: '新请求',
      anchor: null,
      request: { messages: [{ role: 'user', content: '新请求' }] },
    });
    expect(getAgentSession().id).toBe(2);

    oldArgs.onDelta('旧增量', 'text');
    oldArgs.onDone();
    flushAgentTextForTests();

    expect(getAgentSession().id).toBe(2);
    expect(getAgentSession().title).toBe('新请求');
    expect(getAgentSession().status).toBe('streaming');
    expect(getAgentSession().text).toBe('');
  });

  it('abort：不抛错，session 进入 done，后续增量被忽略', async () => {
    seedSession();
    const events: AgentEvent[] = [];
    const abort = vi.fn();
    const dispose = vi.fn();
    let captured: { onDelta(delta: string, kind: 'text' | 'reasoning'): void } | null = null;

    const handle = runAgent(
      { messages: [{ role: 'user', content: 'hi' }] },
      { onEvent: (event) => events.push(event) },
      {
        profileId: 'p1',
        createAgent: (args) => {
          captured = args;
          return {
            prompt: () => new Promise<void>(() => {}),
            abort,
            dispose,
          };
        },
      },
    );

    await waitFor(() => captured !== null);
    const args = captured as unknown as {
      onDelta(delta: string, kind: 'text' | 'reasoning'): void;
    };
    args.onDelta('部分', 'text');
    flushAgentTextForTests();
    expect(getAgentSession().text).toBe('部分');

    expect(() => handle.abort()).not.toThrow();
    expect(abort).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(getAgentSession().status).toBe('done');
    expect(getAgentSession().text).toBe('部分');

    // 中止后不再接受增量 / 事件
    args.onDelta('追加', 'text');
    flushAgentTextForTests();
    expect(getAgentSession().text).toBe('部分');
    expect(events.some((event) => event.type === 'done')).toBe(false);

    expect(() => handle.abort()).not.toThrow();
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('refuses to run without a profile id', async () => {
    const events: AgentEvent[] = [];
    runAgent(
      { messages: [{ role: 'user', content: 'hi' }] },
      { onEvent: (event) => events.push(event) },
      { profileId: 'missing', writeSession: false },
    );
    await waitFor(() => events.length > 0);
    expect(events[0]).toMatchObject({
      type: 'error',
      message: expect.stringContaining('模型配置'),
      retryable: false,
    });
    expect(providers.resolveAgentModel).not.toHaveBeenCalled();
  });

  it('refuses to run an incomplete profile', async () => {
    config.isProfileComplete.mockReturnValue(false);
    const events: AgentEvent[] = [];
    runAgent(
      { messages: [{ role: 'user', content: 'hi' }] },
      { onEvent: (event) => events.push(event) },
      { profileId: 'p1', writeSession: false },
    );
    await waitFor(() => events.length > 0);
    expect(events[0]).toMatchObject({
      type: 'error',
      message: '所选模型配置不完整',
      retryable: false,
    });
    expect(providers.resolveAgentModel).not.toHaveBeenCalled();
  });

  it('refuses to run when AI is disabled', async () => {
    config.agentAvailable.mockReturnValue(false);
    const events: AgentEvent[] = [];
    runAgent(
      { messages: [{ role: 'user', content: 'hi' }] },
      { onEvent: (event) => events.push(event) },
      { profileId: 'p1', writeSession: false },
    );
    await waitFor(() => events.length > 0);
    expect(events[0]).toMatchObject({
      type: 'error',
      message: 'AI 功能未开启',
      retryable: false,
    });
    expect(providers.resolveAgentModel).not.toHaveBeenCalled();
  });
});
