import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferAfterFirstPaint } from '../deferAfterFirstPaint';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).requestIdleCallback;
  delete (globalThis as Record<string, unknown>).cancelIdleCallback;
});

describe('deferAfterFirstPaint', () => {
  it('有 requestIdleCallback 时交给 idle 调度', () => {
    const idle = vi.fn((cb: () => void) => {
      cb();
      return 7;
    });
    const cancel = vi.fn();
    (globalThis as Record<string, unknown>).requestIdleCallback = idle;
    (globalThis as Record<string, unknown>).cancelIdleCallback = cancel;

    const fn = vi.fn();
    deferAfterFirstPaint(fn);

    expect(idle).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('没有 idle 时退化到 setTimeout', () => {
    const fn = vi.fn();
    deferAfterFirstPaint(fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('取消后回调不再执行', () => {
    const fn = vi.fn();
    const cancel = deferAfterFirstPaint(fn);
    cancel();
    vi.advanceTimersByTime(2000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('idle 分支取消时用同一个 id 调用 cancelIdleCallback', () => {
    const idle = vi.fn(() => 42);
    const cancel = vi.fn();
    (globalThis as Record<string, unknown>).requestIdleCallback = idle;
    (globalThis as Record<string, unknown>).cancelIdleCallback = cancel;

    const dispose = deferAfterFirstPaint(vi.fn());
    dispose();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(42);
  });

  it('fallbackMs 可配置', () => {
    const fn = vi.fn();
    deferAfterFirstPaint(fn, 3000, 100);
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
