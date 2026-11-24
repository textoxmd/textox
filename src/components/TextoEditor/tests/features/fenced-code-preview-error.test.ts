import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { registerContributions, resetExtensionPointsForTests } from '@texto/plugin-sdk';
import {
  MARKDOWN_EDITOR_EXTENSION,
  defineCodeBlockExtension,
} from '@texto/markdown-editor-api';

import { defaultPlugins } from '../../src/editor.ts';
import { parse } from '../../src/parser.ts';
import { getSchema } from '../../src/schema.ts';
import { bootstrapPluginsForTests } from '../plugins-setup';

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});

beforeEach(() => {
  bootstrapPluginsForTests();
});

afterEach(() => {
  resetExtensionPointsForTests();
});

/**
 * 回归：异步预览失败（如 mermaid 语法不完整）时，编辑器不得进入
 * 「错误回写 NodeView 根 DOM → PM 视作正文变更 → 重建 NodeView → 再报错」的
 * 无界重建循环——真实环境下该循环会跑满主线程，整个编辑器卡死。
 */
describe('fenced code preview error handling', () => {
  it('异步预览报错后不重建 NodeView，且错误提示只挂一次', async () => {
    let created = 0;
    let errors = 0;

    registerContributions('test.preview-error', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        defineCodeBlockExtension({
          id: 'test.previewError',
          languages: ['mermaid'],
          createPreview: () => {
            created += 1;
            const dom = document.createElement('div');
            return {
              dom,
              update(_node, ctx) {
                setTimeout(() => {
                  errors += 1;
                  ctx.onError('boom');
                }, 0);
              },
            };
          },
        }),
      ],
    } as never);

    const doc = parse('```mermaid\ngraph TD\nA-->\n```\n\n后文\n');
    const state = EditorState.create({
      schema,
      doc,
      plugins: defaultPlugins({ cursorWidget: false }),
    });
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    try {
      // 光标移出代码块 → 进入渲染态 → 触发异步预览
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, view.state.doc.content.size - 1),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 150));
      const createdAfterFirstWait = created;
      const errorsAfterFirstWait = errors;

      // 报错后视图必须稳定：不得持续重建 NodeView（否则主线程跑满、编辑器卡死）
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(created).toBe(createdAfterFirstWait);
      expect(created).toBeLessThanOrEqual(2);
      expect(errors).toBe(errorsAfterFirstWait);
      expect(errors).toBeLessThanOrEqual(2);
      // 错误提示已挂在当前（未被重建的）NodeView 上
      expect(mount.querySelector('.cb-render-error')).toBeTruthy();
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});
