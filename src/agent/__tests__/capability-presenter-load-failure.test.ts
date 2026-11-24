import { beforeEach, describe, expect, it, vi } from 'vitest';

// 模拟 presenter chunk 加载失败：`import('./presenter')` 直接 reject。
vi.mock('../presenter', () => {
  throw new Error('presenter chunk failed');
});

const runtime = vi.hoisted(() => ({ runAgent: vi.fn() }));
vi.mock('../runtime', () => ({ runAgent: runtime.runAgent }));

import { agentCapability } from '../capability';
import { finishAgentSession, getAgentSession, resetAgentSessionForTests } from '../session';
import type { PluginHost } from '@texto/plugin-sdk';

const host = {} as PluginHost;

const anchor = { left: 10, top: 20, right: 100, bottom: 40, width: 90, height: 20 };
const request = { messages: [{ role: 'user' as const, content: 'hi' }] };

beforeEach(() => {
  vi.clearAllMocks();
  resetAgentSessionForTests();
});

describe('agentCapability presenter fallback', () => {
  it('presenter 加载失败时保留错误态并中止运行', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // 与真实 runtime 的 abort 一致：中止时会把 session 从 streaming 收尾。
      const abort = vi.fn(() => {
        finishAgentSession();
      });
      runtime.runAgent.mockReturnValue({ abort });

      const handle = agentCapability(host, () => host).present(request, {
        anchor,
        profileId: 'p1',
      });
      expect(handle).toBeDefined();

      await vi.waitFor(() => {
        expect(abort).toHaveBeenCalledTimes(1);
        expect(getAgentSession().status).toBe('error');
      });
      expect(getAgentSession().error).toBeTruthy();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
