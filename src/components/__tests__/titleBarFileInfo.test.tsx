import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// 让 useTranslation 回显 key / defaultValue，并按 {{count}} 或 {{count, number}} 插值，
// 不依赖 @/i18n 的异步装载时序。
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      options?: string | { defaultValue?: string; count?: number } & Record<string, unknown>,
    ) => {
      const template = typeof options === 'string' ? options : (options?.defaultValue ?? key);
      return template.replace(
        /\{\{\s*(\w+)(?:\s*,\s*\w+)?\s*\}\}/g,
        (_match, name: string) =>
          String(options && typeof options === 'object' ? (options[name] ?? '') : ''),
      );
    },
    i18n: { language: 'zh-CN', changeLanguage: async () => {}, exists: () => false },
  }),
}));

const { invokeMock, startDraggingMock, toggleMaximizeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (_cmd: string, _args?: unknown): Promise<unknown> => undefined),
  startDraggingMock: vi.fn(async () => {}),
  toggleMaximizeMock: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging: startDraggingMock,
    toggleMaximize: toggleMaximizeMock,
    minimize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    isMaximized: async () => false,
    onFocusChanged: async () => () => {},
    onResized: async () => () => {},
  }),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn(async () => {}) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { FileInfoCard, type FileInfoCardProps } from '../titlebar/FileInfoCard';
import { splitFilename } from '../titlebar/filename';
import {
  detectNewline,
  formatFileSize,
  formatModifiedAt,
} from '../titlebar/format';
import { TitleBar, isInFileInfoCard } from '../TitleBar';

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('splitFilename', () => {
  it('短文件名整段进入尾段，头段为空', () => {
    expect(splitFilename('notes')).toEqual({ head: '', tail: 'notes' });
  });

  it('长度正好等于 8 时不拆', () => {
    expect(splitFilename('abcdefgh')).toEqual({ head: '', tail: 'abcdefgh' });
  });

  it('超长时头段留下余量、尾段固定 8 个字符', () => {
    expect(splitFilename('abcdefghij')).toEqual({ head: 'ab', tail: 'cdefghij' });
  });

  it('按 code point 计数，不拆坏 emoji 代理对', () => {
    expect(splitFilename('😀😀😀😀😀😀😀😀😀')).toEqual({
      head: '😀',
      tail: '😀😀😀😀😀😀😀😀',
    });
  });

  it('空字符串返回两段皆空', () => {
    expect(splitFilename('')).toEqual({ head: '', tail: '' });
  });

  it('中文长文件名拼回去与原文一致', () => {
    const stem = '会议记录-2026-Q4-产品规划-第二轮讨论稿-v3';
    const { head, tail } = splitFilename(stem);
    expect(head + tail).toBe(stem);
    expect(Array.from(tail)).toHaveLength(8);
  });
});

describe('formatFileSize', () => {
  it('小于 1 KB 用字节', () => {
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('KB 保留一位小数', () => {
    expect(formatFileSize(12698)).toBe('12.4 KB');
  });

  it('数值超过 100 时省掉小数', () => {
    expect(formatFileSize(1024 * 123.4)).toBe('123 KB');
  });

  it('自动进位到 MB', () => {
    expect(formatFileSize(1024 * 1024 * 3.5)).toBe('3.5 MB');
  });

  it('四舍五入后撞到 1024 时进位', () => {
    expect(formatFileSize(1023.7)).toBe('1.0 KB');
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1024 * 1023.96)).toBe('1.0 MB');
    expect(formatFileSize(1024 * 99.96)).toBe('100 KB');
  });

  it('缺失或非法值返回 null', () => {
    expect(formatFileSize(null)).toBeNull();
    expect(formatFileSize(undefined)).toBeNull();
    expect(formatFileSize(-1)).toBeNull();
    expect(formatFileSize(Number.NaN)).toBeNull();
  });

  it('Infinity 返回 null', () => {
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('detectNewline', () => {
  it('含 CRLF 判定为 CRLF', () => {
    expect(detectNewline('a\r\nb')).toBe('CRLF');
  });

  it('纯 LF 判定为 LF', () => {
    expect(detectNewline('a\nb')).toBe('LF');
  });

  it('空内容判定为 LF', () => {
    expect(detectNewline('')).toBe('LF');
  });
});

describe('formatModifiedAt', () => {
  const now = new Date(2026, 10, 14, 20, 0, 0);

  it('今天的文件用「今天 + 时间」', () => {
    const text = formatModifiedAt(new Date(2026, 10, 14, 9, 32).getTime(), 'zh-CN', now);
    expect(text).toBe('今天 09:32');
  });

  it('en-US 下当天时间锁 24 小时制、补零、无 AM/PM', () => {
    const text = formatModifiedAt(new Date(2026, 10, 14, 9, 32).getTime(), 'en-US', now);
    expect(text).toBe('today 09:32');
  });

  it('昨天的文件用「昨天 + 时间」', () => {
    const text = formatModifiedAt(new Date(2026, 10, 13, 18, 4).getTime(), 'zh-CN', now);
    expect(text).toBe('昨天 18:04');
  });

  it('更早的文件用月日 + 时间', () => {
    const text = formatModifiedAt(new Date(2026, 10, 10, 18, 4).getTime(), 'zh-CN', now);
    // 月日走 locale 原生格式，分隔符随 locale 变化，这里只锁「有月日 + 有时间」。
    expect(text).toMatch(/^11[\/.]10 18:04$/);
  });

  it('未来时间不显示成具体日期', () => {
    const text = formatModifiedAt(new Date(2026, 10, 15, 9, 32).getTime(), 'zh-CN', now);
    expect(text).toBe('明天 09:32');
  });

  it('缺失时间返回 null', () => {
    expect(formatModifiedAt(null, 'zh-CN', now)).toBeNull();
    expect(formatModifiedAt(undefined, 'zh-CN', now)).toBeNull();
  });

  it('非法时间戳返回 null', () => {
    expect(formatModifiedAt(Number.NaN, 'zh-CN', now)).toBeNull();
    expect(formatModifiedAt(Number.POSITIVE_INFINITY, 'zh-CN', now)).toBeNull();
  });
});

async function renderCard(props: FileInfoCardProps) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<FileInfoCard {...props} />);
  });
  // 让 get_file_metadata 的 promise 链在下一次 act 中落地。
  await act(async () => {
    await Promise.resolve();
  });
  return { container, root };
}

