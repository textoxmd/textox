import type { PreviewContext } from '@texto/markdown-editor-api';
import type { Node as PMNode } from 'prosemirror-model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { engines, registerPreview } = vi.hoisted(() => {
  const mermaid = {
    id: 'mermaid' as const,
    render: vi.fn(async (t: string) => `<svg data-engine="mermaid" data-text="${t}"></svg>`),
  };
  const pele = {
    id: 'pele' as const,
    render: vi.fn(async (t: string) => `<svg data-engine="pele" data-text="${t}"></svg>`),
  };
  const switcher: {
    current: typeof mermaid | typeof pele;
    mermaid: typeof mermaid;
    pele: typeof pele;
  } = { current: mermaid, mermaid, pele };
  return {
    engines: switcher,
    registerPreview: vi.fn((_refresh: () => void) => () => {}),
  };
});

vi.mock('./diagram-engine', () => ({
  getActiveEngine: () => engines.current,
  registerPreview,
}));

import { createMermaidPreview } from './mermaid-renderer';

function nodeStub(textContent: string): PMNode {
  return { textContent } as unknown as PMNode;
}

function previewContext(
  onError: (msg: string) => void = () => {},
  onSuccess?: () => void,
): PreviewContext {
  return { documentDir: null, theme: 'base', onError, onSuccess };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  engines.current = engines.mermaid;
  engines.mermaid.render.mockImplementation(
    async (t: string) => `<svg data-engine="mermaid" data-text="${t}"></svg>`,
  );
  engines.pele.render.mockImplementation(
    async (t: string) => `<svg data-engine="pele" data-text="${t}"></svg>`,
  );
  document.documentElement.style.setProperty('--editor-font-family-base', 'Test Editor Font');
});

afterEach(() => {
  document.body.innerHTML = '';
  document.body.style.removeProperty('font-family');
  document.documentElement.style.removeProperty('--editor-font-family-base');
});

