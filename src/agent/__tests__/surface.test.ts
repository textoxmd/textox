import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { getAgentSettings, resetAgentConfigForTests } from '../config';
import { AGENT_SURFACE_EVENT, setAgentSurface } from '../surface';

type SurfaceEvent = CustomEvent<{ surface: string }>;

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ agent_result_surface: 'floating' });
  resetAgentConfigForTests();
});

describe('setAgentSurface', () => {
  it('写入配置并广播承载面切换', async () => {
    const handler = vi.fn();
    window.addEventListener(AGENT_SURFACE_EVENT, handler);
    try {
      await setAgentSurface('sidebar');

      expect(invoke).toHaveBeenCalledWith('set_config', {
        config: expect.objectContaining({ agent_result_surface: 'sidebar' }),
      });
      expect(getAgentSettings().surface).toBe('sidebar');
      expect(handler).toHaveBeenCalledTimes(1);
      expect((handler.mock.calls[0][0] as SurfaceEvent).detail).toEqual({ surface: 'sidebar' });
    } finally {
      window.removeEventListener(AGENT_SURFACE_EVENT, handler);
    }
  });

  it('配置写入失败时不广播', async () => {
    const handler = vi.fn();
    window.addEventListener(AGENT_SURFACE_EVENT, handler);
    invoke.mockRejectedValue(new Error('write denied'));
    try {
      await expect(setAgentSurface('floating')).rejects.toThrow('write denied');
      expect(handler).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(AGENT_SURFACE_EVENT, handler);
    }
  });
});
