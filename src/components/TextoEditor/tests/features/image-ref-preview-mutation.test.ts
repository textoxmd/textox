import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { defineEmbedExtension } from "@texto/markdown-editor-api";
import type { PreviewRegion } from "@texto/markdown-editor-api";
import { resetExtensionPointsForTests } from "@texto/plugin-sdk";

import { parse } from "../../src/parser.ts";
import { getSchema } from "../../src/schema.ts";

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});
import { defaultPlugins } from "../../src/editor.ts";
import { setEditorExtensions } from "../helpers/editor-extensions.ts";

// 回归：白板预览在插入后会「异步」重写自身内容（读文件 → 渲染 SVG → setInnerHTML）。
// PM 对「带 contentDOM 的 NodeView」默认不忽略任何 DOM 变更，会把这类异步写入当成
// 文档编辑而重建 NodeView；新 NodeView 再次渲染 → 再异步写入 → 再重建……形成无界的
// 重渲染循环。真实白板每次循环还要同步跑 exportToSvg，主线程被占满，整个窗口卡死。
// 修复：NodeView 用 ignoreMutation 声明「只有 contentDOM 内的变更才是文档编辑」。

let buildCount = 0;

const mutatingEmbed = defineEmbedExtension({
  id: "mutating.embed",
  extensions: [".excalidraw"],
  insertLabelKey: "mutating.insert",
  matches: (src) => src.toLowerCase().endsWith(".excalidraw"),
  createPreview(): PreviewRegion {
    buildCount += 1;
    const dom = document.createElement("div");
    return {
      dom,
      update() {
        const el = document.createElement("div");
        el.className = "mutating-embed";
        // 模拟真实预览：插入后异步填充内容（这里是 SVG）。
        setTimeout(() => {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("data-test", "scene");
          el.replaceChildren(svg);
        }, 0);
        dom.replaceChildren(el);
      },
    };
  },
});

function mountDoc(md: string) {
  const doc = parse(md);
  const state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 1),
    plugins: defaultPlugins({
      cursorWidget: false,
      documentPath: "/Users/u/notes/note.md",
    }),
  });
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const view = new EditorView(mount, { state });
  return { view, mount };
}

describe("image-ref preview async mutation", () => {
  afterEach(() => {
    resetExtensionPointsForTests();
  });

  it("does not rebuild the NodeView when the preview mutates asynchronously", async () => {
    setEditorExtensions([mutatingEmbed]);
    buildCount = 0;
    const { view, mount } = mountDoc(
      "前文\n\n![](drawings/flow.excalidraw)\n\n后文",
    );
    try {
      await new Promise((r) => setTimeout(r, 200));
      // 修复前：异步 mutation 被 PM 当作文档编辑 → 重建 NodeView → build 反复触发（数百次）
      expect(buildCount).toBe(1);
      expect(mount.querySelector('[data-test="scene"]')).toBeTruthy();
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});
