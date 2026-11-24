import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView, type NodeView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { registerContributions, resetExtensionPointsForTests } from '@texto/plugin-sdk';
import {
  MARKDOWN_EDITOR_EXTENSION,
  defineCodeBlockExtension,
  defineEmbedExtension,
} from '@texto/markdown-editor-api';

import { declareMarkdownEditorExtensionPoint } from '../src/extension/registry';
import { getLangFocus } from '../src/features/fenced-code.ts';
import { parse } from '../src/parser.ts';
import { getSchema } from '../src/schema.ts';

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});
import { defaultPlugins } from '../src/editor.ts';
import { bootstrapPluginsForTests } from './plugins-setup';

beforeEach(() => {
  bootstrapPluginsForTests();
});

afterEach(() => {
  resetExtensionPointsForTests();
  vi.restoreAllMocks();
});

/** 标记 DOM 认领者：`data-ext="<tag>"` 便于断言哪个工厂生效。 */
function markerNodeView(tag: string): NodeView {
  const dom = document.createElement('div');
  dom.setAttribute('data-ext', tag);
  const contentDOM = document.createElement('code');
  dom.appendChild(contentDOM);
  return { dom, contentDOM };
}

/** 构造一个向 `type` 贡献标记 NodeView 的扩展；`accepts` 为 false 时返回 null（不认领）。 */
function claimingExtension(
  id: string,
  type: 'code_block' | 'image_ref',
  tag: string,
  accepts: (node: PMNode) => boolean = () => true,
) {
  return {
    id,
    create: () => ({
      nodeViews: {
        [type]: (
          node: PMNode,
          _view: EditorView,
          _getPos: () => number | undefined,
        ): NodeView | null => (accepts(node) ? markerNodeView(tag) : null),
      },
    }),
  };
}

function withView(doc: PMNode, fn: (mount: HTMLElement, view: EditorView) => void): void {
  const state = EditorState.create({
    schema,
    doc,
    plugins: defaultPlugins({ cursorWidget: false }),
  });
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const view = new EditorView(mount, { state });
  try {
    fn(mount, view);
  } finally {
    view.destroy();
    mount.remove();
  }
}

async function withViewAsync(
  doc: PMNode,
  fn: (mount: HTMLElement, view: EditorView) => Promise<void>,
): Promise<void> {
  const state = EditorState.create({
    schema,
    doc,
    plugins: defaultPlugins({ cursorWidget: false }),
  });
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const view = new EditorView(mount, { state });
  try {
    await fn(mount, view);
  } finally {
    view.destroy();
    mount.remove();
  }
}

/**
 * 改写首个 image_ref 节点的源码文本。用真实事务触发 NodeView.update，
 * 从而走到「嵌入归属变化 → 返回 false → PM 重建视图」的路径。
 */
function replaceFirstImageRefText(view: EditorView, text: string): void {
  let from = -1;
  let to = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'image_ref') return true;
    from = pos + 1;
    to = pos + 1 + node.textContent.length;
    return false;
  });
  if (from < 0) throw new Error('no image_ref node in doc');
  view.dispatch(view.state.tr.replaceWith(from, to, schema.text(text)));
}

