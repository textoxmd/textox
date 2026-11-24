import { beforeAll, describe, expect, test } from "vitest";
import { TextSelection } from "prosemirror-state";
import type { Editor } from "../src/editor-api.ts";
import { insertLinkTransaction } from "../src/features/link-insert.ts";

(window as any).__TAURI_INTERNALS__ = {
  transformCallback: () => 0,
  invoke: async () => undefined,
  convertFileSrc: () => "",
};
(window as any).__TAURI__ = {};

let createEditor: (host: HTMLElement, options?: any) => Editor;
beforeAll(async () => {
  const api = await import("../src/editor-api.ts");
  createEditor = api.createEditor;
});

// 工具栏"链接"按钮直接插入 `[text](url)` 源文本，不弹窗。
// 直接调用共享的 insertLinkTransaction，与 TextoEditor.tsx 中的真实实现一致。

function applyInsertLink(editor: Editor): void {
  const tr = insertLinkTransaction(editor.view.state);
  if (!tr) return;
  editor.view.dispatch(tr);
}

describe("insertLink 源文本插入", () => {
  test("有选区：选中文本被包装为 [text](url)，URL 占位符被选中，序列化后链接保留", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: "hello world" });

    const view = editor.view;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6))
    );
    applyInsertLink(editor);

    expect(editor.getMarkdown()).toBe("[hello](url) world");
    // 选区应落在 URL 占位符上，便于直接输入网址
    const sel = view.state.selection;
    expect(view.state.doc.textBetween(sel.from, sel.to)).toBe("url");

    editor.destroy();
    host.remove();
  });

  test("折叠光标：插入 [link text](url)，链接文字占位符被选中", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: "" });

    applyInsertLink(editor);

    expect(editor.getMarkdown()).toBe("[link text](url)");
    const sel = editor.view.state.selection;
    expect(editor.view.state.doc.textBetween(sel.from, sel.to)).toBe("link text");

    editor.destroy();
    host.remove();
  });

  test("光标在行内代码内：链接模板不继承 code mark，序列化后仍是独立链接", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: "`code`" });

    const view = editor.view;
    // 光标放到行内代码内部（`code` 的第 2 个字符位置）
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 3))
    );
    applyInsertLink(editor);

    expect(editor.getMarkdown()).toBe("`c[link text](url)ode`");

    editor.destroy();
    host.remove();
  });

  test("跨块选区：返回 null，不合并段落内容", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: "line one\n\nline two" });

    const view = editor.view;
    // 跨两个段落选中（第 1 段 pos 0..10，第 2 段 pos 10..20）
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 19))
    );
    const tr = insertLinkTransaction(view.state);
    expect(tr).toBeNull();

    editor.destroy();
    host.remove();
  });
});
