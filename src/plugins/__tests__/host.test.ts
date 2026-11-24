import { describe, expect, it, vi, beforeEach } from 'vitest';

import { resetPluginConfigSnapshotsForTests, setPluginConfigSnapshot } from '@texto/plugin-sdk';

const invoke = vi.fn();
const tauriEmit = vi.fn(async (..._args: unknown[]) => {});
const openDialog = vi.fn();
const confirmDialog = vi.fn();
const toastInfo = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('@tauri-apps/api/event', () => ({
  emit: (...args: unknown[]) => tauriEmit(...args),
  listen: vi.fn(async () => () => {}),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'main' }) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => openDialog(...args),
  confirm: (...args: unknown[]) => confirmDialog(...args),
}));
vi.mock('sonner', () => ({
  toast: {
    info: (...a: unknown[]) => toastInfo(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));
vi.mock('@/i18n', () => ({ default: { t: (k: string) => `t:${k}`, language: 'en' } }));
vi.mock('@/components/styles/theme', () => ({ getCurrentAppearance: () => 'dark' }));

import { createPluginHost } from '../host';

const deps = {
  getCurrentFile: () => '/docs/note.md',
  getDocumentDir: () => '/docs',
  openFile: vi.fn(async () => {}),
  toDocumentRelative: vi.fn((abs: string) => `rel:${abs}`),
  createNewDocument: vi.fn(async () => {}),
  insertImageRef: vi.fn(),
  canEdit: vi.fn(() => true),
  getSelectionContext: vi.fn(() => null),
};

beforeEach(() => {
  vi.clearAllMocks();
  resetPluginConfigSnapshotsForTests();
});

describe('createPluginHost', () => {
  it('delegates document accessors', async () => {
    const host = createPluginHost(deps, 'test-plugin');
    expect(host.documents.getCurrentFile()).toBe('/docs/note.md');
    expect(host.documents.getDocumentDir()).toBe('/docs');
    await host.documents.openFile('/docs/other.md');
    expect(deps.openFile).toHaveBeenCalledWith('/docs/other.md');
  });

  it('delegates editor and new-document capabilities', async () => {
    const host = createPluginHost(deps, 'test-plugin');
    expect(host.documents.toDocumentRelative('/docs/a.png')).toBe('rel:/docs/a.png');
    await host.documents.createNewDocument({ content: 'x', extension: 'excalidraw' });
    expect(deps.createNewDocument).toHaveBeenCalledWith({ content: 'x', extension: 'excalidraw' });
    host.editor.insertImageRef('a.png', 'alt');
    expect(deps.insertImageRef).toHaveBeenCalledWith('a.png', 'alt');
    expect(host.editor.canEdit()).toBe(true);
    expect(host.editor.getSelectionContext()).toBeNull();
  });

  it('reads config through the plugin-scoped store', async () => {
    invoke.mockResolvedValueOnce({ some_key: 7 });
    const host = createPluginHost(deps, 'test-plugin');
    await expect(host.config.get<number>('some_key')).resolves.toBe(7);
    expect(invoke).toHaveBeenCalledWith('get_plugin_config', { pluginId: 'test-plugin' });
  });

  it('writes config by merging into the plugin-scoped store', async () => {
    invoke.mockResolvedValueOnce({ a: 1 });
    const host = createPluginHost(deps, 'test-plugin');
    await host.config.set('b', 2);
    expect(invoke).toHaveBeenNthCalledWith(1, 'get_plugin_config', { pluginId: 'test-plugin' });
    expect(invoke).toHaveBeenNthCalledWith(2, 'set_plugin_config', {
      pluginId: 'test-plugin',
      config: { a: 1, b: 2 },
    });
  });

  it('reads the whole plugin-scoped config', async () => {
    invoke.mockResolvedValueOnce({ a: 1, b: 2 });
    const host = createPluginHost(deps, 'test-plugin');
    await expect(host.config.getAll()).resolves.toEqual({ a: 1, b: 2 });
    expect(invoke).toHaveBeenCalledWith('get_plugin_config', { pluginId: 'test-plugin' });
  });

  it('routes config subscriptions through the real-time snapshot', () => {
    const host = createPluginHost(deps, 'test-plugin');
    const cb = vi.fn();
    const off = host.config.subscribe(cb);
    setPluginConfigSnapshot('test-plugin', { k: 1 });
    expect(cb).toHaveBeenCalledWith({ k: 1 });
    off();
    setPluginConfigSnapshot('test-plugin', { k: 2 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('isolates config reads per plugin id', async () => {
    const h1 = createPluginHost(deps, 'p1');
    const h2 = createPluginHost(deps, 'p2');
    invoke.mockResolvedValueOnce({ k: 'one' });
    await expect(h1.config.get<string>('k')).resolves.toBe('one');
    invoke.mockResolvedValueOnce({ k: 'two' });
    await expect(h2.config.get<string>('k')).resolves.toBe('two');
    expect(invoke).toHaveBeenNthCalledWith(1, 'get_plugin_config', { pluginId: 'p1' });
    expect(invoke).toHaveBeenNthCalledWith(2, 'get_plugin_config', { pluginId: 'p2' });
  });

  it('exposes i18n and theme', () => {
    const host = createPluginHost(deps, 'test-plugin');
    expect(host.i18n.t('a.b')).toBe('t:test-plugin.a.b');
    expect(host.i18n.t('a.b', { ns: 'plugins' })).toBe('t:test-plugin.a.b');
    expect(host.i18n.language()).toBe('en');
    expect(host.theme.appearance()).toBe('dark');
  });

  it('notifies theme subscribers and unsubscribes', () => {
    const host = createPluginHost(deps, 'test-plugin');
    const cb = vi.fn();
    const off = host.theme.subscribe(cb);
    window.dispatchEvent(new CustomEvent('appearancechange', { detail: 'light' }));
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    window.dispatchEvent(new CustomEvent('appearancechange', { detail: 'light' }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('routes events through the DOM and Tauri', () => {
    const host = createPluginHost(deps, 'test-plugin');
    const cb = vi.fn();
    host.events.on('texto-test', cb);
    host.events.emit('texto-test', { n: 1 });
    expect(cb).toHaveBeenCalledWith({ n: 1 });
    expect(tauriEmit).toHaveBeenCalledWith('texto-test', { n: 1 });
  });

  it('routes toasts', () => {
    const host = createPluginHost(deps, 'test-plugin');
    host.toast.info('i');
    host.toast.success('s');
    host.toast.error('e');
    expect(toastInfo).toHaveBeenCalledWith('i');
    expect(toastSuccess).toHaveBeenCalledWith('s');
    expect(toastError).toHaveBeenCalledWith('e');
  });

  it('picks files and confirms through the dialog plugin', async () => {
    openDialog.mockResolvedValueOnce('/picked.txt');
    confirmDialog.mockResolvedValueOnce(true);
    const host = createPluginHost(deps, 'test-plugin');
    await expect(host.dialogs.pickFile({ filters: [{ name: 'Txt', extensions: ['txt'] }] })).resolves.toBe('/picked.txt');
    await expect(host.dialogs.confirm({ title: 't', message: 'm' })).resolves.toBe(true);
  });

  it('reports the main window', () => {
    const host = createPluginHost(deps, 'test-plugin');
    expect(host.window.isMain()).toBe(true);
  });

  it('reports edition full when not free version', () => {
    const host = createPluginHost(deps, 'test-plugin');
    expect(host.edition).toBe('full');
  });

  it('exposes the real agent capability (unavailable while unconfigured)', () => {
    const host = createPluginHost(deps, 'x');
    expect(typeof host.agent.available).toBe('function');
    expect(host.agent.available('p1')).toBe(false);
  });

  it('wires the capability returned by the agent module', async () => {
    vi.resetModules();
    vi.doMock('@/agent/capability', () => ({
      agentCapability: () => ({
        available: () => true,
        run: () => ({ abort: () => {} }),
        present: () => ({ abort: () => {} }),
        profiles: { list: () => [] },
        tools: { list: () => [], call: async () => ({ content: '' }) },
      }),
    }));
    try {
      const { createPluginHost: createFreshHost } = await import('../host');
      const host = createFreshHost(deps, 'x');
      expect(host.agent.available('p1')).toBe(true);
    } finally {
      vi.doUnmock('@/agent/capability');
      vi.resetModules();
    }
  });
});
