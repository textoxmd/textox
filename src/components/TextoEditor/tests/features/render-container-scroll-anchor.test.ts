// 渲染预览点击后的滚动对齐：
// 点击代码块 / 图片等渲染预览切源码后，首行应尽量落在点击的 clientY；
// 本文件同时护栏「点击事件 → focusBlockStart 透传 clientY」的接线，
// 覆盖 render / error / code / 只读四种态。
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  EditorState,
  Plugin,
  PluginKey,
  TextSelection,
} from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  defineCodeBlockExtension,
  defineEmbedExtension,
} from "@texto/markdown-editor-api";
import type { EditorExtension, PreviewRegion } from "@texto/markdown-editor-api";
import { resetExtensionPointsForTests } from "@texto/plugin-sdk";

import { parse } from "../../src/parser.ts";
import { getSchema } from "../../src/schema.ts";
import { defaultPlugins } from "../../src/editor.ts";
import { focusBlockStart } from "../../src/features/render-container.ts";
import { typewriterPluginKey } from "../../src/features/typewriter/index.ts";
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
const CARET = { top: 420, bottom: 438, left: 0, right: 10 };

function codePreviewExtension(options: { error?: boolean } = {}): EditorExtension {
  return defineCodeBlockExtension({
    id: "test.scroll-anchor",
    languages: ["mermaid"],
    createPreview: (): PreviewRegion => ({
      dom: document.createElement("div"),
      update: (_node, ctx) => {
        if (options.error) ctx.onError("boom");
      },
    }),
  });
}

function embedPreviewExtension(
  options: { error?: boolean } = {},
): EditorExtension {
  return defineEmbedExtension({
    id: "test.scroll-anchor.embed",
    extensions: [".excalidraw"],
    insertLabelKey: "x.insert",
    matches: (src) => src.toLowerCase().endsWith(".excalidraw"),
    createPreview: (): PreviewRegion => ({
      dom: document.createElement("div"),
      update: (_node, ctx) => {
        if (options.error) ctx.onError("boom");
      },
    }),
  });
}

function leftMousedown(el: HTMLElement, clientY: number): MouseEvent {
  const ev = new MouseEvent("mousedown", {
    button: 0,
    clientY,
    bubbles: true,
    cancelable: true,
  });
  el.dispatchEvent(ev);
  return ev;
}

const lockKey = new PluginKey<boolean>("test.scroll-anchor-lock");

function withEditable(editable: boolean): Plugin<boolean> {
  return new Plugin<boolean>({
    key: lockKey,
    state: {
      init: () => editable,
      apply: (tr, prev) => {
        const meta = tr.getMeta(lockKey);
        return meta !== undefined ? meta : prev;
      },
    },
    props: {
      editable: (state) => lockKey.getState(state) ?? true,
    },
  });
}

function mountDoc(
  md: string,
  exts: EditorExtension[],
  options: { editable?: boolean } = {},
) {
  setEditorExtensions(exts);
  const doc = parse(md);
  const editablePlugin = withEditable(options.editable ?? true);
  const state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 1),
    plugins: [
      editablePlugin,
      ...defaultPlugins({ cursorWidget: false, documentPath: "/tmp/note.md" }),
    ],
  });
  const mount = document.createElement("div");
  // 让 getScrollParent 走 overflowY 探测分支，而不是只验证兜底分支。
  mount.style.overflowY = "auto";
  document.body.appendChild(mount);
  // 抑制 ProseMirror 自身的 scrollIntoView：单测只验证后置对齐。
  const view = new EditorView(mount, {
    state,
    handleScrollToSelection: () => true,
  });
  return { view, mount };
}

function stubCaret(
  view: EditorView,
  top = CARET.top,
  bottom = top + 18,
): void {
  view.coordsAtPos = (() => ({
    ...CARET,
    top,
    bottom,
  })) as EditorView["coordsAtPos"];
}

function firstBlockPos(doc: EditorState["doc"], type: string): number {
  let pos = -1;
  doc.forEach((node, offset) => {
    if (node.type.name === type && pos < 0) pos = offset;
  });
  return pos;
}

