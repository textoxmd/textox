import type { PluginHost } from '@texto/plugin-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActiveRenderer, resetRendererStateForTests } from './diagram-engine';
import plugin from './index';

beforeEach(() => {
  resetRendererStateForTests();
});

function createHost(initialConfig: Record<string, unknown> | Error) {
  const listeners: Array<(config: Record<string, unknown>) => void> = [];
  const getAll = vi.fn(async () => {
    if (initialConfig instanceof Error) throw initialConfig;
    return initialConfig;
  });
  const subscribe = vi.fn((listener: (config: Record<string, unknown>) => void) => {
    listeners.push(listener);
    return () => {};
  });
  const host = { config: { getAll, subscribe } } as unknown as PluginHost;
  return { host, listeners, getAll, subscribe };
}

describe('mermaid plugin manifest', () => {
  it('contributes a code block extension for mermaid', () => {
    const ext = plugin.contributes?.['markdown-editor:extension']?.[0];
    expect(ext?.id).toBe('mermaid.renderer');
    expect(ext?.languages).toEqual(['mermaid']);
  });

  it('contributes a mermaid insert command', () => {
    const ext = plugin.contributes?.['markdown-editor:extension']?.find(
      (e) => e.id === 'mermaid.insert',
    );
    expect(ext?.insert?.id).toBe('mermaid');
    expect(ext?.insert?.keyword).toBe('mermaid');
  });

  it('contributes a context menu item for copying the source', () => {
    const items = plugin.contributes?.['markdown-editor:contextMenu'];
    expect(items).toHaveLength(1);
    expect(items?.[0]?.id).toBe('mermaid.copySource');
  });

  it('contributes the renderer settings section', () => {
    const sections = plugin.contributes?.['app:settingsSection'];
    expect(sections?.[0]?.id).toBe('mermaid.settings');
    expect(sections?.[0]?.fields[0]).toMatchObject({
      type: 'select',
      key: 'renderer',
      default: 'mermaid',
    });
  });

  it('activate 读取初始渲染器并跟随配置变化', async () => {
    const { host, listeners } = createHost({ renderer: 'pele' });

    await plugin.activate?.(host);

    expect(getActiveRenderer()).toBe('pele');

    listeners[0]?.({ renderer: 'mermaid' });
    expect(getActiveRenderer()).toBe('mermaid');
  });

  it('activate 遇到未知渲染器时回退默认值', async () => {
    const { host, listeners } = createHost({ renderer: 'pele' });

    await plugin.activate?.(host);
    expect(getActiveRenderer()).toBe('pele');

    listeners[0]?.({ renderer: 'unknown' });
    // 「回退默认」而非「忽略非法值」：初始值若被忽略，这里仍是 pele。
    expect(getActiveRenderer()).toBe('mermaid');
  });

  it('activate 在首次安装（配置为空）时使用默认渲染器', async () => {
    const { host, subscribe } = createHost({});

    await plugin.activate?.(host);

    expect(getActiveRenderer()).toBe('mermaid');
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('activate 读取配置失败时仍订阅配置变化', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { host, listeners, subscribe } = createHost(new Error('boom'));

      await plugin.activate?.(host);

      expect(getActiveRenderer()).toBe('mermaid');
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalled();

      listeners[0]?.({ renderer: 'pele' });
      expect(getActiveRenderer()).toBe('pele');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
