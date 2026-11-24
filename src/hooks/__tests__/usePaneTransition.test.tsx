import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  PANE_SETTLE_MS,
  PANE_TRANSITION_MS,
  usePaneTransition,
  type EditorPaneMode,
  type PanePhase,
} from '@/components/TextoEditor/src/panes/usePaneTransition';

// 转场状态机：DOM 换位只发生在 run 相位，warm 相位只让两层参与布局。
// happy-dom 没有真实布局与合成，这里断言的是相位与 DOM 契约（真实动画靠真机冒烟）。

// 可控的 requestAnimationFrame：测试里手动"推一帧"。
// 必须真实处理 cancelAnimationFrame —— 状态机会在 warm 期间"反悔"时取消待执行的
// rAF，桩成空操作就没法验证"取消生效、画面不会被晚一帧推到另一侧"。
let frames: Array<{ id: number; cb: FrameRequestCallback }> = [];
let nextFrameId = 1;
let canceledFrames = new Set<number>();
function pushFrame() {
  const queue = frames.filter((f) => !canceledFrames.has(f.id));
  frames = [];
  act(() => {
    queue.forEach((f) => f.cb(0));
  });
}

// happy-dom 的 matchMedia 由用例按需覆盖
function setReducedMotion(matches: boolean) {
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

let latest: { visualMode: EditorPaneMode; phase: PanePhase } | null = null;
let setMode: ((mode: EditorPaneMode) => void) | null = null;
let canAnimateFlag = true;
let containerEl: HTMLDivElement | null = null;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function Harness({ mode }: { mode: EditorPaneMode }) {
  const result = usePaneTransition(mode, {
    canAnimate: () => canAnimateFlag,
    containerRef: { current: containerEl },
  });
  latest = result;
  return createElement(
    'div',
    { 'data-pane-transition': result.phase === 'idle' ? undefined : result.phase },
    createElement('div', {
      className: 'editor-pane',
      'data-pane': 'ir',
      'data-active': String(result.visualMode === 'ir'),
    }),
    createElement('div', {
      className: 'editor-pane',
      'data-pane': 'sv',
      'data-active': String(result.visualMode === 'sv'),
    }),
  );
}

function ModeRoot({ initial }: { initial: EditorPaneMode }) {
  const [mode, set] = useState<EditorPaneMode>(initial);
  setMode = set;
  return createElement(Harness, { mode });
}

function mount(initial: EditorPaneMode = 'ir') {
  host = document.createElement('div');
  containerEl = document.createElement('div');
  host.appendChild(containerEl);
  document.body.appendChild(host);
  root = createRoot(containerEl);
  act(() => {
    root!.render(createElement(ModeRoot, { initial }));
  });
}

function paneEl(side: EditorPaneMode) {
  return containerEl!.querySelector(`.editor-pane[data-pane="${side}"]`);
}

function transitionAttr() {
  return containerEl!.querySelector('[data-pane-transition]')?.getAttribute('data-pane-transition') ?? null;
}

function switchTo(mode: EditorPaneMode) {
  act(() => {
    setMode!(mode);
  });
}

beforeAll(() => {
  // 根配置没有打开 React 的 act 环境（既有编辑器测试同样手动设置）：
  // 不设它 act() 不保证同步刷新，用例会变成偶发失败
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  frames = [];
  nextFrameId = 1;
  canceledFrames = new Set<number>();
  latest = null;
  setMode = null;
  canAnimateFlag = true;
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.push({ id, cb });
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    canceledFrames.add(id);
  });
  setReducedMotion(false);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  host?.remove();
  host = null;
  containerEl = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('usePaneTransition', () => {
  it('初始处于 idle，非活动 pane 的 data-active 为 false', () => {
    mount('ir');
    expect(latest).toEqual({ visualMode: 'ir', phase: 'idle' });
    expect(transitionAttr()).toBeNull();
    expect(paneEl('ir')!.getAttribute('data-active')).toBe('true');
    expect(paneEl('sv')!.getAttribute('data-active')).toBe('false');
  });

  it('切换时先进入 warm：两层就位但尚未换位', () => {
    mount('ir');
    switchTo('sv');
    expect(latest!.phase).toBe('warm');
    expect(latest!.visualMode).toBe('ir');
    expect(transitionAttr()).toBe('warm');
    expect(paneEl('ir')!.getAttribute('data-active')).toBe('true');
    expect(paneEl('sv')!.getAttribute('data-active')).toBe('false');
  });

  it('推一帧后进入 run 并换位，随后收敛回 idle', () => {
    mount('ir');
    switchTo('sv');
    pushFrame();
    expect(latest).toEqual({ visualMode: 'sv', phase: 'run' });
    expect(transitionAttr()).toBe('run');
    expect(paneEl('ir')!.getAttribute('data-active')).toBe('false');
    expect(paneEl('sv')!.getAttribute('data-active')).toBe('true');

    act(() => {
      vi.advanceTimersByTime(PANE_TRANSITION_MS + PANE_SETTLE_MS);
    });
    expect(latest!.phase).toBe('idle');
    expect(transitionAttr()).toBeNull();
  });

  it('warm 期间反悔回到原模式：撤销换位并回到 idle', () => {
    mount('ir');
    switchTo('sv');
    expect(latest!.phase).toBe('warm');
    switchTo('ir');
    expect(latest).toEqual({ visualMode: 'ir', phase: 'idle' });
    // 之前排队的 rAF 必须被丢弃，否则会晚一帧把画面推到 sv
    pushFrame();
    expect(latest).toEqual({ visualMode: 'ir', phase: 'idle' });
  });

  it('run 期间反向：不回 warm，直接翻目标并重置收敛计时器', () => {
    mount('ir');
    switchTo('sv');
    pushFrame();
    expect(latest!.phase).toBe('run');

    // 走过一半时长后反向
    act(() => {
      vi.advanceTimersByTime(Math.floor(PANE_TRANSITION_MS / 2));
    });
    switchTo('ir');
    expect(latest).toEqual({ visualMode: 'ir', phase: 'run' });
    expect(transitionAttr()).toBe('run');

    // 计时器已重置：再走不到一个完整周期不应收敛
    act(() => {
      vi.advanceTimersByTime(Math.floor(PANE_TRANSITION_MS / 2));
    });
    expect(latest!.phase).toBe('run');

    act(() => {
      vi.advanceTimersByTime(PANE_TRANSITION_MS + PANE_SETTLE_MS);
    });
    expect(latest!.phase).toBe('idle');
  });

  it('reduced-motion 下直接到终态，从不进入 warm / run', () => {
    setReducedMotion(true);
    mount('ir');
    switchTo('sv');
    expect(latest).toEqual({ visualMode: 'sv', phase: 'idle' });
    expect(transitionAttr()).toBeNull();
  });

  it('canAnimate 返回 false 时直接到终态', () => {
    canAnimateFlag = false;
    mount('ir');
    switchTo('sv');
    expect(latest).toEqual({ visualMode: 'sv', phase: 'idle' });
    expect(transitionAttr()).toBeNull();
  });
});
