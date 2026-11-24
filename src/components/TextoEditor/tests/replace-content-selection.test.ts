import { beforeAll, describe, expect, test } from "vitest";
import { TextSelection } from "prosemirror-state";
import type { Editor } from "../src/editor-api.ts";

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

// 打开文档时：init 用 initialContent 建 doc，随后 TextoEditor 的 setMarkdown 效果
// 因序列化 ≠ 原文（roundtrip 非恒等）触发 replaceContent 整篇替换。
// 回归：replaceContent 后选区应保持在文档开头，而不是被映射到文档末尾，
// 否则 restorePositionAndFocus 会对 domAtPos(末尾) 做 scrollIntoView 滚到底部。

const md = `# 标题

这是一段正文，包含 [链接](https://example.com)。

| a | b |
|---|---|
| 1 | 2 |

\`\`\`js
const a = 1;
\`\`\`

> 引用

- [x] 任务
`;

describe("replaceContent 选区回归", () => {
  test("setMarkdown 整篇替换后选区仍在文档开头（非末尾）", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: md });

    // roundtrip 不恒等时 TextoEditor 会调用 setMarkdown(content)
    expect(editor.getMarkdown()).not.toBe(md);
    editor.setMarkdown(md);

    const docSize = editor.view.state.doc.content.size;
    // 选区应在开头（第一个文本块内容起点），而非文档末尾
    expect(editor.view.state.selection.from).toBeLessThan(5);
    expect(editor.view.state.selection.from).not.toBe(docSize);

    editor.destroy();
    host.remove();
  });

  // 回归：chunk 追加 / 外部内容同步时整篇替换会重新 parse 文档。旧实现把选区
  // 硬重置到 atStart，等于丢掉用户点击/编辑的位置，随后光标跟随滚动把视口带回
  // 文档头部（点击 mermaid 图后「光标找不到代码块 + 跳回顶部」的放大路径）。
  test("运行期 setMarkdown 保留替换前的插入点", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: md });
    try {
      // 把光标放到代码块内容里（模拟用户刚点击图表进入源码态）
      const codePos = (() => {
        let pos = -1;
        editor.view.state.doc.forEach((node, offset) => {
          if (node.type.name === "code_block" && pos < 0) pos = offset;
        });
        return pos;
      })();
      expect(codePos).toBeGreaterThan(0);
      const caret = codePos + 1;
      editor.view.dispatch(
        editor.view.state.tr.setSelection(
          TextSelection.create(editor.view.state.doc, caret),
        ),
      );

      editor.setMarkdown(md);

      expect(editor.view.state.selection.from).toBe(caret);
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  test("chunk 追加（内容变长）后仍保留原插入点", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: md });
    try {
      const caret = 3; // 标题/正文附近
      editor.view.dispatch(
        editor.view.state.tr.setSelection(
          TextSelection.create(editor.view.state.doc, caret),
        ),
      );

      editor.setMarkdown(md + "\n## 追加章节\n\n更多内容。\n");

      expect(editor.view.state.selection.from).toBe(caret);
    } finally {
      editor.destroy();
      host.remove();
    }
  });
});