describe('FileInfoCard', () => {
  let mounted: Array<{ root: Root; container: HTMLElement }> = [];

  beforeEach(() => {
    mounted = [];
    invokeMock.mockReset();
  });

  afterEach(() => {
    for (const { root, container } of mounted) {
      act(() => root.unmount());
      container.remove();
    }
  });

  async function mount(props: FileInfoCardProps) {
    const handle = await renderCard(props);
    mounted.push(handle);
    return handle.container;
  }

  it('临时文件不渲染路径行与操作按钮，改用未保存提示', async () => {
    const container = await mount({
      fileName: 'Untitled.md',
      filePath: null,
      isTemp: true,
      content: '# hello\n',
    });

    expect(container.querySelectorAll('.titlebar-file-info-action')).toHaveLength(0);
    const path = container.querySelector('.titlebar-file-info-path');
    expect(path?.textContent).toBe('未保存');
    expect(invokeMock).not.toHaveBeenCalled();

    const dts = Array.from(container.querySelectorAll('.titlebar-file-info-row dt')).map(
      (node) => node.textContent ?? '',
    );
    expect(dts[0]).toBe('');
    expect(dts[1]).toBe('');
  });

  it('元信息可用时渲染大小、行数与修改时间', async () => {
    invokeMock.mockResolvedValueOnce({
      size: 12698,
      mtimeMs: new Date(2026, 10, 14, 9, 32).getTime(),
    });

    const container = await mount({
      fileName: 'notes.md',
      filePath: '/Users/me/Documents/notes.md',
      isTemp: false,
      content: 'a\nb\nc\n',
    });

    const values = Array.from(
      container.querySelectorAll('.titlebar-file-info-row dd'),
    ).map((node) => node.textContent ?? '');

    expect(values[0]).toContain('12.4 KB');
    expect(values[0]).toContain('4 行');
    expect(values[1]).toBe('3 字 · 6 字符');
    expect(values[2]).toContain('09:32');
    expect(container.querySelectorAll('.titlebar-file-info-action')).toHaveLength(2);

    // 参数名写错会让 invoke 永远 reject，界面静默降级为破折号。
    expect(invokeMock).toHaveBeenCalledWith('get_file_metadata', {
      path: '/Users/me/Documents/notes.md',
    });
  });

  it('get_file_metadata 失败时大小与修改时间降级为破折号', async () => {
    invokeMock.mockRejectedValueOnce(new Error('file gone'));

    const container = await mount({
      fileName: 'notes.md',
      filePath: '/Users/me/Documents/notes.md',
      isTemp: false,
      content: 'a\nb\n',
    });

    const values = Array.from(
      container.querySelectorAll('.titlebar-file-info-row dd'),
    ).map((node) => node.textContent ?? '');

    expect(values[0].startsWith('—')).toBe(true);
    expect(values[2]).toBe('—');
  });

  it('CRLF 内容的编码行显示 UTF-8 · CRLF', async () => {
    invokeMock.mockResolvedValueOnce({ size: 1024, mtimeMs: Date.now() });

    const container = await mount({
      fileName: 'notes.md',
      filePath: '/Users/me/Documents/notes.md',
      isTemp: false,
      content: 'a\r\nb',
    });

    const values = Array.from(
      container.querySelectorAll('.titlebar-file-info-row dd'),
    ).map((node) => node.textContent ?? '');
    expect(values[3]).toBe('UTF-8 · CRLF');
  });
});

