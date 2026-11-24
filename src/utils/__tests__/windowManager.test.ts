import { describe, expect, it, vi } from 'vitest';
import { showWindowIfHidden } from '../windowManager';

/** 构造最小窗口替身：只暴露 showWindowIfHidden 依赖的两个方法。 */
function fakeWindow(visible: boolean) {
  return {
    isVisible: vi.fn(async () => visible),
    show: vi.fn(async () => {}),
  };
}

describe('showWindowIfHidden', () => {
  it('窗口不可见时调用 show() 并返回 true', async () => {
    const win = fakeWindow(false);
    await expect(showWindowIfHidden(win)).resolves.toBe(true);
    expect(win.isVisible).toHaveBeenCalledTimes(1);
    expect(win.show).toHaveBeenCalledTimes(1);
  });

  it('窗口已可见时不调用 show() 并返回 false（页面重载不抢焦点/置顶）', async () => {
    const win = fakeWindow(true);
    await expect(showWindowIfHidden(win)).resolves.toBe(false);
    expect(win.isVisible).toHaveBeenCalledTimes(1);
    expect(win.show).not.toHaveBeenCalled();
  });
});
