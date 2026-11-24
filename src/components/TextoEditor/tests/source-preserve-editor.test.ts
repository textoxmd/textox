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

// editor-api 接入验证：sourcePreserve 打开后 getMarkdown/onChange 走
// serializePreserving，未编辑输出 === 原文；setMarkdown/replaceContent 重建
// 保真上下文。默认（未开启）行为保持 canonical serialize。

function replaceInView(editor: Editor, word: string, repl: string): void {
  const doc = editor.view.state.doc;
  let from = -1;
  let to = -1;
  doc.descendants((node, pos) => {
    if (from >= 0) return false;
    if (!node.isTextblock) return true;
    const idx = node.textContent.indexOf(word);
    if (idx >= 0) {
      from = pos + 1 + idx;
      to = from + word.length;
      return false;
    }
    return true;
  });
  if (from < 0) throw new Error(`word not found: ${word}`);
  const tr = editor.view.state.tr.insertText(repl, from, to);
  editor.view.dispatch(tr);
}

const mixed = "intro\n\n* a\n* b\n\noutro\n";

describe("editor-api source-preserve 接入", () => {
  test("开启后未编辑：getMarkdown === 原文（`*` 列表原样）", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: mixed, sourcePreserve: true });
    try {
      expect(editor.getMarkdown()).toBe(mixed);
      expect(editor.getMarkdown()).not.toContain("- a");
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  test("开启后改词：输出只在脏段变化（`*` 列表原文保留）", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: mixed, sourcePreserve: true });
    try {
      replaceInView(editor, "outro", "OUTRO");
      expect(editor.getMarkdown()).toBe(mixed.replace("outro", "OUTRO"));
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  test("开启后 headingLines 映射到保真输出行号", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, {
      initialContent: "# One\n\n- a\n\n- b\n\n# Two\n\ntext\n",
      sourcePreserve: true,
    });
    try {
      expect(editor.headingLines()).toEqual([1, 7]);
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  test("关闭时 headingLines 返回 null（回退 canonical）", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, {
      initialContent: "# One\n\n- a\n\n- b\n\n# Two\n\ntext\n",
    });
    try {
      expect(editor.headingLines()).toBeNull();
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  test("setMarkdown 后重建上下文：新原文未编辑输出 === 新文本", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: mixed, sourcePreserve: true });
    try {
      const newMd = "# T\n\n+ x\n+ y\n";
      editor.setMarkdown(newMd);
      expect(editor.getMarkdown()).toBe(newMd);
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  test("未开启（默认）：canonical 序列化但保留列表 marker", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: mixed });
    try {
      const md = editor.getMarkdown();
      expect(md).not.toBe(mixed);
      expect(md).toContain("* a");
      expect(md).toContain("* b");
    } finally {
      editor.destroy();
      host.remove();
    }
  });
});
