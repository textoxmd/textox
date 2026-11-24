import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { getAgentSettings, resetAgentConfigForTests, updateAgentSettings } from '../config';
import { attachFloatingCard, detachFloatingCard } from '../presenter';
import { startAgentRun } from '../run';
import {
  appendAgentText,
  finishAgentSession,
  flushAgentTextForTests,
  getAgentSession,
  resetAgentSessionForTests,
  setAgentSession,
  subscribeAgentSession,
} from '../session';
import { setAgentSurface } from '../surface';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { invoke, listen } = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: unknown): Promise<unknown> => ({})),
  listen: vi.fn(async (_event: string, _handler: (event: unknown) => void) => () => {}),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));

// startAgentRun 用来确认滚动不会中止运行；运行本身由 mock 替代，避免联网。
const runtime = vi.hoisted(() => ({ runAgent: vi.fn() }));
vi.mock('../runtime', () => ({ runAgent: runtime.runAgent }));

// 测试只关心 key 本身（i18n 资源由任务 8 补齐）。
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const request = { messages: [{ role: 'user' as const, content: '写一段话' }] };

function presenterRoot(): HTMLDivElement | null {
  return document.querySelector<HTMLDivElement>('.agent-presenter-root');
}

function seedDone(text = '你好'): void {
  setAgentSession({ title: '解释', anchor: null, request });
  finishAgentSession(text);
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({});
  runtime.runAgent.mockReset();
  runtime.runAgent.mockImplementation(() => ({ abort: vi.fn() }));
  resetAgentConfigForTests();
  resetAgentSessionForTests();
});

afterEach(() => {
  act(() => {
    detachFloatingCard();
  });
  vi.unstubAllGlobals();
  resetAgentConfigForTests();
  resetAgentSessionForTests();
  document.body.innerHTML = '';
});

