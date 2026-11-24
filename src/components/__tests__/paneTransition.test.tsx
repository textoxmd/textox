import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { PANE_SETTLE_MS, PANE_TRANSITION_MS } from '@/components/TextoEditor/src/panes/usePaneTransition';

let svReady = false;

// 组件契约：visualMode（而非 editorMode）同时驱动 pane 的 data-active 与
// 编辑器的 active prop——两者必须在同一帧一起翻转，否则会看到"内容先变、位置后变"。
// 这里挂载真实 TextoEditor（IR 是真实 ProseMirror，happy-dom 下可挂载）；
// 只有懒加载的 SV 被替换，用来观测它收到的 active 与就绪时序。

vi.mock('../TextoEditor/src/source-view/loader', () => ({
  preloadSourceCodeEditor: () => {},
  isSourceCodeEditorReady: () => svReady,
  loadSourceCodeEditor: () =>
    Promise.resolve({
      SourceCodeEditor: (props: Record<string, unknown>) =>
        createElement('div', { 'data-mock': 'sv', 'data-active': String(props.active) }),
    }),
}));

const { TextoEditor, SV_MOUNT_DELAY_MS } = await import('../TextoEditor/TextoEditor');

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

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let setMode: ((mode: 'ir' | 'sv') => void) | null = null;

function Wrapper() {
  const [mode, set] = useState<'ir' | 'sv'>('ir');
  setMode = set;
  return createElement(TextoEditor, {
    content: '# a',
    editorMode: mode,
    documentPath: '/tmp/a.md',
    editable: true,
    onChange: () => {},
    // IR 页顶部槽位（骨架把顶部格式操作栏放这里，使它随 IR 页一起平移）
    irHeader: createElement('div', { 'data-testid': 'ir-header' }, 'HDR'),
  });
}

async function mount(options: { flushSv?: boolean } = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(Wrapper));
  });
  // 等懒加载的 SV 解析完
  await act(async () => {});
  if (options.flushSv !== false) {
    // 模拟「窗口已打开、主线程空闲」：触发延迟挂载
    await act(async () => {
      vi.advanceTimersByTime(SV_MOUNT_DELAY_MS);
    });
    await act(async () => {});
  }
}

