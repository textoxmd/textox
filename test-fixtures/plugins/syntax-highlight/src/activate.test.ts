import { describe, expect, it, vi } from 'vitest';

import { activate } from './activate';
import { CONFIG_DARK, CONFIG_LIGHT, DEFAULT_DARK, DEFAULT_LIGHT } from './settings';

function makeHost(config: Record<string, unknown>) {
  const apply = vi.fn();
  const subscribe = vi.fn((_cb: () => void) => () => {});
  const configSubscribe = vi.fn((_cb: (config: Record<string, unknown>) => void) => () => {});
  const set = vi.fn(async (key: string, value: unknown) => {
    config[key] = value;
  });
  return {
    host: {
      config: { get: async (key: string) => config[key], set, getAll: async () => config, subscribe: configSubscribe },
      theme: {
        applyCodeHighlightTheme: apply,
        subscribe,
        codeHighlightThemeDefaults: vi.fn(async () => ({ light: undefined, dark: undefined })),
      },
    } as never,
    apply,
    subscribe,
    configSubscribe,
    set,
  };
}

describe('syntax-highlight activate', () => {
  it('applies stored values and subscribes', async () => {
    const { host, apply, subscribe } = makeHost({ [CONFIG_LIGHT]: 'eclipse', [CONFIG_DARK]: 'dracula' });
    await activate(host);
    expect(apply).toHaveBeenCalledWith('eclipse', 'dracula');
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('falls back to defaults when config is empty', async () => {
    const { host, apply } = makeHost({});
    await activate(host);
    expect(apply).toHaveBeenCalledWith(DEFAULT_LIGHT, DEFAULT_DARK);
  });

  it('re-applies the same themes when appearance changes', async () => {
    const { host, apply, subscribe } = makeHost({
      [CONFIG_LIGHT]: 'eclipse',
      [CONFIG_DARK]: 'dracula',
    });
    await activate(host);
    subscribe.mock.calls[0]![0]();
    expect(apply).toHaveBeenLastCalledWith('eclipse', 'dracula');
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('re-applies themes when config changes live', async () => {
    const { host, apply, configSubscribe } = makeHost({
      [CONFIG_LIGHT]: 'eclipse',
      [CONFIG_DARK]: 'dracula',
    });
    await activate(host);
    apply.mockClear();
    configSubscribe.mock.calls[0]![0]({ [CONFIG_LIGHT]: 'githubLight', [CONFIG_DARK]: 'vscodeDark' });
    expect(apply).toHaveBeenCalledWith('githubLight', 'vscodeDark');
  });

  it('falls back to defaults for invalid live config values', async () => {
    const { host, apply, configSubscribe } = makeHost({});
    await activate(host);
    apply.mockClear();
    configSubscribe.mock.calls[0]![0]({ [CONFIG_LIGHT]: 'nope', [CONFIG_DARK]: '' });
    expect(apply).toHaveBeenCalledWith(DEFAULT_LIGHT, DEFAULT_DARK);
  });

  it('does not write config when there are no legacy values', async () => {
    const { host, set } = makeHost({});
    await activate(host);
    expect(set).not.toHaveBeenCalled();
  });

  it('migrates legacy theme values into config when unset', async () => {
    const config: Record<string, unknown> = {};
    const { host, apply, set } = makeHost(config);
    (host as { theme: { codeHighlightThemeDefaults: () => Promise<unknown> } }).theme.codeHighlightThemeDefaults = vi.fn(
      async () => ({ light: 'bbedit', dark: 'sublime' }),
    );
    await activate(host);
    expect(set).toHaveBeenCalledWith(CONFIG_LIGHT, 'bbedit');
    expect(set).toHaveBeenCalledWith(CONFIG_DARK, 'sublime');
    expect(apply).toHaveBeenCalledWith('bbedit', 'sublime');
  });

  it('falls back to defaults when config values are empty strings', async () => {
    const { host, apply, set } = makeHost({ [CONFIG_LIGHT]: '', [CONFIG_DARK]: '' });
    await activate(host);
    expect(apply).toHaveBeenCalledWith(DEFAULT_LIGHT, DEFAULT_DARK);
    expect(set).not.toHaveBeenCalled();
  });

  it('ignores legacy values outside the highlight theme catalog', async () => {
    const { host, apply, set } = makeHost({});
    (host as { theme: { codeHighlightThemeDefaults: () => Promise<unknown> } }).theme.codeHighlightThemeDefaults = vi.fn(
      async () => ({ light: 'nope', dark: 'nope' }),
    );
    await activate(host);
    expect(apply).toHaveBeenCalledWith(DEFAULT_LIGHT, DEFAULT_DARK);
    expect(set).not.toHaveBeenCalled();
  });
});
