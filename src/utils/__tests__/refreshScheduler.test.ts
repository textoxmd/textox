import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRefreshScheduler } from '@/utils/refreshScheduler';

describe('createRefreshScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('把同一批事件合并成一次执行', () => {
    const run = vi.fn();
    const scheduler = createRefreshScheduler(run);

    scheduler.schedule();
    vi.advanceTimersByTime(30);
    scheduler.schedule();
    vi.advanceTimersByTime(30);
    scheduler.schedule();

    // 还没到合并窗口，不应执行
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(120);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('按最后一次请求计时（尾随合并）', () => {
    const run = vi.fn();
    const scheduler = createRefreshScheduler(run, { delay: 100, maxDelay: 500 });

    scheduler.schedule();
    vi.advanceTimersByTime(90);
    scheduler.schedule(); // 距上一次 90ms，应重新计时
    vi.advanceTimersByTime(90);

    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('事件持续不断时最多等 maxDelay', () => {
    const run = vi.fn();
    const scheduler = createRefreshScheduler(run, { delay: 100, maxDelay: 300 });

    // 每 50ms 来一个事件，持续 600ms：不设上限的话永远不会执行
    for (let i = 0; i < 12; i += 1) {
      scheduler.schedule();
      vi.advanceTimersByTime(50);
    }

    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('cancel 之后不再执行', () => {
    const run = vi.fn();
    const scheduler = createRefreshScheduler(run);

    scheduler.schedule();
    scheduler.cancel();
    vi.advanceTimersByTime(1000);

    expect(run).not.toHaveBeenCalled();
  });

  it('执行后可以再次调度', () => {
    const run = vi.fn();
    const scheduler = createRefreshScheduler(run);

    scheduler.schedule();
    vi.advanceTimersByTime(200);
    scheduler.schedule();
    vi.advanceTimersByTime(200);

    expect(run).toHaveBeenCalledTimes(2);
  });
});
