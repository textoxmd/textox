import { beforeAll, describe, expect, test } from "vitest";
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

const md = "```js\nconst a = 1;\n```\n\n正文段落内容\n\n```python\nprint('hi')\n```";

function blockRanges(editor: Editor): { pos: number; size: number }[] {
  const out: { pos: number; size: number }[] = [];
  editor.view.state.doc.descendants((node: any, pos: number) => {
    if (node.type.name === "code_block") out.push({ pos, size: node.nodeSize });
    return true;
  });
  return out;
}

function hljsSpans(host: HTMLElement, lang: string): number {
  return host.querySelectorAll(`pre[data-lang="${lang}"] code [class^="hljs-"]`).length;
}

function dispatchPositions(editor: Editor, positions: number[]): void {
  editor.view.dispatch(
    editor.view.state.tr.setMeta("hljsRecompute", { invalidate: false, positions }),
  );
}

describe("编辑其他内容时代码块高亮保持稳定", () => {
  test("编辑段落（文档变化）后，已高亮代码块立即保持高亮", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: md });

    const [b1] = blockRanges(editor);
    dispatchPositions(editor, [b1.pos]);
    const before = hljsSpans(host, "js");
    expect(before).toBeGreaterThan(0);

    // 在正文段落中插入文本（普通文档变化事务，不带 hljs meta）
    const [b2] = blockRanges(editor).slice(1);
    const paraTextPos =
      editor.view.state.doc.textBetween(b1.pos + b1.size, b2.pos).indexOf("正文段落内容") +
      b1.pos + b1.size;
    editor.view.dispatch(
      editor.view.state.tr.insertText("额外文本 ", paraTextPos),
    );

    const after = hljsSpans(host, "js");
    expect(after).toBe(before);

    editor.destroy();
    host.remove();
  });

  test("编辑其他内容后，所有未受影响代码块的高亮都保留（位置随事务映射）", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: md });

    const ranges = blockRanges(editor);
    dispatchPositions(editor, ranges.map((r) => r.pos));
    const jsBefore = hljsSpans(host, "js");
    const pyBefore = hljsSpans(host, "python");
    expect(jsBefore).toBeGreaterThan(0);
    expect(pyBefore).toBeGreaterThan(0);

    const [b1, b2] = ranges;
    const paraTextPos =
      editor.view.state.doc.textBetween(b1.pos + b1.size, b2.pos).indexOf("正文段落内容") +
      b1.pos + b1.size;
    editor.view.dispatch(
      editor.view.state.tr.insertText("额外文本 ", paraTextPos),
    );

    expect(hljsSpans(host, "js")).toBe(jsBefore);
    expect(hljsSpans(host, "python")).toBe(pyBefore);

    editor.destroy();
    host.remove();
  });

  test("直接编辑代码块内部只清掉该块高亮，其他块不受影响，且可见时重新高亮", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: md });

    const ranges = blockRanges(editor);
    dispatchPositions(editor, ranges.map((r) => r.pos));
    const jsBefore = hljsSpans(host, "js");
    const pyBefore = hljsSpans(host, "python");
    expect(jsBefore).toBeGreaterThan(0);
    expect(pyBefore).toBeGreaterThan(0);

    // 在第一个代码块内部插入文本
    const insidePos = ranges[0].pos + 1;
    editor.view.dispatch(
      editor.view.state.tr.insertText("let ", insidePos),
    );

    // 该块内容已变化，旧高亮被丢弃（等待重新高亮）
    expect(hljsSpans(host, "js")).toBe(0);
    // 其他块保持
    expect(hljsSpans(host, "python")).toBe(pyBefore);

    // 模拟 recompute 补高亮：可见的新位置代码块重新高亮
    const [newB1] = blockRanges(editor);
    dispatchPositions(editor, [newB1.pos]);
    expect(hljsSpans(host, "js")).toBeGreaterThan(0);
    expect(hljsSpans(host, "python")).toBe(pyBefore);

    editor.destroy();
    host.remove();
  });
});
