import { describe, expect, it } from 'vitest';

import { definePlugin } from './define-plugin';

describe('definePlugin', () => {
  it('returns the same plugin object (identity)', () => {
    const plugin = { id: 'demo', version: '0.0.1' };
    expect(definePlugin(plugin)).toBe(plugin);
  });

  it('accepts extensionPoints / contributes without changing the object', () => {
    const plugin = {
      id: 'demo',
      version: '0.0.1',
      extensionPoints: [{ id: 'demo:point' }],
    };
    expect(definePlugin(plugin)).toBe(plugin);
  });

  it('accepts an optional activate hook', () => {
    const plugin = definePlugin({
      id: 'p',
      version: '1.0.0',
      activate: async () => {},
    });
    expect(typeof plugin.activate).toBe('function');
  });

  it('preserves the migration declaration', () => {
    const plugin = definePlugin({
      id: 'm',
      version: '0.0.1',
      migration: {
        enableWhenImageStorageMode: 'picgo',
        appConfigKeys: { server_url: 'picgo_server_url' },
      },
    });
    expect(plugin.migration).toEqual({
      enableWhenImageStorageMode: 'picgo',
      appConfigKeys: { server_url: 'picgo_server_url' },
    });
  });
});
