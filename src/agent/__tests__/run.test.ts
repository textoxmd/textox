import { beforeEach, describe, expect, it, vi } from 'vitest';
import { abortActiveAgentRun, startAgentRun, testAgentConnection } from '../run';
import { getAgentSession, resetAgentSessionForTests } from '../session';

const runtime = vi.hoisted(() => ({ runAgent: vi.fn() }));
vi.mock('../runtime', () => ({ runAgent: runtime.runAgent }));

const providers = vi.hoisted(() => ({ resolveAgentModel: vi.fn() }));
vi.mock('../providers', () => ({ resolveAgentModel: providers.resolveAgentModel }));

const config = vi.hoisted(() => ({
  findAgentProfile: vi.fn(),
  isProfileComplete: vi.fn(),
}));
vi.mock('../config', () => ({
  findAgentProfile: config.findAgentProfile,
  isProfileComplete: config.isProfileComplete,
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

const request = { messages: [{ role: 'user' as const, content: 'hi' }] };
const aborts: Array<ReturnType<typeof vi.fn>> = [];

beforeEach(() => {
  abortActiveAgentRun();
  resetAgentSessionForTests();
  aborts.length = 0;
  providers.resolveAgentModel.mockReset();
  runtime.runAgent.mockReset();
  runtime.runAgent.mockImplementation(() => {
    const abort = vi.fn();
    aborts.push(abort);
    return { abort };
  });
  config.findAgentProfile.mockReset();
  config.findAgentProfile.mockImplementation((id: string) =>
    id === profile.id ? profile : null,
  );
  config.isProfileComplete.mockReset();
  config.isProfileComplete.mockReturnValue(true);
});

describe('startAgentRun', () => {
  it('写入会话并返回运行句柄', () => {
    const handle = startAgentRun(request, null, '翻译 · 文本', '翻译', '原文内容', 'p1');

    expect(getAgentSession()).toMatchObject({
      id: 1,
      title: '翻译 · 文本',
      tabLabel: '翻译',
      sourceText: '原文内容',
      status: 'streaming',
      request,
      profileId: 'p1',
    });
    expect(runtime.runAgent).toHaveBeenCalledTimes(1);
    expect(runtime.runAgent.mock.calls[0]?.[0]).toBe(request);
    expect(runtime.runAgent.mock.calls[0]?.[2]).toEqual({ profileId: 'p1' });
    expect(handle).toBe(runtime.runAgent.mock.results[0]?.value);
  });

  it('缺省 profileId 时写入空串并透传空串', () => {
    startAgentRun(request, null, '无配置');

    expect(getAgentSession().profileId).toBe('');
    expect(runtime.runAgent.mock.calls[0]?.[2]).toEqual({ profileId: '' });
  });

  it('再次 start 会先中止上一条运行并开始新会话', () => {
    startAgentRun(request, null, '第一');
    startAgentRun(request, null, '第二');

    expect(aborts[0]).toHaveBeenCalledTimes(1);
    expect(getAgentSession()).toMatchObject({ id: 2, title: '第二', status: 'streaming' });
  });
});

describe('abortActiveAgentRun', () => {
  it('中止当前运行后清空引用（再次调用不再 abort）', () => {
    startAgentRun(request, null, '解释');
    abortActiveAgentRun();
    abortActiveAgentRun();

    expect(aborts[0]).toHaveBeenCalledTimes(1);
  });

  it('没有活动运行时是 no-op', () => {
    expect(() => abortActiveAgentRun()).not.toThrow();
    expect(aborts).toHaveLength(0);
  });
});

describe('testAgentConnection', () => {
  it('成功时不写会话', async () => {
    const complete = vi.fn().mockResolvedValue({ errorMessage: undefined });
    const model = { id: 'fake-model' };
    providers.resolveAgentModel.mockResolvedValue({ models: { complete }, model });

    await testAgentConnection('p1');

    expect(providers.resolveAgentModel).toHaveBeenCalledWith(profile);
    expect(complete).toHaveBeenCalledWith(
      model,
      {
        messages: [expect.objectContaining({ role: 'user', content: 'ping' })],
      },
      { apiKey: 'sk-live', signal: undefined },
    );
    expect(getAgentSession().status).toBe('idle');
    expect(runtime.runAgent).not.toHaveBeenCalled();
  });

  it('把 AbortSignal 透传给 provider', async () => {
    const complete = vi.fn().mockResolvedValue({ errorMessage: undefined });
    const model = { id: 'fake-model' };
    providers.resolveAgentModel.mockResolvedValue({ models: { complete }, model });
    const controller = new AbortController();

    await testAgentConnection('p1', controller.signal);

    expect(complete).toHaveBeenCalledWith(
      model,
      expect.anything(),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('中止时把 provider 的拒绝抛给调用方', async () => {
    const complete = vi
      .fn()
      .mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));
    providers.resolveAgentModel.mockResolvedValue({ models: { complete }, model: {} });
    const controller = new AbortController();
    controller.abort();

    await expect(testAgentConnection('p1', controller.signal)).rejects.toThrow(
      'The operation was aborted.',
    );
  });

  it('provider 返回错误时抛出', async () => {
    const complete = vi.fn().mockResolvedValue({ errorMessage: 'invalid api key' });
    providers.resolveAgentModel.mockResolvedValue({ models: { complete }, model: {} });

    await expect(testAgentConnection('p1')).rejects.toThrow('invalid api key');
  });

  it('rejects a missing profile before any request', async () => {
    await expect(testAgentConnection('missing')).rejects.toThrow('所选模型配置不存在');
    expect(providers.resolveAgentModel).not.toHaveBeenCalled();
  });

  it('does not hit the network for an incomplete profile', async () => {
    config.findAgentProfile.mockReturnValue(profile);
    config.isProfileComplete.mockReturnValue(false);
    await expect(testAgentConnection('p1')).rejects.toThrow('所选模型配置不完整');
    expect(providers.resolveAgentModel).not.toHaveBeenCalled();
  });
});
