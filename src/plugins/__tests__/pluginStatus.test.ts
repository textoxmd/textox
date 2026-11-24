import { afterEach, describe, expect, it, vi } from 'vitest';

import { isPluginEnabled, setPluginEnabledState } from '../pluginStatus';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('isPluginEnabled', () => {
  it('defaults to true when unset and defaultEnabled omitted', () => {
    expect(isPluginEnabled('x')).toBe(true);
  });

  it('defaults to the provided defaultEnabled when unset', () => {
    expect(isPluginEnabled('x', false)).toBe(false);
  });

  it('reads the stored value', () => {
    setPluginEnabledState('x', false);
    expect(isPluginEnabled('x')).toBe(false);
    setPluginEnabledState('x', true);
    expect(isPluginEnabled('x')).toBe(true);
  });

  it('falls back to defaultEnabled when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(isPluginEnabled('x', false)).toBe(false);
  });
});

describe('setPluginEnabledState', () => {
  it('does not throw when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => setPluginEnabledState('x', true)).not.toThrow();
  });
});
