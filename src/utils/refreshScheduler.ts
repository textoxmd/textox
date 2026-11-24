/**
 * 刷新合并器：把短时间内涌来的多次刷新请求合并成一次执行。
 *
 * 文件监听在 macOS 上会为一次操作连发多个事件（写入 + 元数据、批量改标签、
 * iCloud 同步回写），每个事件都重读目录树代价不小，所以按"尾随合并"处理：
 * 最后一次请求后 `delay` 毫秒执行；如果事件一直不断，最迟在第一个待处理请求
 * 之后 `maxDelay` 毫秒也会执行一次，避免被无限推迟。
 */
export interface RefreshSchedulerOptions {
  /** 最后一次请求后等多久执行（默认 120ms） */
  delay?: number;
  /** 事件持续不断时，从第一个待处理请求算起最多等多久（默认 500ms） */
  maxDelay?: number;
}

export interface RefreshScheduler {
  schedule: () => void;
  cancel: () => void;
}

export function createRefreshScheduler(
  run: () => void,
  options: RefreshSchedulerOptions = {},
): RefreshScheduler {
  const delay = options.delay ?? 120;
  const maxDelay = options.maxDelay ?? 500;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstRequestAt = 0;

  const schedule = () => {
    const now = Date.now();
    if (timer === null) firstRequestAt = now;
    const elapsed = now - firstRequestAt;
    const wait = Math.max(0, Math.min(delay, maxDelay - elapsed));
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      run();
    }, wait);
  };

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return { schedule, cancel };
}