describe('createMermaidPreview', () => {
  it('空内容显示占位且不调用引擎', () => {
    const preview = createMermaidPreview(nodeStub('   '));

    preview.update?.(nodeStub('   '), previewContext());

    expect(preview.dom.innerHTML).toContain('cb-render-empty');
    expect(engines.mermaid.render).not.toHaveBeenCalled();
  });

  it('渲染成功后写入 mermaid-svg-container 并使用编辑器字体', async () => {
    const text = 'graph TD\nA-->B';
    const preview = createMermaidPreview(nodeStub(text));

    preview.update?.(nodeStub(text), previewContext());
    await flush();

    expect(preview.dom.innerHTML).toContain('mermaid-svg-container');
    expect(preview.dom.innerHTML).toContain('data-text="graph TD');
    expect(engines.mermaid.render).toHaveBeenCalledWith(text, {
      fontFamily: 'Test Editor Font',
    });
  });

  it('没有设置根字体变量时不回退到 body 字体', async () => {
    document.documentElement.style.removeProperty('--editor-font-family-base');
    document.body.style.fontFamily = 'Body Only Font';
    const text = 'graph TD\nA-->B';
    const preview = createMermaidPreview(nodeStub(text));

    preview.update?.(nodeStub(text), previewContext());
    await flush();

    expect(engines.mermaid.render).toHaveBeenCalledWith(text, {
      fontFamily: undefined,
    });
  });

  it('渲染失败时清掉 loading 占位并上报错误', async () => {
    engines.mermaid.render.mockRejectedValueOnce(new Error('boom'));
    const onError = vi.fn();
    const preview = createMermaidPreview(nodeStub('graph X'));

    preview.update?.(nodeStub('graph X'), previewContext(onError));
    expect(preview.dom.innerHTML).toContain('cb-render-loading');

    await flush();

    expect(preview.dom.innerHTML).toBe('');
    expect(onError).toHaveBeenCalledWith('boom');
  });

  it('渲染成功后调用 onSuccess', async () => {
    const onSuccess = vi.fn();
    const text = 'graph TD\nA-->B';
    const preview = createMermaidPreview(nodeStub(text));

    preview.update?.(nodeStub(text), previewContext(() => {}, onSuccess));
    await flush();

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('渲染失败时不调用 onSuccess', async () => {
    engines.mermaid.render.mockRejectedValueOnce(new Error('boom'));
    const onSuccess = vi.fn();
    const preview = createMermaidPreview(nodeStub('graph X'));

    preview.update?.(nodeStub('graph X'), previewContext(() => {}, onSuccess));
    await flush();

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('onSuccess 抛错不影响预览内容', async () => {
    const onSuccess = vi.fn(() => {
      throw new Error('callback failed');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const text = 'graph TD\nA-->B';
    const preview = createMermaidPreview(nodeStub(text));

    preview.update?.(nodeStub(text), previewContext(() => {}, onSuccess));
    await flush();

    expect(preview.dom.innerHTML).toContain('mermaid-svg-container');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('旧请求晚于新请求完成时不会覆盖新结果', async () => {
    let resolveFirst!: (value: string) => void;
    engines.mermaid.render.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const preview = createMermaidPreview(nodeStub('old'));

    preview.update?.(nodeStub('old'), previewContext());
    preview.update?.(nodeStub('new'), previewContext());
    await flush();
    resolveFirst('<svg data-text="old"></svg>');
    await flush();

    expect(preview.dom.innerHTML).toContain('data-text="new"');
    expect(preview.dom.innerHTML).not.toContain('data-text="old"');
  });

  it('destroy 时注销预览刷新回调', () => {
    const unregister = vi.fn();
    registerPreview.mockReturnValueOnce(unregister);
    const preview = createMermaidPreview(nodeStub('graph TD\nA-->B'));

    preview.destroy?.();

    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('渲染器切换时可见预览会重新渲染', async () => {
    const registration: { refresh: (() => void) | null } = { refresh: null };
    registerPreview.mockImplementationOnce((fn: () => void) => {
      registration.refresh = fn;
      return () => {};
    });
    const preview = createMermaidPreview(nodeStub('graph TD\nA-->B'));
    document.body.appendChild(preview.dom);
    Object.defineProperty(preview.dom, 'offsetParent', { value: document.body, configurable: true });
    preview.update?.(nodeStub('graph TD\nA-->B'), previewContext());
    await flush();
    const mermaidCallsBefore = engines.mermaid.render.mock.calls.length;
    expect(preview.dom.innerHTML).toContain('data-engine="mermaid"');

    engines.current = engines.pele;
    registration.refresh?.();
    await flush();

    expect(engines.pele.render).toHaveBeenCalledTimes(1);
    expect(preview.dom.innerHTML).toContain('data-engine="pele"');
    expect(engines.mermaid.render.mock.calls.length).toBe(mermaidCallsBefore);
  });

  it('隐藏预览在渲染器切换时不刷新，避免源码态弹错', async () => {
    const registration: { refresh: (() => void) | null } = { refresh: null };
    registerPreview.mockImplementationOnce((fn: () => void) => {
      registration.refresh = fn;
      return () => {};
    });
    const preview = createMermaidPreview(nodeStub('graph TD\nA-->B'));
    document.body.appendChild(preview.dom);
    Object.defineProperty(preview.dom, 'offsetParent', { value: null, configurable: true });
    preview.update?.(nodeStub('graph TD\nA-->B'), previewContext());
    await flush();
    const mermaidCallsBefore = engines.mermaid.render.mock.calls.length;
    expect(preview.dom.innerHTML).toContain('data-engine="mermaid"');

    engines.current = engines.pele;
    registration.refresh?.();
    await flush();

    expect(engines.pele.render).not.toHaveBeenCalled();
    expect(engines.mermaid.render.mock.calls.length).toBe(mermaidCallsBefore);
    expect(preview.dom.innerHTML).toContain('data-engine="mermaid"');
  });
});