function writer() {
  return host!.querySelector('#writer')!;
}
function pane(side: 'ir' | 'sv') {
  return host!.querySelector(`.editor-pane[data-pane="${side}"]`);
}
function svActive() {
  return host!.querySelector('[data-mock="sv"]')?.getAttribute('data-active');
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
  // 默认按"应用常态"来：源码编辑器已预热就绪，因而会播转场
  svReady = true;
  setMode = null;
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
  // happy-dom 没有 requestIdleCallback；测试里让它同步执行，
  // 这样推进 SV_MOUNT_DELAY_MS 后组件会立即挂载。
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
    cb();
    return 0;
  });
  vi.stubGlobal('cancelIdleCallback', () => {});
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  host?.remove();
  host = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TextoEditor · 双模式转场', () => {
  it('首帧不挂载源码编辑器，窗口空闲后才挂载', async () => {
    await mount({ flushSv: false });
    expect(pane('sv')).not.toBeNull();
    expect(host!.querySelector('[data-mock="sv"]')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(SV_MOUNT_DELAY_MS);
    });
    await act(async () => {});

    expect(host!.querySelector('[data-mock="sv"]')).not.toBeNull();
  });

  it('两个 pane 常驻挂载，稳态不带相位属性', async () => {
    await mount();
    expect(pane('ir')).not.toBeNull();
    expect(pane('sv')).not.toBeNull();
    expect(writer().getAttribute('data-pane-transition')).toBeNull();
    expect(pane('ir')!.getAttribute('data-active')).toBe('true');
    expect(pane('sv')!.getAttribute('data-active')).toBe('false');
    expect(svActive()).toBe('false');
  });

  it('warm 相位不换位：data-active 与 active 都还是旧模式', async () => {
    await mount();
    act(() => {
      setMode!('sv');
    });
    expect(writer().getAttribute('data-pane-transition')).toBe('warm');
    expect(pane('ir')!.getAttribute('data-active')).toBe('true');
    expect(pane('sv')!.getAttribute('data-active')).toBe('false');
    expect(svActive()).toBe('false');
  });

  it('run 相位同一帧换位：data-active 与 active 一起翻转', async () => {
    await mount();
    act(() => {
      setMode!('sv');
    });
    pushFrame();
    expect(writer().getAttribute('data-pane-transition')).toBe('run');
    expect(pane('ir')!.getAttribute('data-active')).toBe('false');
    expect(pane('sv')!.getAttribute('data-active')).toBe('true');
    expect(svActive()).toBe('true');
  });

  it('收敛后回到稳态', async () => {
    await mount();
    act(() => {
      setMode!('sv');
    });
    pushFrame();
    act(() => {
      vi.advanceTimersByTime(PANE_TRANSITION_MS + PANE_SETTLE_MS);
    });
    expect(writer().getAttribute('data-pane-transition')).toBeNull();
    expect(pane('sv')!.getAttribute('data-active')).toBe('true');
  });

  it('SV 尚未挂载时切换走瞬时路径，随后补挂载', async () => {
    svReady = false;
    await mount({ flushSv: false });
    act(() => {
      setMode!('sv');
    });
    expect(writer().getAttribute('data-pane-transition')).toBeNull();
    expect(pane('sv')!.getAttribute('data-active')).toBe('true');

    await act(async () => {
      vi.advanceTimersByTime(SV_MOUNT_DELAY_MS);
    });
    await act(async () => {});
    expect(host!.querySelector('[data-mock="sv"]')).not.toBeNull();
    expect(svActive()).toBe('true');
  });

  it('SV chunk 已就绪时正常播转场', async () => {
    await mount();
    act(() => {
      setMode!('sv');
    });
    expect(writer().getAttribute('data-pane-transition')).toBe('warm');
  });

  // 转场能否稳定触发的关键：强制回流必须发生在 warm 已提交到 DOM 之后。
  // 若回流读到的还是 warm 之前的稳态 DOM（入场 pane 仍是 display:none），
  // run 的"变更前样式"会退化成稳态，入场页不再平移——表现为"两页不同步"
  // （只看到出场页在动）。这里用 #writer 的 offsetWidth getter 记录读取时刻的相位。
  it('强制回流发生在 warm 提交之后（读到 warm，而非稳态）', async () => {
    await mount();
    const container = writer() as HTMLElement;
    const reads: Array<string | null> = [];
    Object.defineProperty(container, 'offsetWidth', {
      configurable: true,
      get() {
        reads.push(container.getAttribute('data-pane-transition'));
        return 0;
      },
    });

    act(() => {
      setMode!('sv');
    });

    expect(reads).toEqual(['warm']);

    pushFrame();
    expect(writer().getAttribute('data-pane-transition')).toBe('run');
  });

  // 顶部格式操作栏随 IR 页一起平移的契约：它必须渲染在 IR pane 内部，
  // 才能被 pane 的 transform 一起带走；放在 pane 外（如 App 的兄弟节点）会原地不动。
  it('irHeader 渲染在 IR pane 内（随 IR 页一起平移）', async () => {
    await mount();
    const hdr = host!.querySelector('[data-testid="ir-header"]');
    expect(hdr).not.toBeNull();
    expect(pane('ir')!.contains(hdr)).toBe(true);
    expect(pane('sv')!.contains(hdr)).toBe(false);
  });

  it('切换模式时 irHeader 保持在 IR pane 内、不卸载（才能被平移出去）', async () => {
    await mount();
    act(() => {
      setMode!('sv');
    });
    expect(writer().getAttribute('data-pane-transition')).toBe('warm');
    expect(host!.querySelector('[data-testid="ir-header"]')).not.toBeNull();
    expect(pane('ir')!.contains(host!.querySelector('[data-testid="ir-header"]'))).toBe(true);

    pushFrame();
    expect(writer().getAttribute('data-pane-transition')).toBe('run');
    expect(host!.querySelector('[data-testid="ir-header"]')).not.toBeNull();
    expect(pane('ir')!.contains(host!.querySelector('[data-testid="ir-header"]'))).toBe(true);
  });
});
