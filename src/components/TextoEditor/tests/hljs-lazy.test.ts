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

const md = "```js\nconst a = 1;\n```\n\n正文段落\n\n```python\nprint('hi')\n```";

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

function dispatchPositions(editor: Editor, positions: number[], invalidate = false): void {
  editor.view.dispatch(
    editor.view.state.tr.setMeta("hljsRecompute", { invalidate, positions }),
  );
}

describe("代码块懒高亮", () => {
  test("初始不高亮任何代码块；按可见位置逐个懒高亮", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: md });

    const [b1, b2] = blockRanges(editor);
    expect(b1 && b2).toBeTruthy();

    // 懒加载：初始（无视口触发前）没有任何 hljs 装饰
    expect(hljsSpans(host, "js")).toBe(0);
    expect(hljsSpans(host, "python")).toBe(0);

    // 只有第一个代码块进入视口 → 只高亮它
    dispatchPositions(editor, [b1.pos]);
    expect(hljsSpans(host, "js")).toBeGreaterThan(0);
    expect(hljsSpans(host, "python")).toBe(0);

    // 第二个代码块进入视口 → 两个都高亮（不互相清除）
    dispatchPositions(editor, [b2.pos]);
    expect(hljsSpans(host, "python")).toBeGreaterThan(0);
    expect(hljsSpans(host, "js")).toBeGreaterThan(0);

    editor.destroy();
    host.remove();
  });

  test("文档变化(invalidate)后清空并按新可见位置重新高亮", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: md });

    const [b1, b2] = blockRanges(editor);
    dispatchPositions(editor, [b1.pos]);
    expect(hljsSpans(host, "js")).toBeGreaterThan(0);

    // 模拟文档变化后的重高亮：invalidate 清掉旧缓存，只高亮新的可见块
    dispatchPositions(editor, [b2.pos], true);
    expect(hljsSpans(host, "js")).toBe(0);
    expect(hljsSpans(host, "python")).toBeGreaterThan(0);

    editor.destroy();
    host.remove();
  });
});
