import { describe, expect, it, vi } from 'vitest';

import type { InstalledPluginDto } from '../ipc';
import { PluginStateStore } from '../state';

function dto(id: string): InstalledPluginDto {
  return { id, dir: `/plugins/${id}`, manifest: null, enabled: false, error: null };
}

describe('PluginStateStore', () => {
  it('maps the enabled set to statuses', () => {
    const store = new PluginStateStore();

    store.setSnapshot([dto('app.textox.a'), dto('app.textox.b')], {
      safe_mode: false,
      enabled: ['app.textox.b'],
    });

    expect(store.list().map((entry) => [entry.id, entry.status])).toEqual([
      ['app.textox.a', 'installed'],
      ['app.textox.b', 'enabled'],
    ]);
  });

  it('reflects safe mode', () => {
    const store = new PluginStateStore();
    expect(store.isSafeMode()).toBe(true);

    store.setSnapshot([], { safe_mode: false, enabled: [] });

    expect(store.isSafeMode()).toBe(false);
  });

  it('syncs the persisted enabled flag into the snapshot', () => {
    const store = new PluginStateStore();
    const listener = vi.fn();
    store.setSnapshot([dto('app.textox.a')], { safe_mode: false, enabled: [] });
    store.subscribe(listener);

    store.markEnabled('app.textox.a', true);

    expect(store.list()[0].enabled).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the failure status when syncing the enabled flag', () => {
    const store = new PluginStateStore();
    store.setSnapshot([dto('app.textox.a')], { safe_mode: false, enabled: [] });
    store.markFailed('app.textox.a', 'boom');

    store.markEnabled('app.textox.a', false);

    const entry = store.list()[0];
    expect(entry.status).toBe('load-failed');
    expect(entry.errorMessage).toBe('boom');
    expect(entry.enabled).toBe(false);
  });

  it('does not notify when marking an unknown id as enabled', () => {
    const store = new PluginStateStore();
    const listener = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      store.setSnapshot([dto('app.textox.a')], { safe_mode: false, enabled: [] });
      store.subscribe(listener);

      store.markEnabled('app.textox.missing', true);

      expect(listener).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[plugin] state: unknown plugin id app.textox.missing',
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('reports whether the first snapshot has arrived', () => {
    const store = new PluginStateStore();
    expect(store.isInitialized()).toBe(false);

    store.setSnapshot([], { safe_mode: true, enabled: [] });

    expect(store.isInitialized()).toBe(true);
  });

  it('marks failures and clears the message on the next status change', () => {
    const store = new PluginStateStore();
    store.setSnapshot([dto('app.textox.a')], { safe_mode: true, enabled: [] });

    store.markFailed('app.textox.a', 'import-failed');
    expect(store.list()[0]).toMatchObject({
      status: 'load-failed',
      errorMessage: 'import-failed',
    });

    store.markStatus('app.textox.a', 'enabled');
    expect(store.list()[0].status).toBe('enabled');
    expect(store.list()[0].errorMessage).toBeUndefined();
  });

  it('replaces the entry immutably on status changes', () => {
    const store = new PluginStateStore();
    store.setSnapshot([dto('app.textox.a')], { safe_mode: true, enabled: [] });

    const before = store.list();
    store.markFailed('app.textox.a', 'boom');
    const afterFirst = store.list();
    store.markFailed('app.textox.a', 'boom-again');
    const afterSecond = store.list();

    expect(afterFirst).not.toBe(before);
    expect(afterSecond).not.toBe(afterFirst);
    expect(afterSecond[0]).not.toBe(afterFirst[0]);
    expect(afterSecond[0].errorMessage).toBe('boom-again');
    expect(before[0].errorMessage).toBeUndefined();
  });

  it('warns and skips notification for an unknown plugin id', () => {
    const store = new PluginStateStore();
    const listener = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      store.setSnapshot([dto('app.textox.a')], { safe_mode: true, enabled: [] });
      const before = store.list();
      store.subscribe(listener);

      store.markFailed('app.textox.missing', 'boom');

      expect(warnSpy).toHaveBeenCalledWith(
        '[plugin] state: unknown plugin id app.textox.missing',
      );
      expect(listener).not.toHaveBeenCalled();
      expect(store.list()).toBe(before);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('notifies listeners, stops after unsubscribe and isolates throwing listeners', () => {
    const store = new PluginStateStore();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const healthy = vi.fn();
    try {
      store.subscribe(() => {
        throw new Error('boom');
      });
      const unsubscribe = store.subscribe(healthy);

      store.setSnapshot([], { safe_mode: true, enabled: [] });
      expect(healthy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalled();

      unsubscribe();
      store.setSnapshot([], { safe_mode: false, enabled: [] });
      expect(healthy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
