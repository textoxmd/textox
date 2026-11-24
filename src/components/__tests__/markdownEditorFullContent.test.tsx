import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MarkdownEditor } from '../MarkdownEditor';
import type { TextoEditorRef } from '../TextoEditor/TextoEditorRef';

// 回归护栏：编辑器必须整篇渲染，不得再引入分块/窗口机制。
// 一旦有人重新加回「只加载首块」，末章节消失、保存内容被截断，这里的断言就会失败。

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
});

/** 20 个「标题 + 20 段」，约 130KB（远超旧分块阈值 100KB）。 */
function bigDocument(): string {
  const paragraph = 'lorem ipsum dolor sit amet '.repeat(40);
  let out = '';
  for (let i = 0; i < 20; i += 1) {
    out += `# Section ${i}\n\n`;
    for (let j = 0; j < 20; j += 1) out += `${paragraph}\n\n`;
  }
  return out;
}

async function mount(
  content: string,
  onChange: (md: string) => void = () => {},
): Promise<ReturnType<typeof createRef<TextoEditorRef>>> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const ref = createRef<TextoEditorRef>();
  await act(async () => {
    root!.render(createElement(MarkdownEditor, {
      content,
      documentPath: '/tmp/texto-full-content.md',
      editorMode: 'ir',
      onChange,
      ref,
    }));
  });
  return ref;
}

describe('大文档整篇渲染', () => {
  it('超过 100KB 的文档一次性载入全文（末章节也在编辑器里）', async () => {
    const content = bigDocument();
    const ref = await mount(content);
    const text = ref.current!.editorView!.state.doc.textContent;

    expect(text).toContain('Section 0');
    expect(text).toContain('Section 19');
  });

  it('保存点内容等于全文，不被截断', async () => {
    const content = bigDocument();
    const ref = await mount(content);
    const point = ref.current!.beginSavePoint();

    expect(point).not.toBeNull();
    expect(point!.content.split('\n').length).toBe(content.split('\n').length);
    expect(point!.content).toContain('Section 19');
  });

  it('编辑后上报的 onChange 仍是全文', async () => {
    const content = bigDocument();
    const seen: string[] = [];
    const ref = await mount(content, (md) => seen.push(md));

    const view = ref.current!.editorView!;
    act(() => {
      view.dispatch(view.state.tr.insertText('XYZ', 1, 1));
    });

    expect(seen).toHaveLength(1);
    const reported = seen[0]!;
    expect(reported).toContain('XYZ');
    expect(reported).toContain('Section 19');
    expect(reported.split('\n').length).toBe(content.trimEnd().split('\n').length);
  });
});