describe('nodeViews dispatch', () => {
  it('uses an extension-contributed code_block node view', () => {
    declareMarkdownEditorExtensionPoint();
    registerContributions('ext', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        claimingExtension('ext.cb', 'code_block', 'cb', (n) => n.attrs.lang === 'mermaid'),
      ],
    } as never);

    withView(parse('```mermaid\ngraph TD;\n```\n'), (mount) => {
      expect(mount.querySelector('[data-ext="cb"]')).toBeTruthy();
    });
  });

  it('falls back to the built-in code block view for non-claimed languages', () => {
    declareMarkdownEditorExtensionPoint();
    registerContributions('ext', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        claimingExtension('ext.cb', 'code_block', 'cb', (n) => n.attrs.lang === 'mermaid'),
      ],
    } as never);

    withView(parse('```javascript\nconst x = 1;\n```\n'), (mount) => {
      expect(mount.querySelector('[data-ext="cb"]')).toBeNull();
      expect(mount.querySelector('.cb-lang-input')).toBeTruthy();
    });
  });

  it('dispatches image_ref contributions and falls back to the built-in view', () => {
    const doc = '前文\n\n![](x.excalidraw)\n\n后文';

    declareMarkdownEditorExtensionPoint();
    registerContributions('ext', {
      [MARKDOWN_EDITOR_EXTENSION]: [claimingExtension('ext.img', 'image_ref', 'img')],
    } as never);
    withView(parse(doc), (mount) => {
      expect(mount.querySelector('[data-ext="img"]')).toBeTruthy();
    });

    // 工厂不认领（返回 null）→ 回退内置 image_ref 视图
    resetExtensionPointsForTests();
    declareMarkdownEditorExtensionPoint();
    registerContributions('ext', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        claimingExtension('ext.img', 'image_ref', 'img', () => false),
      ],
    } as never);
    withView(parse(doc), (mount) => {
      expect(mount.querySelector('[data-ext="img"]')).toBeNull();
      expect(mount.querySelector('.image-ref-block')).toBeTruthy();
    });
  });

  it('prefers the last-registered contribution (reverse order)', () => {
    declareMarkdownEditorExtensionPoint();
    registerContributions('ext', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        claimingExtension('z', 'code_block', 'z'),
        claimingExtension('a', 'code_block', 'a'),
      ],
    } as never);

    withView(parse('```javascript\nconst x = 1;\n```\n'), (mount) => {
      expect(mount.querySelector('[data-ext="a"]')).toBeTruthy();
      expect(mount.querySelector('[data-ext="z"]')).toBeNull();
    });
  });

  it('isolates constructor failures and falls back to the built-in view', () => {
    declareMarkdownEditorExtensionPoint();
    const boom = {
      id: 'boom',
      create: () => ({
        nodeViews: {
          code_block: (): NodeView => {
            throw new Error('boom');
          },
        },
      }),
    };
    registerContributions('ext', {
      [MARKDOWN_EDITOR_EXTENSION]: [boom],
    } as never);

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    withView(parse('```javascript\nconst x = 1;\n```\n'), (mount) => {
      expect(mount.querySelector('.cb-lang-input')).toBeTruthy();
    });
    expect(spy).toHaveBeenCalled();
  });

  it('rebuilds the node view when a built-in code block switches to a claimed language', () => {
    declareMarkdownEditorExtensionPoint();
    registerContributions('ext', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        claimingExtension('ext.cb', 'code_block', 'cb', (n) => n.attrs.lang === 'mermaid'),
      ],
    } as never);

    withView(parse('```javascript\nconst x = 1;\n```\n'), (mount, view) => {
      expect(mount.querySelector('[data-ext="cb"]')).toBeNull();
      expect(mount.querySelector('.cb-lang-input')).toBeTruthy();

      // 顶层代码块节点位置为 0
      view.dispatch(view.state.tr.setNodeAttribute(0, 'lang', 'mermaid'));

      expect(mount.querySelector('[data-ext="cb"]')).toBeTruthy();
      expect(mount.querySelector('.cb-lang-input')).toBeNull();
    });
  });

  it('tears down the claimed node view when switching back to a built-in language', () => {
    declareMarkdownEditorExtensionPoint();
    registerContributions('ext', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        claimingExtension('ext.cb', 'code_block', 'cb', (n) => n.attrs.lang === 'mermaid'),
      ],
    } as never);

    withView(parse('```mermaid\ngraph TD;\n```\n'), (mount, view) => {
      expect(mount.querySelector('[data-ext="cb"]')).toBeTruthy();
      expect(mount.querySelector('.cb-lang-input')).toBeNull();

      // 顶层代码块节点位置为 0
      view.dispatch(view.state.tr.setNodeAttribute(0, 'lang', 'javascript'));

      expect(mount.querySelector('[data-ext="cb"]')).toBeNull();
      expect(mount.querySelector('.cb-lang-input')).toBeTruthy();
    });
  });

  it('rebuilds a real CodeBlockView with a PreviewRegion when switching to a claimed language', () => {
    declareMarkdownEditorExtensionPoint();
    registerContributions('ext', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        defineCodeBlockExtension({
          id: 'm',
          languages: ['mermaid'],
          createPreview: () => {
            const dom = document.createElement('div');
            dom.setAttribute('data-preview', 'mermaid');
            return { dom };
          },
        }),
      ],
    } as never);

    withView(parse('```javascript\nconst x = 1;\n```\n'), (mount, view) => {
      expect(mount.querySelector('.cb-render-container')).toBeNull();
      expect(mount.querySelector('.cb-lang-input')).toBeTruthy();

      // 顶层代码块节点位置为 0
      view.dispatch(view.state.tr.setNodeAttribute(0, 'lang', 'mermaid'));

      expect(mount.querySelector('.cb-render-container')).toBeTruthy();
      expect(mount.querySelector('[data-preview="mermaid"]')).toBeTruthy();

      view.dispatch(view.state.tr.setNodeAttribute(0, 'lang', 'javascript'));

      expect(mount.querySelector('.cb-render-container')).toBeNull();
      expect(mount.querySelector('.cb-lang-input')).toBeTruthy();
      expect(getLangFocus(view.state)).toBeNull();
    });
  });

  it('does not rebuild while typing, then commits the typed claimed language on blur', async () => {
    declareMarkdownEditorExtensionPoint();
    registerContributions('ext', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        defineCodeBlockExtension({
          id: 'm',
          languages: ['mermaid'],
          createPreview: () => {
            const dom = document.createElement('div');
            dom.setAttribute('data-preview', 'mermaid');
            return { dom };
          },
        }),
      ],
    } as never);

    await withViewAsync(parse('```javascript\nconst x = 1;\n```\n'), async (mount, view) => {
      const input = mount.querySelector('.cb-lang-input') as HTMLInputElement;
      input.focus();

      // 输入过程中不提交 lang、不重建 NodeView（焦点保持在输入框）
      input.value = 'mermaid';
      input.dispatchEvent(new Event('input'));
      expect(document.activeElement).toBe(input);
      expect(view.state.doc.firstChild!.attrs.lang).toBe('javascript');
      expect(mount.querySelector('.cb-render-container')).toBeNull();

      // 失焦提交 → 重建为认领视图并出现预览
      input.blur();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(view.state.doc.firstChild!.attrs.lang).toBe('mermaid');
      expect(mount.querySelector('[data-preview="mermaid"]')).toBeTruthy();
    });
  });

  it('rebuilds a real ImageRefNodeView when the embed ownership changes on edit', () => {
    declareMarkdownEditorExtensionPoint();
    registerContributions('ext', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        defineEmbedExtension({
          id: 'e',
          extensions: ['.excalidraw'],
          insertLabelKey: 'k',
          matches: (src) => src.endsWith('.excalidraw'),
          createPreview: () => {
            const dom = document.createElement('div');
            dom.setAttribute('data-embed-preview', '');
            return { dom, update() {} };
          },
        }),
      ],
    } as never);

    // 前置段落让初始光标落在 image_ref 之外（预览态）；用直链图片，
    // 无需 documentPath / convertFileSrc 即可得到真实 <img>。
    withView(parse('前文\n\n![](a.excalidraw)'), (mount, view) => {
      // 初始：嵌入扩展认领 → 渲染 PreviewRegion
      expect(mount.querySelector('[data-embed-preview]')).toBeTruthy();
      expect(mount.querySelector('img.image-ref-img')).toBeNull();

      // src 改为普通图片 → update 判定归属变化 → PM 重建为内置视图
      replaceFirstImageRefText(view, '![](https://example.com/a.png)');
      expect(mount.querySelector('[data-embed-preview]')).toBeNull();
      expect(mount.querySelector('img.image-ref-img')).toBeTruthy();

      // 反向：普通图片改回嵌入 → 再次经 update 重建为嵌入视图
      replaceFirstImageRefText(view, '![](b.excalidraw)');
      expect(mount.querySelector('[data-embed-preview]')).toBeTruthy();
      expect(mount.querySelector('img.image-ref-img')).toBeNull();
    });
  });

  it('clears langFocus after picking a built-in language from the dropdown', async () => {
    await withViewAsync(parse('```javascript\nconst x = 1;\n```\n'), async (mount, view) => {
      const input = mount.querySelector('.cb-lang-input') as HTMLInputElement;
      input.dispatchEvent(new FocusEvent('focus'));
      // 空查询展示完整语言列表（精确匹配会按设计隐藏下拉）
      input.value = '';
      input.dispatchEvent(new Event('input'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      const item = Array.from(mount.querySelectorAll('.cb-lang-item')).find(
        (i) => (i as HTMLElement).textContent === 'TypeScript',
      ) as HTMLElement;
      expect(item).toBeTruthy();
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(view.state.doc.nodeAt(0)?.attrs.lang).toBe('typescript');
      expect(getLangFocus(view.state)).toBeNull();
      expect(mount.querySelector('.cb-lang-input')).toBeTruthy();
    });
  });

  it('surfaces synchronous PreviewRegion.update errors without crashing', async () => {
    declareMarkdownEditorExtensionPoint();
    registerContributions('ext', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        defineCodeBlockExtension({
          id: 'm',
          languages: ['mermaid'],
          createPreview: () => {
            const dom = document.createElement('div');
            dom.setAttribute('data-preview', 'mermaid');
            return {
              dom,
              update() {
                throw new Error('boom');
              },
            };
          },
        }),
      ],
    } as never);

    await withViewAsync(parse('```mermaid\ngraph TD;\n```\n\n后文'), async (mount, view) => {
      expect(mount.querySelector('.cb-render-error')).toBeNull();
      // 光标移出代码块 → 进入渲染态 → 同步抛错被 runPreview 捕获
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, view.state.doc.content.size - 1),
        ),
      );
      expect(mount.querySelector('.cb-render-error')).toBeTruthy();
    });
  });
});