describe('floating card presenter', () => {
  it('挂载后创建根容器并渲染结果', () => {
    seedDone();
    act(() => {
      attachFloatingCard(null);
    });

    const root = presenterRoot();
    expect(root).not.toBeNull();
    expect(root?.querySelector('.agent-result')).not.toBeNull();
    expect(root?.textContent).toContain('你好');
  });

  it('idle 时不渲染内容（容器仍在）', () => {
    act(() => {
      attachFloatingCard(null);
    });

    expect(presenterRoot()).not.toBeNull();
    expect(presenterRoot()?.querySelector('.agent-result')).toBeNull();
  });

  it('detach 解绑并移除容器', () => {
    seedDone();
    act(() => {
      attachFloatingCard(null);
    });
    act(() => {
      detachFloatingCard();
    });

    expect(presenterRoot()).toBeNull();
  });

  it('切到 sidebar 时隐藏容器，切回 floating 再次显示', async () => {
    seedDone();
    act(() => {
      attachFloatingCard(null);
    });

    await act(async () => {
      await setAgentSurface('sidebar');
    });
    expect(getAgentSettings().surface).toBe('sidebar');
    expect(presenterRoot()?.style.display).toBe('none');
    // 隐藏的悬浮树不再渲染结果（避免继续解析 Markdown）。
    expect(presenterRoot()?.querySelector('.agent-result')).toBeNull();

    await act(async () => {
      await setAgentSurface('floating');
    });
    expect(presenterRoot()?.style.display).toBe('');
    expect(presenterRoot()?.querySelector('.agent-result')).not.toBeNull();
  });

  it('浮回时按最近锚点重新定位并显示', async () => {
    const widthSpy = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
    const heightSpy = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    try {
      seedDone();
      act(() => {
        attachFloatingCard({ left: 790, top: 580, right: 800, bottom: 590, width: 10, height: 10 });
      });

      await act(async () => {
        await setAgentSurface('sidebar');
      });
      expect(presenterRoot()?.style.display).toBe('none');

      // 故意改坏位置：浮回必须按 lastAnchor 重算，而不是沿用旧样式。
      act(() => {
        presenterRoot()!.style.left = '0px';
        presenterRoot()!.style.top = '0px';
      });

      await act(async () => {
        await setAgentSurface('floating');
      });

      const root = presenterRoot();
      expect(root?.style.display).toBe('');
      expect(root?.querySelector('.agent-result')).not.toBeNull();
      // 宽度 420 → left = innerWidth - width - 12；卡片高 360（无内容时回退 maxHeight），
      // 下方只剩 10px、上方足够 → 翻到锚点上方。
      expect(root?.style.left).toBe('368px');
      expect(root?.style.top).toBe('212px');
    } finally {
      widthSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  it('锚点过期后浮回落到默认位', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    try {
      nowSpy.mockReturnValue(1_000_000);
      seedDone();
      act(() => {
        attachFloatingCard({ left: 100, top: 100, right: 200, bottom: 120, width: 100, height: 20 });
      });
      expect(presenterRoot()?.style.left).toBe('100px');
      expect(presenterRoot()?.style.top).toBe('128px');

      await act(async () => {
        await setAgentSurface('sidebar');
      });
      // 超过保鲜期（10s）才浮回：锚点已不可信，回落到右上角默认位。
      nowSpy.mockReturnValue(1_000_000 + 10_001);
      await act(async () => {
        await setAgentSurface('floating');
      });

      expect(presenterRoot()?.style.display).toBe('');
      // 锚点过期：落到左上角 margin（不再用旧的 24/96 默认位）。
      expect(presenterRoot()?.style.left).toBe('12px');
      expect(presenterRoot()?.style.top).toBe('12px');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('floating 下的无关设置变更不会把卡片挪到默认位', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    try {
      nowSpy.mockReturnValue(1_000_000);
      seedDone();
      act(() => {
        attachFloatingCard({ left: 100, top: 100, right: 200, bottom: 120, width: 100, height: 20 });
      });
      expect(presenterRoot()?.style.left).toBe('100px');
      expect(presenterRoot()?.style.top).toBe('128px');

      // 锚点早已过期，但承载面没有变化（不是 sidebar → floating 跃迁）：位置保持不动。
      nowSpy.mockReturnValue(1_000_000 + 60_000);
      await act(async () => {
        await updateAgentSettings({ enabled: true });
      });
      // 配置确实变了（会触发 settings 订阅通知），但承载面未变。
      expect(getAgentSettings().enabled).toBe(true);

      expect(presenterRoot()?.style.display).toBe('');
      expect(presenterRoot()?.style.left).toBe('100px');
      expect(presenterRoot()?.style.top).toBe('128px');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('document 滚动只隐藏悬浮卡，不清空会话', () => {
    const abort = vi.fn();
    runtime.runAgent.mockReturnValueOnce({ abort });
    startAgentRun(request, null, '解释');
    act(() => {
      attachFloatingCard(null);
    });

    act(() => {
      document.dispatchEvent(new Event('scroll'));
    });

    expect(abort).not.toHaveBeenCalled();
    expect(getAgentSession().status).toBe('streaming');
    expect(presenterRoot()?.style.display).toBe('none');
  });

  it('sidebar 模式下 document 滚动不中止会话', async () => {
    const abort = vi.fn();
    runtime.runAgent.mockReturnValueOnce({ abort });
    startAgentRun(request, null, '解释');
    act(() => {
      attachFloatingCard(null);
    });

    await act(async () => {
      await setAgentSurface('sidebar');
    });
    act(() => {
      document.dispatchEvent(new Event('scroll'));
    });

    expect(abort).not.toHaveBeenCalled();
    expect(getAgentSession().status).toBe('streaming');
  });

  it('sidebar 模式下 resize 也不关闭会话', async () => {
    seedDone();
    act(() => {
      attachFloatingCard(null);
    });

    await act(async () => {
      await setAgentSurface('sidebar');
    });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(getAgentSession().status).toBe('done');
  });

  it('idle 时滚动不再产生会话通知', () => {
    let calls = 0;
    const unsubscribe = subscribeAgentSession(() => {
      calls += 1;
    });
    try {
      act(() => {
        attachFloatingCard(null);
      });
      calls = 0;

      act(() => {
        document.dispatchEvent(new Event('scroll'));
      });

      expect(calls).toBe(0);
    } finally {
      unsubscribe();
    }
  });

  it('窗口滚动（target 非 Element）只隐藏卡片', () => {
    seedDone();
    act(() => {
      attachFloatingCard(null);
    });

    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });

    expect(getAgentSession().status).toBe('done');
    expect(presenterRoot()?.style.display).toBe('none');
  });

  it('流式期间结果正文滚动不重置会话', () => {
    setAgentSession({ title: '解释', anchor: null, request });
    appendAgentText('第一段');
    act(() => {
      flushAgentTextForTests();
      attachFloatingCard(null);
    });

    const body = presenterRoot()?.querySelector('.agent-result-body');
    expect(body).not.toBeNull();
    act(() => {
      body!.dispatchEvent(new Event('scroll'));
    });

    expect(getAgentSession().status).toBe('streaming');
  });

  it('结果正文自身滚动不会关闭卡片', () => {
    seedDone('一段比较长的回答');
    act(() => {
      attachFloatingCard(null);
    });

    const body = presenterRoot()?.querySelector('.agent-result-body');
    expect(body).not.toBeNull();
    act(() => {
      body!.dispatchEvent(new Event('scroll'));
    });

    expect(getAgentSession().status).toBe('done');
  });

  it('侧栏面板内滚动不会关闭会话', () => {
    seedDone();
    act(() => {
      attachFloatingCard(null);
    });

    const panel = document.createElement('div');
    panel.className = 'agent-sidebar-panel';
    document.body.append(panel);
    act(() => {
      panel.dispatchEvent(new Event('scroll'));
    });

    expect(getAgentSession().status).toBe('done');
  });

  it('侧栏文件树等非编辑器容器滚动不关闭会话', () => {
    seedDone();
    act(() => {
      attachFloatingCard(null);
    });

    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar-area';
    const tree = document.createElement('div');
    tree.className = 'file-tree';
    sidebar.append(tree);
    document.body.append(sidebar);
    act(() => {
      tree.dispatchEvent(new Event('scroll'));
    });

    expect(getAgentSession().status).toBe('done');
    expect(presenterRoot()?.style.display).toBe('');
  });

  it('编辑器区域滚动只隐藏卡片', () => {
    const abort = vi.fn();
    runtime.runAgent.mockReturnValueOnce({ abort });
    startAgentRun(request, null, '解释');
    act(() => {
      attachFloatingCard(null);
    });

    const editor = document.createElement('div');
    editor.className = 'editor-area';
    document.body.append(editor);
    act(() => {
      editor.dispatchEvent(new Event('scroll'));
    });

    expect(abort).not.toHaveBeenCalled();
    expect(getAgentSession().status).toBe('streaming');
    expect(presenterRoot()?.style.display).toBe('none');
  });

  it('窗口 resize 只隐藏卡片，会话保留', () => {
    seedDone();
    act(() => {
      attachFloatingCard(null);
    });

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(getAgentSession().status).toBe('done');
    expect(presenterRoot()?.style.display).toBe('none');
  });

  it('隐藏后新的 present() 重新显示卡片', () => {
    seedDone();
    act(() => {
      attachFloatingCard({ left: 100, top: 100, right: 200, bottom: 120, width: 100, height: 20 });
    });
    expect(presenterRoot()?.style.left).toBe('100px');
    expect(presenterRoot()?.style.top).toBe('128px');

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(presenterRoot()?.style.display).toBe('none');

    act(() => {
      attachFloatingCard(null);
    });

    expect(presenterRoot()?.style.display).toBe('');
    expect(getAgentSession().status).toBe('done');
    // 隐藏时已丢弃旧锚点；重新 present 未给锚点 ⇒ 落默认位，不回到旧的 100/128。
    expect(presenterRoot()?.style.left).toBe('12px');
    expect(presenterRoot()?.style.top).toBe('12px');
  });

  it('隐藏后设置变更不会把卡片弹回', async () => {
    seedDone();
    act(() => {
      attachFloatingCard(null);
    });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(presenterRoot()?.style.display).toBe('none');

    // 承载面仍是 floating（patch 里显式写回）但配置确实变了：会触发 config 通知。
    await act(async () => {
      await updateAgentSettings({ surface: 'floating', enabled: true });
    });
    // 承载面未变，但配置确实变了：会触发 config 通知。
    expect(getAgentSettings().enabled).toBe(true);
    expect(getAgentSettings().surface).toBe('floating');

    expect(getAgentSession().status).toBe('done');
    expect(presenterRoot()?.style.display).toBe('none');
  });

  it('隐藏后流式输出继续写入会话', () => {
    const abort = vi.fn();
    runtime.runAgent.mockReturnValueOnce({ abort });
    startAgentRun(request, null, '解释');
    act(() => {
      attachFloatingCard(null);
    });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(presenterRoot()?.style.display).toBe('none');

    act(() => {
      appendAgentText('继续');
      flushAgentTextForTests();
    });

    expect(abort).not.toHaveBeenCalled();
    expect(getAgentSession().status).toBe('streaming');
    expect(getAgentSession().text).toBe('继续');
    expect(presenterRoot()?.style.display).toBe('none');
  });

  it('滚动隐藏后显式浮回（sidebar → floating）重新显示卡片', async () => {
    seedDone();
    act(() => {
      attachFloatingCard({ left: 100, top: 100, right: 200, bottom: 120, width: 100, height: 20 });
    });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(presenterRoot()?.style.display).toBe('none');

    await act(async () => {
      await setAgentSurface('sidebar');
    });
    await act(async () => {
      await setAgentSurface('floating');
    });

    const root = presenterRoot();
    expect(root?.style.display).toBe('');
    expect(getAgentSession().status).toBe('done');
    // 锚点已被 hide 清空：浮回落到默认位。
    expect(root?.style.left).toBe('12px');
    expect(root?.style.top).toBe('12px');
  });

  it('再次 attach 只重新定位，不重建容器', () => {
    seedDone();
    act(() => {
      attachFloatingCard({ left: 100, top: 100, right: 200, bottom: 120, width: 100, height: 20 });
    });
    const first = presenterRoot();
    expect(first?.style.left).toBe('100px');
    expect(first?.style.top).toBe('128px');

    act(() => {
      attachFloatingCard({ left: 400, top: 400, right: 500, bottom: 420, width: 100, height: 20 });
    });

    expect(presenterRoot()).toBe(first);
    // 第二个锚点下方 / 上方都放不下默认高度的卡片（460.8px），选空间更大的一侧后夹到上边距。
    expect(presenterRoot()?.style.left).toBe('400px');
    expect(presenterRoot()?.style.top).toBe('12px');
  });

  it('anchor 靠近右下角时夹取到视口内', () => {
    const widthSpy = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
    const heightSpy = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    try {
      seedDone();
      act(() => {
        attachFloatingCard({
          left: 790,
          top: 580,
          right: 800,
          bottom: 590,
          width: 10,
          height: 10,
        });
      });

      const root = presenterRoot();
      expect(root?.style.width).toBe('420px');
      // left = innerWidth - width - 12
      expect(root?.style.left).toBe('368px');
      // 下方只剩 10px：翻到锚点上方，top = anchor.top - height - 8。
      expect(root?.style.top).toBe('212px');
      // 卡片完整落在视口内（高度回退 maxHeight = 60vh = 360）。
      expect(212 + parseFloat(root!.style.maxHeight)).toBeLessThanOrEqual(600 - 12);
    } finally {
      widthSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  it('底部锚点：下方放不下时翻到上方，卡片完整落在视口内', () => {
    const widthSpy = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
    const heightSpy = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    try {
      seedDone();
      act(() => {
        attachFloatingCard({ left: 100, top: 550, right: 200, bottom: 570, width: 100, height: 20 });
      });

      const root = presenterRoot()!;
      const height = parseFloat(root.style.maxHeight);
      const top = parseFloat(root.style.top);
      // 下方只剩 600 - 12 - 578 = 10px：翻到上方，top = anchor.top - height - 8。
      expect(height).toBe(360);
      expect(top).toBe(182);
      expect(top + height).toBeLessThanOrEqual(600 - 12);
      expect(top).toBeGreaterThanOrEqual(12);
    } finally {
      widthSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  it('右侧锚点：left 夹取到视口内', () => {
    const widthSpy = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
    const heightSpy = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    try {
      seedDone();
      act(() => {
        attachFloatingCard({ left: 790, top: 100, right: 800, bottom: 120, width: 10, height: 20 });
      });

      const root = presenterRoot()!;
      expect(root.style.width).toBe('420px');
      expect(root.style.left).toBe('368px');
      expect(368 + parseFloat(root.style.width)).toBeLessThanOrEqual(800 - 12);
    } finally {
      widthSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  it('自定义 width / maxHeight 生效并参与定位', () => {
    const widthSpy = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
    const heightSpy = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    try {
      seedDone();
      act(() => {
        attachFloatingCard(
          { left: 100, top: 550, right: 200, bottom: 570, width: 100, height: 20 },
          { width: 320, maxHeight: 200 },
        );
      });

      const root = presenterRoot()!;
      expect(root.style.width).toBe('320px');
      expect(root.style.maxHeight).toBe('200px');
      // 卡片高度回退到 maxHeight(200)，下方放不下 → 上方：570 - 200 - 8。
      expect(root.style.top).toBe('342px');
      expect(342 + 200).toBeLessThanOrEqual(600 - 12);
    } finally {
      widthSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  it('尺寸被视口夹取（超宽 / 超高时收窄）', () => {
    const widthSpy = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(400);
    const heightSpy = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(300);
    try {
      act(() => {
        attachFloatingCard(null, { width: 900, maxHeight: 900 });
      });

      const root = presenterRoot()!;
      expect(root.style.width).toBe('376px');
      expect(root.style.maxHeight).toBe('276px');
      expect(root.style.left).toBe('12px');
      expect(root.style.top).toBe('12px');
    } finally {
      widthSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  it('内容变高时按 ResizeObserver 重新定位', () => {
    const widthSpy = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
    const heightSpy = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    try {
      const observer = stubResizeObserver();
      seedDone();
      act(() => {
        attachFloatingCard({ left: 100, top: 400, right: 200, bottom: 420, width: 100, height: 20 });
      });

      const root = presenterRoot()!;
      // 初始无内容：高度回退 maxHeight(360)，下方 160 放不下 → 上方 32。
      expect(root.style.top).toBe('32px');

      // 流式内容渲染后卡片实际高度变小（200）：仍可放上方，但 top 需重算。
      root.getBoundingClientRect = () => ({ height: 200, width: 420 } as DOMRect);
      act(() => {
        observer.trigger();
      });

      expect(root.style.top).toBe('192px');
      expect(192 + 200).toBeLessThanOrEqual(600 - 12);
    } finally {
      widthSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });

  it('侧栏承载面下的尺寸变化不重定位悬浮卡', async () => {
    const observer = stubResizeObserver();
    seedDone();
    act(() => {
      attachFloatingCard({ left: 100, top: 400, right: 200, bottom: 420, width: 100, height: 20 });
    });

    const root = presenterRoot()!;
    const before = root.style.top;

    await act(async () => {
      await setAgentSurface('sidebar');
    });
    root.getBoundingClientRect = () => ({ height: 120, width: 420 } as DOMRect);
    act(() => {
      observer.trigger();
    });

    expect(root.style.display).toBe('none');
    expect(root.style.top).toBe(before);
  });
});

/** 替换 happy-dom 里未实现的 ResizeObserver：记录回调并允许手动触发。 */
function stubResizeObserver(): { trigger(): void } {
  const callbacks: ResizeObserverCallback[] = [];
  class FakeResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  return {
    trigger() {
      for (const callback of callbacks) callback([], {} as ResizeObserver);
    },
  };
}

