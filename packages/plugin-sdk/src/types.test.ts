import { describe, expect, expectTypeOf, it } from 'vitest';
import type { AgentCapability, AgentRunOptions, PluginHost } from './types';
import type { AgentProfileInfo } from './index';

describe('PluginHost.agent 契约', () => {
  it('接受最小的 AgentCapability 实现', () => {
    const agent: AgentCapability = {
      available: () => true,
      run: () => ({ abort: () => {} }),
      present: () => ({ abort: () => {} }),
      profiles: {
        list: () => [],
      },
      tools: {
        list: () => [],
        call: async () => ({ content: '' }),
      },
    } satisfies AgentCapability;
    // 故意只构造 `agent` 后强转、省略其余成员：若 `PluginHost.agent` 被删除或类型改错，
    // 该断言与下方的访问会一起编译失败。
    const host = { agent } as PluginHost;

    expect(host.agent.available('p1')).toBe(true);
    expect(typeof host.agent.available).toBe('function');
    expect(typeof host.agent.run).toBe('function');
    expect(typeof host.agent.present).toBe('function');
    expect(typeof host.agent.tools.list).toBe('function');
    expect(typeof host.agent.tools.call).toBe('function');
    expectTypeOf<PluginHost['agent']>().toEqualTypeOf<AgentCapability>();
  });

  it('运行必须显式指定 profileId', () => {
    const agent: AgentCapability = {
      available: (profileId) => profileId === 'p1',
      run: (_request, _handlers, options) => ({ abort: () => void options.profileId }),
      present: (_request, options) => ({ abort: () => void options.profileId }),
      profiles: { list: () => [] },
      tools: { list: () => [], call: async () => ({ content: '' }) },
    };
    expect(agent.available('')).toBe(false);
    expect(agent.available('p1')).toBe(true);
    expectTypeOf<AgentCapability['run']>().parameter(2).toEqualTypeOf<AgentRunOptions>();
  });

  it('契约包入口导出 AgentProfileInfo', () => {
    const info: AgentProfileInfo = {
      id: 'p1',
      name: 'n',
      provider: 'deepseek',
      model: 'm',
      enabled: true,
    };
    expect(info.enabled).toBe(true);
  });
});
