import { describe, expect, it } from 'vitest';

import { loadPluginClass } from '../loader';

const isPluginClass = (value: unknown): boolean => typeof value === 'function';

describe('loadPluginClass', () => {
  it('returns the default exported class', async () => {
    class Demo {}

    const result = await loadPluginClass<typeof Demo>({
      importModule: async () => ({ default: Demo }),
      isPluginClass,
    });

    expect(result).toEqual({ ok: true, value: Demo });
  });

  it('reports an invalid default export', async () => {
    const result = await loadPluginClass({
      importModule: async () => ({ default: 42 }),
      isPluginClass,
    });

    expect(result).toEqual({
      ok: false,
      failure: 'invalid-export',
      message: 'default export is not a plugin class',
    });
  });

  it('reports import failures with the error message', async () => {
    const result = await loadPluginClass({
      importModule: async () => {
        throw new Error('boom');
      },
      isPluginClass,
    });

    expect(result).toEqual({ ok: false, failure: 'import-failed', message: 'boom' });
  });
});
