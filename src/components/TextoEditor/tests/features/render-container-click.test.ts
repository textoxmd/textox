// 回归：渲染容器（mermaid/math/嵌入图）与代码块的位置绑定 + 错误态点击。
//
// 真机缺陷：部分 mermaid 图点击后光标没有进入代码块，编辑器跳回文档头部。
// 根因有两层：
//   1) 错误态（cb-error-mode）下渲染容器仍可见（保留上一张图），但 mousedown
//      守卫只在 `mode === "render"` 时 preventDefault；错误态下点击会落到浏览器
//      默认插入点（NodeView 的 stopEvent 只拦 PM，不拦浏览器默认行为），PM 的
//      DOM 观察器随后把 DOM 选区同步成文档开头 ⇒ 光标丢失 + 视口回顶。
//   2) 异步预览失败晚于「点击进入源码态」，showRenderError 无条件抢走 code 态，
//      把正在编辑的源码区和错误面板同时点亮，布局/选区一起被打乱。
//
// 修复后语义：
//   - 渲染容器上的左键 mousedown 一律 preventDefault（任何 mode 都不让浏览器
//     放置插入点）；render/error 态都进入源码态，code 态只吞默认行为。
//   - 进入源码态必须先切换可见性再派发选区，保证 DOM 选区落在可见内容里。
//   - 位置解析 getPos() 失效/越界时回退到 NodeView 根 DOM（posAtDOM），
//     仍无法解析则不动选区（绝不放行默认行为）。
//   - 异步报错不得覆盖用户已经进入的 code 态。
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { defineCodeBlockExtension, defineEmbedExtension } from "@texto/markdown-editor-api";
import type {
  EditorExtension,
  PreviewContext,
  PreviewRegion,
} from "@texto/markdown-editor-api";
import { resetExtensionPointsForTests } from "@texto/plugin-sdk";

import { parse } from "../../src/parser.ts";
import { getSchema } from "../../src/schema.ts";
import { defaultPlugins } from "../../src/editor.ts";
import { focusBlockStart } from "../../src/features/render-container.ts";
import { setEditorExtensions } from "../helpers/editor-extensions.ts";
import { bootstrapPluginsForTests } from "../plugins-setup";

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

const MD = "para\n\n```mermaid\ngraph TD;\n```\n";

function makeExt(options: {
  onUpdate?: (ctx: PreviewContext) => void;
} = {}): EditorExtension {
  return defineCodeBlockExtension({
    id: "test.render-container-click",
    languages: ["mermaid"],
    createPreview: (): PreviewRegion => ({
      dom: document.createElement("div"),
      update: (_node, ctx) => options.onUpdate?.(ctx),
    }),
  });
}