describe('isInFileInfoCard', () => {
  it('卡片内部节点返回 true，外部返回 false，非元素返回 false', () => {
    const popup = document.createElement('div');
    popup.className = 'titlebar-file-info-popup';
    const button = document.createElement('button');
    popup.appendChild(button);
    document.body.appendChild(popup);

    expect(isInFileInfoCard(button)).toBe(true);
    expect(isInFileInfoCard(popup)).toBe(true);
    expect(isInFileInfoCard(document.body)).toBe(false);
    expect(isInFileInfoCard(null)).toBe(false);
    expect(isInFileInfoCard(new EventTarget())).toBe(false);

    popup.remove();
  });
});

describe('TitleBar 文件信息卡片的点击交互', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    startDraggingMock.mockClear();
    toggleMaximizeMock.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    container?.remove();
    container = null;
    // Portal 挂在 body 上，卸载后可能残留节点，逐条清理。
    document.querySelectorAll('.titlebar-file-info-popup').forEach((node) => node.remove());
    vi.useRealTimers();
  });

  async function renderTitleBar() {
    await act(async () => {
      root!.render(
        <TitleBar
          title="notes.md"
          hasDocument
          fileInfo={{ filePath: '/Users/me/Documents/notes.md', isTemp: false, getContent: () => 'a\nb\n' }}
        />,
      );
    });
  }

  function getTrigger(): HTMLElement {
    const trigger = container!.querySelector('.window-title');
    expect(trigger).not.toBeNull();
    return trigger as HTMLElement;
  }

  /**
   * Base UI Popover 在 trigger 的 click 上切换开关。
   * 按真实点击序列派发，再推进一次微任务让 Portal 挂载。
   */
  async function clickTrigger() {
    const trigger = getTrigger();
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    return trigger;
  }

  function queryPopup(): HTMLElement | null {
    return document.querySelector('.titlebar-file-info-popup');
  }

  it('触发元素渲染为真正的 <button>，并带上 aria 状态', async () => {
    await renderTitleBar();

    const trigger = getTrigger();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('type')).toBe('button');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('点击文件名打开卡片并显示文件名', async () => {
    await renderTitleBar();
    expect(queryPopup()).toBeNull();

    const trigger = await clickTrigger();

    const popup = queryPopup();
    expect(popup).not.toBeNull();
    expect(popup!.querySelector('.titlebar-file-info-name')?.textContent).toBe('notes.md');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('在文件名上按下鼠标不触发窗口拖动', async () => {
    await renderTitleBar();
    const trigger = getTrigger();

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(startDraggingMock).not.toHaveBeenCalled();
  });

  it('在文件名上双击不触发窗口最大化', async () => {
    await renderTitleBar();
    const trigger = getTrigger();

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(toggleMaximizeMock).not.toHaveBeenCalled();
    expect(startDraggingMock).not.toHaveBeenCalled();
  });

  it('卡片内的 mousedown / dblclick 不触发窗口拖动与最大化', async () => {
    await renderTitleBar();
    const popup = queryPopup();
    expect(popup).toBeNull();
    await clickTrigger();

    const opened = queryPopup();
    expect(opened).not.toBeNull();
    const button = opened!.querySelector('button');
    expect(button).not.toBeNull();

    await act(async () => {
      button!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      button!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    // 卡片经 Portal 挂到 body，但合成事件仍冒泡回标题栏的三个处理器。
    expect(startDraggingMock).not.toHaveBeenCalled();
    expect(toggleMaximizeMock).not.toHaveBeenCalled();
  });

  it('再次点击文件名关闭卡片', async () => {
    await renderTitleBar();

    await clickTrigger();
    expect(queryPopup()).not.toBeNull();

    await clickTrigger();
    expect(queryPopup()).toBeNull();
  });

  it('按 Escape 关闭卡片', async () => {
    await renderTitleBar();

    await clickTrigger();
    expect(queryPopup()).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(queryPopup()).toBeNull();
  });

  it('点击卡片外部关闭', async () => {
    await renderTitleBar();
    await clickTrigger();
    expect(queryPopup()).not.toBeNull();
    const trigger = getTrigger();

    // Base UI 的鼠标外部点击判定是 intentional 模式：真正触发关闭的是完整点击序列里的
    // click，单纯 pointerdown 不会关，所以按真实交互把四个事件都派发一遍。
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(queryPopup()).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('对照：标题栏空白处按下时仍然拖动窗口', async () => {
    await renderTitleBar();

    const bar = container!.querySelector('.title-bar');
    expect(bar).not.toBeNull();

    await act(async () => {
      bar!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(startDraggingMock).toHaveBeenCalledTimes(1);
  });
});
