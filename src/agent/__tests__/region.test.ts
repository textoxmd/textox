import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => ({ country: 'USA', source: 'store' })),
}));

import {
  currentRegion,
  isMainlandChina,
  loadStoreRegion,
  parseLocaleRegion,
  resetRegionForTests,
} from '../region';

describe('region', () => {
  beforeEach(() => resetRegionForTests());

  it('treats unknown and CN as mainland', () => {
    expect(isMainlandChina({ country: null, source: 'unknown' })).toBe(true);
    expect(isMainlandChina({ country: 'CN', source: 'locale' })).toBe(true);
    expect(isMainlandChina({ country: 'CHN', source: 'store' })).toBe(true);
  });

  it('treats overseas codes as non-mainland', () => {
    expect(isMainlandChina({ country: 'US', source: 'locale' })).toBe(false);
    expect(isMainlandChina({ country: 'USA', source: 'store' })).toBe(false);
  });

  it('parses locale region segment', () => {
    expect(parseLocaleRegion('en-US')).toBe('US');
    expect(parseLocaleRegion('zh-Hans-CN')).toBe('CN');
    expect(parseLocaleRegion('en')).toBeNull();
  });

  it('loads from the tauri command', async () => {
    const region = await loadStoreRegion();
    expect(region.country).toBe('USA');
    expect(currentRegion().country).toBe('USA');
  });

  it('falls back to navigator.language when the command fails', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockRejectedValueOnce(new Error('not tauri'));
    Object.defineProperty(navigator, 'language', { value: 'en-GB', configurable: true });
    resetRegionForTests();
    const region = await loadStoreRegion();
    expect(region).toEqual({ country: 'GB', source: 'locale' });
  });

  it('resets module state', () => {
    resetRegionForTests({ country: 'US', source: 'locale' });
    expect(currentRegion().country).toBe('US');
    resetRegionForTests();
    expect(currentRegion()).toEqual({ country: null, source: 'unknown' });
  });
});
