import { describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n', () => ({ default: { t: (k: string) => k, language: 'en' } }));

import { initializePluginRuntimes } from '../runtime';
import type { TextoPlugin } from '../types';

describe('initializePluginRuntimes', () => {
  it('calls activate for each plugin with one', async () => {
    const a = vi.fn(async () => {});
    const b = vi.fn(async () => {});
    const plugins = [
      { id: 'a', version: '1.0.0', activate: a },
      { id: 'b', version: '1.0.0' },
      { id: 'c', version: '1.0.0', activate: b },
    ] as unknown as TextoPlugin[];

    await initializePluginRuntimes(plugins);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing activate', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = vi.fn(async () => {});
    const plugins = [
      {
        id: 'bad',
        version: '1.0.0',
        activate: async () => {
          throw new Error('boom');
        },
      },
      { id: 'ok', version: '1.0.0', activate: ok },
    ] as unknown as TextoPlugin[];

    await expect(initializePluginRuntimes(plugins)).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
