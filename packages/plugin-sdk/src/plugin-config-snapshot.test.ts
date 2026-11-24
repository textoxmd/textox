import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getPluginConfigSnapshot,
  resetPluginConfigSnapshotsForTests,
  setPluginConfigSnapshot,
  subscribePluginConfig,
} from './plugin-config-snapshot';

beforeEach(() => resetPluginConfigSnapshotsForTests());

describe('plugin config snapshot', () => {
  it('returns empty object for unknown plugin', () => {
    expect(getPluginConfigSnapshot('nope')).toEqual({});
  });

  it('stores and reads a config', () => {
    setPluginConfigSnapshot('p', { count: 5 });
    expect(getPluginConfigSnapshot('p')).toEqual({ count: 5 });
  });

  it('does not leak mutable references', () => {
    const original = { count: 5 };
    setPluginConfigSnapshot('p', original);
    original.count = 99;
    expect(getPluginConfigSnapshot('p')).toEqual({ count: 5 });

    const read = getPluginConfigSnapshot('p');
    read.count = 0;
    expect(getPluginConfigSnapshot('p')).toEqual({ count: 5 });
  });

  it('notifies subscribers with a copy on every write for the same plugin only', () => {
    const listener = vi.fn();
    subscribePluginConfig('p', listener);
    const other = vi.fn();
    subscribePluginConfig('q', other);

    setPluginConfigSnapshot('p', { count: 5 });
    expect(listener).toHaveBeenCalledWith({ count: 5 });
    expect(other).not.toHaveBeenCalled();

    const received = listener.mock.calls[0]![0] as Record<string, unknown>;
    received.count = 99;
    expect(getPluginConfigSnapshot('p')).toEqual({ count: 5 });
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const off = subscribePluginConfig('p', listener);
    setPluginConfigSnapshot('p', { count: 1 });
    off();
    setPluginConfigSnapshot('p', { count: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clears subscriptions on reset', () => {
    const listener = vi.fn();
    subscribePluginConfig('p', listener);
    resetPluginConfigSnapshotsForTests();
    setPluginConfigSnapshot('p', { count: 1 });
    expect(listener).not.toHaveBeenCalled();
  });
});
