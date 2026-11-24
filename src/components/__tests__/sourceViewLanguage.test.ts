import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

import { SourceCodeEditor } from '@/components/TextoEditor/src/source-view';
import {
  getEditorHost,
  setEditorHost,
} from '@/components/TextoEditor/src/host';
import type {
  CodeLanguageSupport,
  EditorDialogOptions,
  EditorHost,
} from '@/components/TextoEditor/src/host';

// host 是模块级单例：本文件把宿主换成 stub，afterEach 必须复位，
// 否则后续用例（同进程内的其他测试文件共享模块图）会拿到假宿主。
const defaultHost = getEditorHost();

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function stubHost(overrides: Partial<EditorHost> = {}): EditorHost {
  return {
    getImageUploader: async () => null,
    resolveImageSrc: () => null,
    showDialog: async <T>(options: EditorDialogOptions<T>) =>
      options.dismissValue as T,
    saveMedia: async () => ({ saved: false }),
    ...overrides,
  };
}

function renderEditor() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  return { host, root };
}

const CONTENT = '```js\nconst a = 1\n```\n';

afterEach(() => {
  setEditorHost(defaultHost);
});

// 这里只验证「消费链路」：SV 挂载时向宿主请求语言表、并在 resolve 后完成重配。
// 不验证真实高亮结果——那依赖 @/utils/codeLanguages 的真实 chunk。
describe('SourceCodeEditor 语言包懒加载', () => {
  it('挂载时调用 loadCodeLanguageSupport，resolve 后不抛错', async () => {
    const resolver: CodeLanguageSupport = (lang) =>
      lang === 'js' ? ({ name: 'JS' } as never) : null;
    const load = vi.fn(async () => resolver);
    setEditorHost(stubHost({ loadCodeLanguageSupport: load }));

    const { host, root } = renderEditor();
    await act(async () => {
      root.render(
        createElement(SourceCodeEditor, { content: CONTENT, onChange: () => {} }),
      );
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.cm-editor')).not.toBeNull();

    // 等 provider resolve 后的 reconfigure 事务跑完
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector('.cm-editor')).not.toBeNull();

    act(() => root.unmount());
    host.remove();
  });

  it('卸载后才 resolve 不抛错', async () => {
    let resolveLoad: (value: CodeLanguageSupport | null) => void = () => {};
    const load = vi.fn(
      () =>
        new Promise<CodeLanguageSupport | null>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    setEditorHost(stubHost({ loadCodeLanguageSupport: load }));

    const { host, root } = renderEditor();
    await act(async () => {
      root.render(
        createElement(SourceCodeEditor, { content: CONTENT, onChange: () => {} }),
      );
    });
    expect(load).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    // 卸载后再 resolve：不得因已销毁的 view 抛错
    await act(async () => {
      resolveLoad(null);
      await Promise.resolve();
    });
    expect(host.querySelector('.cm-editor')).toBeNull();

    host.remove();
  });
});