function mountDoc(md: string, exts: EditorExtension[]) {
  setEditorExtensions(exts);
  const doc = parse(md);
  const state = EditorState.create({
    schema,
    doc,
    // 前置段落让初始选区落在目标块之外；否则 NodeView 初始化就会进 code 模式。
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

function leftClick(el: HTMLElement): MouseEvent {
  const ev = new MouseEvent("mousedown", {
    button: 0,
    bubbles: true,
    cancelable: true,
  });
  el.dispatchEvent(ev);
  return ev;
}

function codeBlockPos(doc: EditorState["doc"]): number {
  let pos = -1;
  doc.forEach((node, offset) => {
    if (node.type.name === "code_block" && pos < 0) pos = offset;
  });
  return pos;
}

describe("render container click: error mode", () => {
  it("错误态下点击可见的图：阻止默认行为并进入源码态（光标在块首）", () => {
    const { view, mount } = mountDoc(
      MD,
      [
        makeExt({
          onUpdate: (ctx) => ctx.onError("boom"),
        }),
      ],
    );
    try {
      const pre = view.dom.querySelector("pre.cb-error-mode") as HTMLElement;
      expect(pre).toBeTruthy();
      const rc = view.dom.querySelector(".cb-render-container") as HTMLElement;
      expect(rc).toBeTruthy();
      // 错误态仍保留渲染容器（上一张图 / 错误面板都在这里）
      expect(rc.style.display).not.toBe("none");
      expect(view.state.selection.from).toBe(1);

      const pos = codeBlockPos(view.state.doc);
      const ev = leftClick(rc);

      // 浏览器不得放置插入点（否则 PM 会把 DOM 选区同步成文档开头）。
      expect(ev.defaultPrevented).toBe(true);
      expect(view.state.selection.from).toBe(pos + 1);
      expect(view.dom.querySelector(".cb-code-mode")).toBeTruthy();
      expect(view.dom.querySelector(".cb-error-mode")).toBeNull();
      expect(view.dom.querySelector(".cb-render-error")).toBeNull();
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("异步报错晚于进入源码态：不抢走 code 态、不并置错误面板", () => {
    let ctxRef: PreviewContext | null = null;
    const { view, mount } = mountDoc(
      MD,
      [
        makeExt({
          onUpdate: (ctx) => {
            ctxRef = ctx;
          },
        }),
      ],
    );
    try {
      const rc = view.dom.querySelector(".cb-render-container") as HTMLElement;
      expect(rc).toBeTruthy();
      const pos = codeBlockPos(view.state.doc);

      // 用户左键进入源码态
      leftClick(rc);
      expect(view.dom.querySelector(".cb-code-mode")).toBeTruthy();
      expect(view.state.selection.from).toBe(pos + 1);

      // 此前那次预览的异步失败回调此刻才到达
      ctxRef!.onError("late failure");

      expect(view.dom.querySelector(".cb-code-mode")).toBeTruthy();
      expect(view.dom.querySelector(".cb-error-mode")).toBeNull();
      expect(view.dom.querySelector(".cb-render-error")).toBeNull();
      // 渲染容器必须保持隐藏，源码区保持可见（不得出现叠层/布局跳变）
      expect(rc.style.display).toBe("none");
      expect(
        (view.dom.querySelector(".cb-code-mode code") as HTMLElement).style.display,
      ).not.toBe("none");
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});

describe("render container click: embed error mode", () => {
  function makeErrorEmbed(): EditorExtension {
    return defineEmbedExtension({
      id: "test.embed.error-click",
      extensions: [".excalidraw"],
      insertLabelKey: "x.insert",
      matches: (src) => src.toLowerCase().endsWith(".excalidraw"),
      createPreview: (): PreviewRegion => ({
        dom: document.createElement("div"),
        update: (_node, ctx) => ctx.onError("boom"),
      }),
    });
  }

  it("嵌入图错误态下点击：阻止默认行为并进入源码态", () => {
    const { view, mount } = mountDoc("para\n\n![alt](a.excalidraw)\n", [
      makeErrorEmbed(),
    ]);
    try {
      const rc = view.dom.querySelector(".image-ref-render") as HTMLElement;
      const src = view.dom.querySelector(".image-ref-source") as HTMLElement;
      expect(rc).toBeTruthy();
      expect(view.dom.querySelector(".image-ref-error")).toBeTruthy();

      const pos = (() => {
        let p = -1;
        view.state.doc.forEach((node, offset) => {
          if (node.type.name === "image_ref" && p < 0) p = offset;
        });
        return p;
      })();
      expect(pos).toBeGreaterThan(0);

      const ev = leftClick(rc);

      expect(ev.defaultPrevented).toBe(true);
      expect(view.state.selection.from).toBe(pos + 1);
      expect(src.style.display).not.toBe("none");
      expect(rc.style.display).toBe("none");
      // 错误节点仍在（隐藏的）渲染容器内，随下次重新渲染重建；关键是它不可见。
      expect((view.dom.querySelector(".image-ref-error") as HTMLElement).closest(".image-ref-render")).toBe(rc);
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});

describe("focusBlockStart: position binding", () => {
  function mountWithBlock() {
    return mountDoc(MD, [makeExt()]);
  }

  it("getPos() 缺失时回退到 NodeView 根 DOM 解析块内位置", () => {
    const { view, mount } = mountWithBlock();
    try {
      const pos = codeBlockPos(view.state.doc);
      const pre = view.nodeDOM(pos) as HTMLElement;
      expect(pre).toBeTruthy();

      focusBlockStart(view, undefined, pre);

      expect(view.state.selection.from).toBe(pos + 1);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("getPos() 越界（文档已变化）时不抛异常，并回退到 DOM 位置", () => {
    const { view, mount } = mountWithBlock();
    try {
      const pos = codeBlockPos(view.state.doc);
      const pre = view.nodeDOM(pos) as HTMLElement;

      expect(() => focusBlockStart(view, 999_999, pre)).not.toThrow();

      expect(view.state.selection.from).toBe(pos + 1);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("位置与 DOM 都无法解析时保持选区不变且不抛异常", () => {
    const { view, mount } = mountWithBlock();
    try {
      const before = view.state.selection.from;
      expect(() => focusBlockStart(view, undefined, undefined)).not.toThrow();
      expect(view.state.selection.from).toBe(before);
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});
