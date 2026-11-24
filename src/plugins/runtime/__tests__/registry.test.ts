import { describe, expect, it, vi } from 'vitest';
import { PluginRegistry } from '../registry';

describe('PluginRegistry', () => {
  it('returns contributions of a kind', () => {
    const registry = new PluginRegistry();
    registry.register('a', 'command', 'a.one', { id: 'a.one' });
    registry.register('b', 'command', 'b.two', { id: 'b.two' });
    expect(registry.get<{ id: string }>('command').map((c) => c.id)).toEqual(['a.one', 'b.two']);
  });

  it('disposes every contribution of one owner', () => {
    const registry = new PluginRegistry();
    registry.register('a', 'command', 'a.one', { id: 'a.one' });
    registry.register('b', 'command', 'b.two', { id: 'b.two' });
    registry.disposeOwner('a');
    expect(registry.get<{ id: string }>('command').map((c) => c.id)).toEqual(['b.two']);
  });

  it('last registration wins for same id', () => {
    const registry = new PluginRegistry();
    registry.register('a', 'command', 'same', { id: 'same', from: 'a' });
    registry.register('b', 'command', 'same', { id: 'same', from: 'b' });
    expect(registry.get<{ from: string }>('command')).toEqual([{ id: 'same', from: 'b' }]);
  });

  it('notifies listeners and stops after dispose', () => {
    const registry = new PluginRegistry();
    const listener = vi.fn();
    const sub = registry.onDidChange(listener);
    registry.register('a', 'command', 'a.one', { id: 'a.one' });
    expect(listener).toHaveBeenCalledTimes(1);
    sub.dispose();
    registry.register('a', 'command', 'a.two', { id: 'a.two' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('invalidates the snapshot cache when contributions change', () => {
    const registry = new PluginRegistry();
    registry.register('a', 'command', 'a.one', { id: 'a.one' });

    const snapshot = registry.get<{ id: string }>('command');
    expect(registry.get<{ id: string }>('command')).toBe(snapshot); // 未变更时复用同一引用
    expect(snapshot).toHaveLength(1);

    registry.register('a', 'command', 'a.two', { id: 'a.two' });

    const afterRegister = registry.get<{ id: string }>('command');
    expect(afterRegister).not.toBe(snapshot);
    expect(afterRegister.map((c) => c.id)).toEqual(['a.one', 'a.two']);

    registry.disposeOwner('a');
    expect(registry.get<{ id: string }>('command')).not.toBe(afterRegister);
    expect(registry.get<{ id: string }>('command')).toEqual([]);

    const solo = registry.register('b', 'command', 'b.only', { id: 'b.only' });
    const beforeRemove = registry.get<{ id: string }>('command');
    expect(beforeRemove.map((c) => c.id)).toEqual(['b.only']);

    solo.dispose();

    const afterRemove = registry.get<{ id: string }>('command');
    expect(afterRemove).not.toBe(beforeRemove);
    expect(afterRemove).toEqual([]);
  });

  it('does not remove an overridden entry when the earlier owner disposes', () => {
    const registry = new PluginRegistry();
    const disposable = registry.register('a', 'command', 'same', { id: 'same', from: 'a' });
    registry.register('b', 'command', 'same', { id: 'same', from: 'b' });
    disposable.dispose();
    expect(registry.get<{ from: string }>('command')).toEqual([{ id: 'same', from: 'b' }]);
  });

  it('counts live contributions and survives disposing an unknown owner', () => {
    const registry = new PluginRegistry();
    const listener = vi.fn();
    registry.onDidChange(listener);
    registry.register('a', 'command', 'a.one', { id: 'a.one' });
    expect(registry.count('command')).toBe(1);
    registry.disposeOwner('ghost');
    expect(registry.count('command')).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing listener', () => {
    const registry = new PluginRegistry();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const healthy = vi.fn();
    registry.onDidChange(() => {
      throw new Error('boom');
    });
    registry.onDidChange(healthy);
    try {
      expect(() => registry.register('a', 'command', 'a.one', { id: 'a.one' })).not.toThrow();
      expect(healthy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