describe("focusBlockStart: scroll anchor", () => {
  it("不给 anchorY 时不改滚动位置", () => {
    const { view, mount } = mountDoc(MD, [codePreviewExtension()]);
    try {
      stubCaret(view);
      mount.scrollTop = 0;
      const pos = firstBlockPos(view.state.doc, "code_block");
      const pre = view.nodeDOM(pos) as HTMLElement;

      focusBlockStart(view, pos, pre);

      expect(view.state.selection.from).toBe(pos + 1);
      expect(mount.scrollTop).toBe(0);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("按 coordsAtPos 与 anchorY 的差值修正 scrollTop", () => {
    const { view, mount } = mountDoc(MD, [codePreviewExtension()]);
    try {
      stubCaret(view, 420);
      mount.scrollTop = 0;
      const pos = firstBlockPos(view.state.doc, "code_block");
      const pre = view.nodeDOM(pos) as HTMLElement;

      focusBlockStart(view, pos, pre, 180);

      expect(mount.scrollTop).toBe(240);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("差值小于 1px 时不写 scrollTop", () => {
    const { view, mount } = mountDoc(MD, [codePreviewExtension()]);
    try {
      stubCaret(view, 100);
      mount.scrollTop = 0;
      const pos = firstBlockPos(view.state.doc, "code_block");
      const pre = view.nodeDOM(pos) as HTMLElement;

      focusBlockStart(view, pos, pre, 100.5);

      expect(mount.scrollTop).toBe(0);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("位置无法解析时不派发、不滚动", () => {
    const { view, mount } = mountDoc(MD, [codePreviewExtension()]);
    try {
      stubCaret(view);
      mount.scrollTop = 0;
      const before = view.state.selection.from;

      focusBlockStart(view, undefined, undefined, 180);

      expect(view.state.selection.from).toBe(before);
      expect(mount.scrollTop).toBe(0);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("在已有滚动位置上增量修正", () => {
    const { view, mount } = mountDoc(MD, [codePreviewExtension()]);
    try {
      stubCaret(view, 420);
      mount.scrollTop = 100;
      const pos = firstBlockPos(view.state.doc, "code_block");
      const pre = view.nodeDOM(pos) as HTMLElement;

      focusBlockStart(view, pos, pre, 180);

      // 校正量是 420 - 180 = 240，叠加在已有滚动位置上（不是直接赋值）。
      expect(mount.scrollTop).toBe(340);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("anchorY 非有限值时不滚动", () => {
    const { view, mount } = mountDoc(MD, [codePreviewExtension()]);
    try {
      stubCaret(view, 420);
      mount.scrollTop = 0;
      const pos = firstBlockPos(view.state.doc, "code_block");
      const pre = view.nodeDOM(pos) as HTMLElement;

      focusBlockStart(view, pos, pre, Number.NaN);
      expect(mount.scrollTop).toBe(0);

      focusBlockStart(view, pos, pre, Number.POSITIVE_INFINITY);
      expect(mount.scrollTop).toBe(0);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("coordsAtPos 抛错时不抛出且不滚动", () => {
    const { view, mount } = mountDoc(MD, [codePreviewExtension()]);
    try {
      view.coordsAtPos = (() => {
        throw new RangeError("stale");
      }) as EditorView["coordsAtPos"];
      mount.scrollTop = 0;
      const pos = firstBlockPos(view.state.doc, "code_block");
      const pre = view.nodeDOM(pos) as HTMLElement;

      expect(() => focusBlockStart(view, pos, pre, 180)).not.toThrow();
      expect(mount.scrollTop).toBe(0);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("dispatch 抛错时不抛出且不滚动", () => {
    const { view, mount } = mountDoc(MD, [codePreviewExtension()]);
    try {
      stubCaret(view, 420);
      mount.scrollTop = 0;
      const pos = firstBlockPos(view.state.doc, "code_block");
      const pre = view.nodeDOM(pos) as HTMLElement;
      const original = view.dispatch;
      view.dispatch = (() => {
        throw new Error("boom");
      }) as EditorView["dispatch"];

      expect(() => focusBlockStart(view, pos, pre, 180)).not.toThrow();
      expect(mount.scrollTop).toBe(0);

      view.dispatch = original;
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("祖先才是滚动容器时修正祖先", () => {
    const { view, mount } = mountDoc(MD, [codePreviewExtension()]);
    const outer = document.createElement("div");
    outer.style.overflowY = "auto";
    try {
      // mount 自身不再是滚动容器，向上探测应命中外层。
      mount.style.overflowY = "visible";
      outer.appendChild(mount);
      document.body.appendChild(outer);
      stubCaret(view, 420);
      outer.scrollTop = 0;
      mount.scrollTop = 0;
      const pos = firstBlockPos(view.state.doc, "code_block");
      const pre = view.nodeDOM(pos) as HTMLElement;

      focusBlockStart(view, pos, pre, 180);

      expect(outer.scrollTop).toBe(240);
      expect(mount.scrollTop).toBe(0);
    } finally {
      view.destroy();
      mount.remove();
      outer.remove();
    }
  });

  it("坐标退化（top/bottom 为 0）时不改滚动位置", () => {
    const { view, mount } = mountDoc(MD, [codePreviewExtension()]);
    try {
      stubCaret(view, 0, 0);
      mount.scrollTop = 100;
      const pos = firstBlockPos(view.state.doc, "code_block");
      const pre = view.nodeDOM(pos) as HTMLElement;

      focusBlockStart(view, pos, pre, 180);

      expect(view.state.selection.from).toBe(pos + 1);
      expect(mount.scrollTop).toBe(100);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("top 为 0 但 bottom 非 0 的真实行仍然参与对齐", () => {
    const { view, mount } = mountDoc(MD, [codePreviewExtension()]);
    try {
      stubCaret(view, 0, 18);
      mount.scrollTop = 100;
      const pos = firstBlockPos(view.state.doc, "code_block");
      const pre = view.nodeDOM(pos) as HTMLElement;

      focusBlockStart(view, pos, pre, 80);

      // delta = 0 - 80 = -80 ⇒ 100 - 80
      expect(mount.scrollTop).toBe(20);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("打字机模式开启时不做后置对齐", () => {
    const { view, mount } = mountDoc(MD, [codePreviewExtension()]);
    try {
      stubCaret(view, 420);
      view.dispatch(
        view.state.tr.setMeta(typewriterPluginKey, { enabled: true }),
      );
      // 开启打字机时插件会按虚拟留白调整一次 scrollTop，这里归零后验证对齐。
      mount.scrollTop = 0;
      const pos = firstBlockPos(view.state.doc, "code_block");
      const pre = view.nodeDOM(pos) as HTMLElement;

      focusBlockStart(view, pos, pre, 180);

      expect(mount.scrollTop).toBe(0);
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});

describe("render preview click: clientY anchor wiring", () => {
  it("代码块：首行对齐到点击位置", () => {
    const { view, mount } = mountDoc(MD, [codePreviewExtension()]);
    try {
      stubCaret(view, 420);
      mount.scrollTop = 0;
      const pos = firstBlockPos(view.state.doc, "code_block");
      const rc = view.dom.querySelector(".cb-render-container") as HTMLElement;
      expect(rc).toBeTruthy();

      const ev = leftMousedown(rc, 180);

      expect(ev.defaultPrevented).toBe(true);
      expect(view.state.selection.from).toBe(pos + 1);
      expect(mount.scrollTop).toBe(240);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("图片预览：首行对齐到点击位置", () => {
    const md = "para\n\n![alt](a.excalidraw)\n";
    const { view, mount } = mountDoc(md, [embedPreviewExtension()]);
    try {
      stubCaret(view, 400);
      mount.scrollTop = 0;
      const pos = firstBlockPos(view.state.doc, "image_ref");
      const rc = view.dom.querySelector(".image-ref-render") as HTMLElement;
      expect(rc).toBeTruthy();

      const ev = leftMousedown(rc, 100);

      expect(ev.defaultPrevented).toBe(true);
      expect(view.state.selection.from).toBe(pos + 1);
      expect(mount.scrollTop).toBe(300);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("错误态下点击图片预览：同样按点击位置对齐", () => {
    const md = "para\n\n![alt](a.excalidraw)\n";
    const { view, mount } = mountDoc(md, [embedPreviewExtension({ error: true })]);
    try {
      stubCaret(view, 400);
      mount.scrollTop = 0;
      const pos = firstBlockPos(view.state.doc, "image_ref");
      expect(view.dom.querySelector(".image-ref-error")).toBeTruthy();
      const rc = view.dom.querySelector(".image-ref-render") as HTMLElement;

      const ev = leftMousedown(rc, 100);

      expect(ev.defaultPrevented).toBe(true);
      expect(view.state.selection.from).toBe(pos + 1);
      expect(mount.scrollTop).toBe(300);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("错误态下点击代码块：同样按点击位置对齐", () => {
    const { view, mount } = mountDoc(MD, [codePreviewExtension({ error: true })]);
    try {
      stubCaret(view, 420);
      mount.scrollTop = 0;
      const pos = firstBlockPos(view.state.doc, "code_block");
      const pre = view.dom.querySelector("pre.cb-error-mode") as HTMLElement;
      expect(pre).toBeTruthy();
      const rc = view.dom.querySelector(".cb-render-container") as HTMLElement;

      const ev = leftMousedown(rc, 180);

      expect(ev.defaultPrevented).toBe(true);
      expect(view.state.selection.from).toBe(pos + 1);
      expect(mount.scrollTop).toBe(240);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("已在 code 态时再次点击渲染容器：只吞默认行为、不滚动", () => {
    const { view, mount } = mountDoc(MD, [codePreviewExtension()]);
    try {
      stubCaret(view, 420);
      mount.scrollTop = 0;
      const pos = firstBlockPos(view.state.doc, "code_block");
      const rc = view.dom.querySelector(".cb-render-container") as HTMLElement;

      leftMousedown(rc, 180);
      expect(mount.scrollTop).toBe(240);

      mount.scrollTop = 0;
      const ev = leftMousedown(rc, 180);

      expect(ev.defaultPrevented).toBe(true);
      expect(view.state.selection.from).toBe(pos + 1);
      expect(mount.scrollTop).toBe(0);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("只读模式下点击预览：不进入源码态、不滚动", () => {
    const { view, mount } = mountDoc(MD, [codePreviewExtension()], {
      editable: false,
    });
    try {
      expect(view.editable).toBe(false);
      stubCaret(view, 420);
      mount.scrollTop = 0;
      const rc = view.dom.querySelector(".cb-render-container") as HTMLElement;
      const before = view.state.selection.from;

      const ev = leftMousedown(rc, 180);

      expect(ev.defaultPrevented).toBe(true);
      expect(view.state.selection.from).toBe(before);
      expect(mount.scrollTop).toBe(0);
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});
