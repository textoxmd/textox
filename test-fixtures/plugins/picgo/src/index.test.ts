import { APP_IMAGE_UPLOADER, APP_SETTINGS_SECTION } from '@texto/app-api';
import { afterEach, describe, expect, it, vi } from 'vitest';

import plugin from './index';
import { createSettingsSection } from './settings';
import { uploadViaPicgo } from './upload';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(impl: () => unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn as unknown as ReturnType<typeof vi.fn>;
}

describe('picgo plugin manifest', () => {
  it('contributes an image uploader and a settings section', () => {
    expect(plugin.id).toBe('picgo');
    expect(plugin.defaultEnabled).toBe(false);
    expect(plugin.settingsApply).toBe('immediate');
    expect(plugin.migration).toEqual({
      enableWhenImageStorageMode: 'picgo',
      appConfigKeys: { server_url: 'picgo_server_url' },
    });
    expect(plugin.contributes?.[APP_IMAGE_UPLOADER]?.[0]?.id).toBe('picgo.uploader');
    expect(plugin.contributes?.[APP_SETTINGS_SECTION]?.[0]?.id).toBe('picgo.settings');
  });

  it('uses the configured server url', async () => {
    const fetchMock = stubFetch(async () => ({
      ok: true,
      json: async () => ({ success: true, result: ['https://cdn.example/x.png'] }),
    }));
    const host = { config: { get: async () => 'http://host:1234' } } as never;
    const uploader = plugin.contributes?.[APP_IMAGE_UPLOADER]?.[0];
    await expect(uploader!.upload(host, '/tmp/x.png')).resolves.toBe('https://cdn.example/x.png');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://host:1234/upload',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ list: ['/tmp/x.png'] }) }),
    );
  });
});

describe('picgo test-connection action', () => {
  const action = () => {
    const section = createSettingsSection();
    const field = section.fields.find((f) => f.type === 'action');
    if (!field || field.type !== 'action' || !field.run) {
      throw new Error('expected an inline action field');
    }
    return field.run;
  };

  it('is silent when the user cancels the file picker', async () => {
    const host = { dialogs: { pickFile: async () => null }, log: { error: vi.fn() } } as never;
    await expect(action()(host, {})).resolves.toEqual({ ok: false });
  });

  it('returns the uploaded url on success', async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ success: true, result: ['https://cdn.example/y.png'] }),
    }));
    const host = {
      dialogs: { pickFile: async () => '/tmp/y.png' },
      log: { error: vi.fn() },
    } as never;
    await expect(action()(host, { server_url: 'http://host:1' })).resolves.toEqual({
      ok: true,
      messageKey: 'picgo.testSuccess',
      detail: 'https://cdn.example/y.png',
    });
  });

  it('reports failure with a diagnostic detail', async () => {
    stubFetch(async () => ({ ok: false, status: 502 }));
    const host = {
      dialogs: { pickFile: async () => '/tmp/y.png' },
      log: { error: vi.fn() },
    } as never;
    const res = await action()(host, {});
    expect(res.ok).toBe(false);
    expect(res.messageKey).toBe('picgo.testFailed');
    expect(res.detail).toContain('502');
  });
});

describe('uploadViaPicgo', () => {
  it('throws on a non-ok response', async () => {
    stubFetch(async () => ({ ok: false, status: 500 }));
    await expect(uploadViaPicgo('/tmp/x.png', 'http://h')).rejects.toThrow('500');
  });

  it('throws when the server reports failure', async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ success: false, result: [], message: 'nope' }),
    }));
    await expect(uploadViaPicgo('/tmp/x.png', 'http://h')).rejects.toThrow('nope');
  });

  it('throws when no result is returned', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ success: true, result: [] }) }));
    await expect(uploadViaPicgo('/tmp/x.png', 'http://h')).rejects.toThrow('no result');
  });
});
