import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { useSidebar } from '../useSidebar';

// happy-dom 没有真实过渡：这里断言的是「切换期间临时压制 transition」的 DOM 契约，
// 真实视觉效果靠真机冒烟。
//
// 注意：伪装成 Sidebar 的 div 由 React 托管 className（状态变化时会整体重写），
// 压制标记必须用 React 不托管的 data 属性，否则会被覆盖、动画重新出现。

let frames: Array<{ id: number; cb: FrameRequestCallback }> = [];
let nextFrameId = 1;

function pushFrame() {
  const queue = frames;
  frames = [];
  act(() => {
    queue.forEach((f) => f.cb(0));
  });
}

let latest: ReturnType<typeof useSidebar> | null = null;

function Harness() {
  const sidebar = useSidebar();
  latest = sidebar;
  return createElement('div', {
    id: 'sidebar',
    className: `sidebar-area ${sidebar.collapsed ? 'collapsed' : ''}`,
  });
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function sidebarEl() {
  return document.getElementById('sidebar') as HTMLDivElement;
}

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(Harness));
  });
}

beforeAll(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  localStorage.clear();
  frames = [];
  nextFrameId = 1;
  latest = null;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.push({ id, cb });
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  mount();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

describe('useSidebar.setCollapsed', () => {
  it('animate: false 时压制过渡，React 重写 className 后标记仍在，下一帧恢复', () => {
    act(() => {
      latest!.setCollapsed(true, { animate: false });
    });

    expect(latest!.collapsed).toBe(true);
    // React 已把 className 整体重写为折叠态，但 data 属性不受影响
    expect(sidebarEl().className).toContain('collapsed');
    expect(sidebarEl().hasAttribute('data-suppress-transition')).toBe(true);
    expect(localStorage.getItem('texto:sidebar-collapsed')).toBe('true');

    pushFrame();
    expect(sidebarEl().hasAttribute('data-suppress-transition')).toBe(true);

    pushFrame();
    expect(sidebarEl().hasAttribute('data-suppress-transition')).toBe(false);
  });

  it('默认保留过渡动画', () => {
    act(() => {
      latest!.setCollapsed(true);
    });

    expect(latest!.collapsed).toBe(true);
    expect(sidebarEl().hasAttribute('data-suppress-transition')).toBe(false);
    expect(localStorage.getItem('texto:sidebar-collapsed')).toBe('true');
  });
});
