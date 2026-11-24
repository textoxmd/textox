import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { useMeasuredWidth } from '../useMeasuredWidth';

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MEASURED = 120;

/**
 * happy-dom 无布局引擎，`scrollWidth` 恒为 0。这里按「测量元素（带 data-measure）」
 * 稳定返回 MEASURED，以隔离被测的「何时附加 / 重新附加测量」逻辑。
 */
function stubScrollWidth(): () => void {
  const proto = HTMLElement.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, 'scrollWidth');
  Object.defineProperty(proto, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.measure !== undefined ? MEASURED : 0;
    },
  });
  return () => {
    if (original) Object.defineProperty(proto, 'scrollWidth', original);
    else delete (proto as { scrollWidth?: unknown }).scrollWidth;
  };
}

/** 复刻真实用法：测量元素随 `enabled` 条件挂载（工具栏 `contextVisible`）。 */
function Probe({ enabled }: { enabled: boolean }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(ref, enabled);
  return createElement(
    'div',
    null,
    enabled
      ? createElement('div', { key: 'measure', ref, 'data-measure': '', 'data-testid': 'measure' }, 'label')
      : null,
    createElement('span', { key: 'width', 'data-testid': 'width' }, String(width)),
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let restoreScrollWidth: (() => void) | null = null;

function width(): string | null {
  return container?.querySelector('[data-testid="width"]')?.textContent ?? null;
}

beforeEach(() => {
  restoreScrollWidth = stubScrollWidth();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  restoreScrollWidth?.();
  restoreScrollWidth = null;
});

describe('useMeasuredWidth', () => {
  it('隐藏 → 显示后重新测量，宽度不再停留在 0', () => {
    // 首次挂载：测量元素未渲染（对应工具栏 contextVisible=false）。
    act(() => root!.render(createElement(Probe, { enabled: false })));
    expect(container!.querySelector('[data-testid="measure"]')).toBeNull();
    expect(width()).toBe('0');

    // 变为可见：测量元素挂载，必须重新附加测量并应用宽度。
    act(() => root!.render(createElement(Probe, { enabled: true })));
    expect(container!.querySelector('[data-testid="measure"]')).not.toBeNull();
    expect(width()).toBe(String(MEASURED));
  });

  it('始终可见时挂载即测量', () => {
    act(() => root!.render(createElement(Probe, { enabled: true })));
    expect(width()).toBe(String(MEASURED));
  });
});
