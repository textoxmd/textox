import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { definePlugin } from '@texto/plugin-sdk';

import { resetAppConfigCacheForTests } from '@/utils/appConfig';

import { migrateLegacyPluginState } from '../migrate';
import { isPluginEnabled } from '../pluginStatus';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (_cmd: string, _args?: unknown): Promise<unknown> => ({})),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const legacyPlugin = definePlugin({
  id: 'legacy',
  version: '0.0.1',
  migration: {
    enableWhenImageStorageMode: 'picgo',
    appConfigKeys: { server_url: 'picgo_server_url' },
  },
});

beforeEach(() => {
  invokeMock.mockReset();
  resetAppConfigCacheForTests();
});

afterEach(() => {
  localStorage.clear();
});

describe('migrateLegacyPluginState', () => {
  it('enables the plugin, copies config and rewrites the legacy mode', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_config') {
        return { image_storage_mode: 'picgo', picgo_server_url: 'http://custom:1234' };
      }
      if (cmd === 'get_plugin_config') return {};
      return undefined;
    });

    await migrateLegacyPluginState([legacyPlugin]);

    expect(isPluginEnabled('legacy', false)).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('set_plugin_config', {
      pluginId: 'legacy',
      config: { server_url: 'http://custom:1234' },
    });
    expect(invokeMock).toHaveBeenCalledWith('set_config', {
      config: { image_storage_mode: 'alongside_document', picgo_server_url: 'http://custom:1234' },
    });
  });

  it('does nothing when the legacy mode is not set', async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'get_config' ? { image_storage_mode: 'alongside_document' } : undefined,
    );

    await migrateLegacyPluginState([legacyPlugin]);

    expect(isPluginEnabled('legacy', false)).toBe(false);
    expect(invokeMock).not.toHaveBeenCalledWith('set_plugin_config', expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith('set_config', expect.anything());
  });

  it('does not overwrite an already-set plugin config key', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_config') {
        return { image_storage_mode: 'picgo', picgo_server_url: 'http://old:1' };
      }
      if (cmd === 'get_plugin_config') return { server_url: 'http://mine:2' };
      return undefined;
    });

    await migrateLegacyPluginState([legacyPlugin]);

    expect(invokeMock).not.toHaveBeenCalledWith('set_plugin_config', expect.anything());
    expect(invokeMock).toHaveBeenCalledWith('set_config', {
      config: { image_storage_mode: 'alongside_document', picgo_server_url: 'http://old:1' },
    });
  });

  it('migrates every plugin that shares the same legacy mode', async () => {
    const a = definePlugin({ id: 'a', version: '0.0.1', migration: { enableWhenImageStorageMode: 'picgo' } });
    const b = definePlugin({ id: 'b', version: '0.0.1', migration: { enableWhenImageStorageMode: 'picgo' } });
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'get_config' ? { image_storage_mode: 'picgo' } : undefined,
    );

    await migrateLegacyPluginState([a, b]);

    expect(isPluginEnabled('a', false)).toBe(true);
    expect(isPluginEnabled('b', false)).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('set_config', {
      config: { image_storage_mode: 'alongside_document' },
    });
  });

  it('swallows get_config failures', async () => {
    invokeMock.mockRejectedValue(new Error('boom'));
    await expect(migrateLegacyPluginState([legacyPlugin])).resolves.toBeUndefined();
  });
});
