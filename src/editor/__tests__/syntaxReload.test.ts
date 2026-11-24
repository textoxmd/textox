import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  flushPendingSyntaxReload,
  hasPendingSyntaxReload,
  registerSyntaxReloader,
  requestSyntaxReload,
} from '@/editor/syntaxReload';

/**
 * 登记表与 pending 都是模块级单例：每个用例开始前先清干净，
 * 否则上一个用例遗留的挂起请求会串台（登记一个立即成功的 reloader 并请求一次，
 * pending 就被这唯一一次真实重建消费掉）。
 */
function reset(): void {
  const off = registerSyntaxReloader(() => true);
  try {
    requestSyntaxReload();
  } finally {
    off();
  }
}

beforeEach(reset);

describe('requestSyntaxReload 的 pending 语义', () => {
  it('无登记项时记为挂起而不抛错', () => {
    expect(() => requestSyntaxReload()).not.toThrow();
    expect(requestSyntaxReload()).toBe(false);
    expect(hasPendingSyntaxReload()).toBe(true);
  });

  it('登记后 flush 补做一次挂起请求，并清空 pending', () => {
    requestSyntaxReload();
    expect(hasPendingSyntaxReload()).toBe(true);

    const reloader = vi.fn(() => true);
    const off = registerSyntaxReloader(reloader);
    try {
      flushPendingSyntaxReload();

      expect(reloader).toHaveBeenCalledTimes(1);
      expect(hasPendingSyntaxReload()).toBe(false);
      // 没有新的挂起请求时，重复 flush 不能重复重建
      flushPendingSyntaxReload();
      expect(reloader).toHaveBeenCalledTimes(1);
    } finally {
      off();
    }
  });

  it('reloader 返回 false（逐字插入中）时保持挂起，条件解除后 flush 清空', () => {
    const reloader = vi.fn(() => false);
    const off = registerSyntaxReloader(reloader);
    try {
      expect(requestSyntaxReload()).toBe(false);
      expect(reloader).toHaveBeenCalledTimes(1);
      expect(hasPendingSyntaxReload()).toBe(true);

      // 逐字插入结束：同一 reloader 这次能重建了
      reloader.mockReturnValue(true);
      flushPendingSyntaxReload();

      expect(reloader).toHaveBeenCalledTimes(2);
      expect(hasPendingSyntaxReload()).toBe(false);
    } finally {
      off();
    }
  });

  it('reloader 抛错时记为挂起、不向上抛并打印错误', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reloader = vi.fn((): boolean => {
      throw new Error('boom');
    });
    const off = registerSyntaxReloader(reloader);
    try {
      expect(() => requestSyntaxReload()).not.toThrow();
      expect(requestSyntaxReload()).toBe(false);
      expect(hasPendingSyntaxReload()).toBe(true);
      expect(error).toHaveBeenCalled();
    } finally {
      off();
      error.mockRestore();
    }
  });

  it('注销之后不再调用旧的 reloader', () => {
    const reloader = vi.fn(() => true);
    const off = registerSyntaxReloader(reloader);
    off();

    expect(requestSyntaxReload()).toBe(false);
    expect(reloader).not.toHaveBeenCalled();
    expect(hasPendingSyntaxReload()).toBe(true);
  });
});
