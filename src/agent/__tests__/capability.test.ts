import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentProfile } from '../config';

const config = vi.hoisted(() => ({
  agentAvailable: vi.fn((_profileId: string) => false),
  listAgentProfiles: vi.fn((): AgentProfile[] => []),
  surface: 'floating' as 'floating' | 'sidebar',
}));
vi.mock('../config', () => ({
  agentAvailable: config.agentAvailable,
  listAgentProfiles: config.listAgentProfiles,
  getAgentSettings: () => ({
    provider: 'openai',
    model: 'gpt-6-luna',
    baseUrl: '',
    apiKey: 'k',
    surface: config.surface,
  }),
}));

const runtime = vi.hoisted(() => ({ runAgent: vi.fn() }));
vi.mock('../runtime', () => ({ runAgent: runtime.runAgent }));

// capability 动态 import presenter：mock 掉就不会真的挂载 React 视图。
const presenter = vi.hoisted(() => ({ attachFloatingCard: vi.fn() }));
vi.mock('../presenter', () => ({ attachFloatingCard: presenter.attachFloatingCard }));

import { agentCapability } from '../capability';
import { getAgentSession, resetAgentSessionForTests } from '../session';
import { AGENT_SURFACE_EVENT } from '../surface';
import type { PluginHost } from '@texto/plugin-sdk';

// 这些用例不触及工具执行，宿主只作占位。
const host = {} as PluginHost;

const anchor = { left: 10, top: 20, right: 100, bottom: 40, width: 90, height: 20 };
const request = { messages: [{ role: 'user' as const, content: 'hi' }] };
const profileId = 'p1';

beforeEach(() => {
  vi.clearAllMocks();
  config.agentAvailable.mockReturnValue(false);
  config.listAgentProfiles.mockReturnValue([]);
  config.surface = 'floating';
  runtime.runAgent.mockReturnValue({ abort: vi.fn() });
  resetAgentSessionForTests();
});

describe('agentCapability', () => {
  it('available() 每次读当前配置', () => {
    const agent = agentCapability(host, () => host);

    config.agentAvailable.mockReturnValue(true);
    expect(agent.available(profileId)).toBe(true);

    config.agentAvailable.mockReturnValue(false);
    expect(agent.available(profileId)).toBe(false);
    expect(config.agentAvailable).toHaveBeenCalledTimes(2);
    expect(config.agentAvailable).toHaveBeenNthCalledWith(1, profileId);
  });

  it('run() 只经 handlers 回调，不写共享会话', () => {
    const handle = { abort: vi.fn() };
    runtime.runAgent.mockReturnValue(handle);
    const handlers = { onEvent: vi.fn() };

    expect(agentCapability(host, () => host).run(request, handlers, { profileId })).toBe(handle);
    expect(runtime.runAgent).toHaveBeenCalledWith(request, handlers, {
      writeSession: false,
      profileId,
    });
  });

  it('present() 写入共享会话并挂载悬浮块', async () => {
    const agent = agentCapability(host, () => host);

    const handle = agent.present(request, {
      anchor,
      title: '解释',
      tabLabel: '翻译',
      sourceText: '选中的原文',
      profileId,
    });

    expect(getAgentSession().status).toBe('streaming');
    expect(getAgentSession().title).toBe('解释');
    expect(getAgentSession().tabLabel).toBe('翻译');
    expect(getAgentSession().sourceText).toBe('选中的原文');
    expect(getAgentSession().anchor).toEqual(anchor);
    expect(getAgentSession().request).toEqual(request);
    expect(getAgentSession().profileId).toBe(profileId);
    // 会话写入由 startAgentRun 负责（runAgent 默认 writeSession=true）。
    expect(runtime.runAgent).toHaveBeenCalledTimes(1);
    expect(handle).toBeDefined();

    await vi.waitFor(() => {
      expect(presenter.attachFloatingCard).toHaveBeenCalledWith(anchor, undefined);
    });
  });

  it('present() 在 sidebar 承载面时广播切 tab 事件', () => {
    config.surface = 'sidebar';
    const handler = vi.fn();
    window.addEventListener(AGENT_SURFACE_EVENT, handler);
    try {
      agentCapability(host, () => host).present(request, { anchor, profileId });

      expect(handler).toHaveBeenCalledTimes(1);
      expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ surface: 'sidebar' });
    } finally {
      window.removeEventListener(AGENT_SURFACE_EVENT, handler);
    }
  });

  it('present() 在 floating 承载面时不广播', () => {
    const handler = vi.fn();
    window.addEventListener(AGENT_SURFACE_EVENT, handler);
    try {
      agentCapability(host, () => host).present(request, { anchor, profileId });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(AGENT_SURFACE_EVENT, handler);
    }
  });

  it('present() 未给标题时写空串', async () => {
    agentCapability(host, () => host).present(request, { anchor, profileId });

    expect(getAgentSession().title).toBe('');
    expect(getAgentSession().tabLabel).toBe('');
    expect(getAgentSession().sourceText).toBe('');
    await vi.waitFor(() => {
      expect(presenter.attachFloatingCard).toHaveBeenCalledWith(anchor, undefined);
    });
  });

  it('present() 把尺寸偏好交给悬浮卡', async () => {
    const size = { width: 420, maxHeight: 480 };
    agentCapability(host, () => host).present(request, { anchor, size, profileId });

    expect(getAgentSession().anchor).toEqual(anchor);
    await vi.waitFor(() => {
      expect(presenter.attachFloatingCard).toHaveBeenCalledWith(anchor, size);
    });
  });

  it('exposes only public profile fields', () => {
    config.listAgentProfiles.mockReturnValue([
      {
        id: 'p1',
        name: 'n',
        provider: 'deepseek',
        model: 'm',
        apiKey: 'secret',
        baseUrl: '',
        enabled: true,
      },
    ]);
    const capability = agentCapability(host, () => host);
    expect(capability.profiles.list()).toEqual([
      { id: 'p1', name: 'n', provider: 'deepseek', model: 'm', enabled: true },
    ]);
  });

  it('tools 用传入的宿主执行内置工具', async () => {
    const ctx = { selection: 'Markdown', paragraph: '正文', headings: [], anchor };
    const toolHost = {
      editor: { getSelectionContext: () => ctx },
    } as unknown as PluginHost;
    const agent = agentCapability(toolHost, () => toolHost);

    expect(agent.tools.list().map((tool) => tool.name)).toContain('core.read-selection-context');
    await expect(agent.tools.call('core.read-selection-context')).resolves.toEqual({
      content: JSON.stringify({
        selection: ctx.selection,
        paragraph: ctx.paragraph,
        headings: ctx.headings,
      }),
      details: ctx,
    });
  });
});
