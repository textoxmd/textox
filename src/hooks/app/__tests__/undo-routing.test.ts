import { describe, expect, it, afterEach } from 'vitest';
import { resolveUndoRoute } from '../core/undoRoute';

// 原生菜单/系统快捷键的撤销要按焦点落点：编辑器（统一历史）或浏览器原生。
describe('undo 路由', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('普通输入框走原生撤销', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(resolveUndoRoute(input, false)).toBe('native');
  });

  it('textarea / select 也走原生', () => {
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    document.body.append(textarea, select);
    expect(resolveUndoRoute(textarea, false)).toBe('native');
    expect(resolveUndoRoute(select, false)).toBe('native');
  });

  it('编辑器内容区走编辑器', () => {
    const root = document.createElement('div');
    root.className = 'cm-editor';
    const content = document.createElement('div');
    content.contentEditable = 'true';
    root.appendChild(content);
    document.body.appendChild(root);
    expect(resolveUndoRoute(content, true)).toBe('editor');
  });

  it('焦点在编辑器里时始终走编辑器', () => {
    const root = document.createElement('div');
    root.className = 'prosemirror-editor-container';
    const content = document.createElement('div');
    content.contentEditable = 'true';
    root.appendChild(content);
    document.body.appendChild(root);
    expect(resolveUndoRoute(content, true)).toBe('editor');
  });

  it('对话框里的 contenteditable 走原生', () => {
    const editorRoot = document.createElement('div');
    editorRoot.className = 'prosemirror-editor-container';
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    dialog.appendChild(editable);
    document.body.append(editorRoot, dialog);
    expect(resolveUndoRoute(editable, false)).toBe('native');
  });

  it('焦点在侧边栏时仍作用于文档编辑器', () => {
    expect(resolveUndoRoute(document.body, false)).toBe('editor');
  });
});
