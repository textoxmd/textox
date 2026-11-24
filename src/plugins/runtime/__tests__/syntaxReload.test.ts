import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerSyntaxReloader, requestSyntaxReload } from '@/editor/syntaxReload';

afterEach(() => {
  // 模块级单例：每个用例结束都清掉，避免跨用例串台
  const off = registerSyntaxReloader(() => false);
  off();
});

describe('registerSyntaxReloader', () => {
  it('clears the current reloader only when it is still the registered one', () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);

    const unregisterFirst = registerSyntaxReloader(first);
    registerSyntaxReloader(second);

    // 旧的释放句柄不能把新登记项清掉
    unregisterFirst();
    requestSyntaxReload();

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('clears the current reloader when it is the registered one', () => {
    const reloader = vi.fn(() => true);
    const unregister = registerSyntaxReloader(reloader);

    unregister();
    requestSyntaxReload();

    expect(reloader).not.toHaveBeenCalled();
  });

  it('is a no-op before any reloader is registered', () => {
    expect(() => requestSyntaxReload()).not.toThrow();
  });

  it('swallows errors from the reloader', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unregister = registerSyntaxReloader(() => {
      throw new Error('boom');
    });

    try {
      expect(() => requestSyntaxReload()).not.toThrow();
      expect(error).toHaveBeenCalled();
    } finally {
      unregister();
      error.mockRestore();
    }
  });
});
