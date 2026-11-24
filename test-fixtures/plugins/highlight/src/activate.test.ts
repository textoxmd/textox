import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginHost } from '@texto/plugin-sdk';

import plugin from './index';
import { highlightColorCss } from './settings';

const STYLE_ELEMENT_ID = 'texto-plugin-highlight-color';

function createHost(initialConfig: Record<string, unknown>) {
  const listeners: Array<(config: Record<string, unknown>) => void> = [];
  const subscribe = vi.fn((listener: (config: Record<string, unknown>) => void) => {
    listeners.push(listener);
    return () => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    };
  });

  const host = {
    config: {
      getAll: vi.fn(async () => initialConfig),
      subscribe,
    },
  } as unknown as PluginHost;

  return { host, subscribe, listeners };
}

describe('highlight plugin activate', () => {
  afterEach(() => {
    document.getElementById(STYLE_ELEMENT_ID)?.remove();
  });

  it('applies stored color and re-applies on config change', async () => {
    const { host, subscribe, listeners } = createHost({ highlightColor: '#a3e07a' });

    await plugin.activate!(host);

    const el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe(highlightColorCss('#a3e07a'));
    expect(subscribe).toHaveBeenCalledTimes(1);

    listeners[0]!({ highlightColor: '#f7d54e' });
    expect(el!.textContent).toBe(highlightColorCss('#f7d54e'));
  });
});
