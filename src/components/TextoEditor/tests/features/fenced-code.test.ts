import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState, Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { defineCodeBlockExtension } from "@texto/markdown-editor-api";
import type { PreviewContext } from "@texto/markdown-editor-api";
import { resetExtensionPointsForTests } from "@texto/plugin-sdk";

import { parse } from "../../src/parser.ts";
import { getSchema } from "../../src/schema.ts";

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});
import { defaultPlugins } from "../../src/editor.ts";
import { getLangFocus } from "../../src/features/fenced-code.ts";
import { runFeatureCases } from "../utils.ts";
import { fencedCodeSpecs } from "../../specs/features/fenced-code.specs.ts";
import { setEditorExtensions } from "../helpers/editor-extensions.ts";
import { bootstrapPluginsForTests } from "../plugins-setup";

beforeEach(() => {
  bootstrapPluginsForTests();
});

afterEach(() => {
  resetExtensionPointsForTests();
});

const lockKey = new PluginKey<boolean>("test-locked");

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

describe("fenced code locked mode", () => {
  it("keeps the rendered diagram visible when the caret is inside while locked", () => {
    setEditorExtensions([
      defineCodeBlockExtension({
        id: "test.mermaid",
        languages: ["mermaid"],
        createPreview: () => {
          const dom = document.createElement("div");
          return {
            dom,
            update: () => {
              dom.innerHTML = '<div class="stub-mermaid"></div>';
            },
          };
        },
      }),
    ]);
    const doc = parse("```mermaid\ngraph TD\nA-->B\n```");
    expect(doc.firstChild!.type.name).toBe("code_block");
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 0),
      plugins: [withEditable(false), ...defaultPlugins({ cursorWidget: false })],
    });
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    try {
      expect(view.editable).toBe(false);
      const pre = mount.querySelector("pre[data-lang='mermaid']") as HTMLElement;
      const render = pre.querySelector(".cb-render-container") as HTMLElement;
      const code = pre.querySelector("code") as HTMLElement;
      expect(render.style.display).not.toBe("none");
      expect(code.style.display).toBe("none");
      // 模拟点击/键盘导航把光标放进代码块内（锁定下仍允许选择与导航）
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)),
      );
      expect(render.style.display).not.toBe("none");
      expect(code.style.display).toBe("none");
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("re-renders on appearancechange and stops after destroy", async () => {
    const render = vi.fn();
    setEditorExtensions([
      defineCodeBlockExtension({
        id: "test.mermaid",
        languages: ["mermaid"],
        createPreview: () => {
          const dom = document.createElement("div");
          return {
            dom,
            update: () => {
              render();
              dom.innerHTML = '<div class="stub-mermaid"></div>';
            },
          };
        },
      }),
    ]);

    const doc = parse("```mermaid\ngraph TD\nA-->B\n```");
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 0),
      plugins: [withEditable(false), ...defaultPlugins({ cursorWidget: false })],
    });
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });

    // 初次进入 render 模式会调用一次 render
    await vi.waitFor(() => expect(render).toHaveBeenCalled());
    const before = render.mock.calls.length;

    // 外观变化应触发重新渲染
    window.dispatchEvent(new CustomEvent("appearancechange"));
    await vi.waitFor(() =>
      expect(render.mock.calls.length).toBeGreaterThan(before),
    );

    // destroy 后监听被移除，再派发不应再渲染
    const afterAppearance = render.mock.calls.length;
    view.destroy();
    mount.remove();
    window.dispatchEvent(new CustomEvent("appearancechange"));
    await Promise.resolve();
    expect(render.mock.calls.length).toBe(afterAppearance);
  });

  it("预览成功回调会清除错误态", async () => {
    let ctxRef: PreviewContext | null = null;
    setEditorExtensions([
      defineCodeBlockExtension({
        id: "test.mermaid",
        languages: ["mermaid"],
        createPreview: () => ({
          dom: document.createElement("div"),
          update: (_node, ctx) => {
            ctxRef = ctx;
            ctx.onError("boom");
          },
        }),
      }),
    ]);
    const doc = parse("```mermaid\ngraph TD\nA-->B\n```");
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 0),
      plugins: [withEditable(false), ...defaultPlugins({ cursorWidget: false })],
    });
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    try {
      const pre = mount.querySelector("pre[data-lang='mermaid']") as HTMLElement;
      await vi.waitFor(() =>
        expect(pre.querySelector(".cb-render-error")).not.toBeNull(),
      );
      expect(pre.classList.contains("cb-error-mode")).toBe(true);

      ctxRef!.onSuccess?.();
      expect(pre.querySelector(".cb-render-error")).toBeNull();
      expect(pre.classList.contains("cb-error-mode")).toBe(false);
      expect(pre.classList.contains("cb-render-mode")).toBe(true);
      // 错误恢复后放大按钮也要回来（错误态期间 renderContainer 可能被重写）。
      expect(pre.querySelector(".media-zoom-trigger")).not.toBeNull();
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});

describe("code block language input", () => {
  function mount(md: string) {
    const doc = parse(md);
    const state = EditorState.create({
      schema,
      doc,
      plugins: defaultPlugins({ cursorWidget: false }),
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    const view = new EditorView(el, { state });
    return { view, el };
  }

  /** 文档中 `start` 之后第一个文本块的内容起点。 */
  function firstTextblockPosAfter(
    doc: ReturnType<typeof parse>,
    start: number,
  ): number {
    let found = -1;
    doc.descendants((node, pos) => {
      if (found >= 0) return false;
      if (pos < start) return true;
      if (node.isTextblock) {
        found = pos + 1;
        return false;
      }
      return true;
    });
    return found;
  }

  /** 进入首个代码块的语言输入框（从代码体末行按 ArrowDown）。 */
  function enterFirstLangInput(view: EditorView, el: HTMLElement) {
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, view.state.doc.child(0).nodeSize - 1),
      ),
    );
    view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    const input = el.querySelector(".cb-lang-input") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    return input;
  }

  function pressOn(
    target: HTMLElement,
    key: string,
  ): void {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  /** 用 ArrowDown 越过整个下拉列表，触发“退出到下方”。 */
  function exitLangInputBelow(input: HTMLInputElement, el: HTMLElement): void {
    const count = el.querySelectorAll(".cb-lang-item").length;
    for (let i = 0; i <= count; i++) pressOn(input, "ArrowDown");
  }

  it("shows 'text' as the value when the code block has no language", () => {
    const { view, el } = mount("```\nconst a = 1;\n```");
    try {
      const input = el.querySelector(".cb-lang-input") as HTMLInputElement;
      expect(input.value).toBe("text");
      expect(view.state.doc.firstChild!.attrs.lang).toBe("");
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("keeps 'text' as the value after selecting the text option", () => {
    const { view, el } = mount("```javascript\nconst a = 1;\n```");
    try {
      const input = el.querySelector(".cb-lang-input") as HTMLInputElement;
      input.value = "";
      input.dispatchEvent(new Event("input"));
      const textItem = Array.from(el.querySelectorAll(".cb-lang-item")).find(
        (i) => (i as HTMLElement).textContent === "text",
      ) as HTMLElement;
      expect(textItem).toBeTruthy();
      textItem.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      expect(view.state.doc.firstChild!.attrs.lang).toBe("");
      expect(input.value).toBe("text");
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("shows the full list when focusing a text (empty lang) block", () => {
    const { view, el } = mount("```\nconst a = 1;\n```");
    try {
      const input = el.querySelector(".cb-lang-input") as HTMLInputElement;
      input.dispatchEvent(new FocusEvent("focus"));
      expect(el.querySelectorAll(".cb-lang-item").length).toBeGreaterThan(1);
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("keeps focus in the language selector and closes the dropdown after Enter", () => {
    const { view, el } = mount("```typescript\nconst a = 1;\n```");
    try {
      const input = el.querySelector(".cb-lang-input") as HTMLInputElement;
      input.focus();
      // 清空过滤词以展示完整语言列表（精确匹配会按设计隐藏下拉）
      input.value = "";
      input.dispatchEvent(new Event("input"));
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );

      // 选中第一项 "text" → 语言应用，人留在语言选择器里，下拉关闭
      expect(view.state.doc.firstChild!.attrs.lang).toBe("");
      expect(view.state.doc.childCount).toBe(1);
      const nextInput = el.querySelector(".cb-lang-input") as HTMLInputElement;
      expect(nextInput).toBeTruthy();
      expect(document.activeElement).toBe(nextInput);
      expect(el.querySelector(".cb-lang-dropdown")).toBeNull();

      // 再按一次 Enter（无下拉）才确认并落到下方新段落
      pressOn(nextInput, "Enter");
      expect(view.state.doc.childCount).toBe(2);
      expect(view.state.doc.lastChild!.type.name).toBe("paragraph");
      expect(document.activeElement).toBe(view.dom);
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("commits the typed language and moves to a new paragraph below with Enter", () => {
    const { view, el } = mount("```typescript\nconst a = 1;\n```");
    try {
      const input = el.querySelector(".cb-lang-input") as HTMLInputElement;
      input.focus();
      input.value = "python";
      input.dispatchEvent(new Event("input"));
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );

      expect(view.state.doc.firstChild!.attrs.lang).toBe("python");
      expect(document.activeElement).toBe(view.dom);
      expect(view.state.doc.childCount).toBe(2);
      const $from = view.state.selection.$from;
      expect($from.parent.type.name).toBe("paragraph");
      expect($from.parentOffset).toBe(0);
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("inserts a paragraph instead of entering a heading below on Enter", () => {
    // 回归：文件里没有任何普通段落、代码块下方直接是标题时，Enter 会插入空段落；
    // 落点必须在新段落里，且编辑器保持焦点（否则下一次输入会丢失）。
    const { view, el } = mount(
      "```typescript\nconst a = 1;\n```\n\n### ssssss\n\n## next",
    );
    try {
      const input = el.querySelector(".cb-lang-input") as HTMLInputElement;
      input.focus();
      input.value = "python";
      input.dispatchEvent(new Event("input"));
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );

      expect(view.state.doc.firstChild!.attrs.lang).toBe("python");
      expect(view.state.doc.child(1).type.name).toBe("paragraph");
      expect(view.state.doc.child(2).type.name).toBe("heading");
      expect(document.activeElement).toBe(view.dom);
      const $from = view.state.selection.$from;
      expect($from.parent.type.name).toBe("paragraph");
      expect($from.parentOffset).toBe(0);
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("inserts a paragraph instead of entering a code block below on Enter", () => {
    const { view, el } = mount(
      "```typescript\nconst a = 1;\n```\n\n```js\nconst b = 2;\n```",
    );
    try {
      expect(view.state.doc.childCount).toBe(2);
      const input = el.querySelector(".cb-lang-input") as HTMLInputElement;
      input.focus();
      // 手输语言后 Enter（无高亮项）：确认并落到下方
      input.value = "python";
      input.dispatchEvent(new Event("input"));
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );

      expect(view.state.doc.firstChild!.attrs.lang).toBe("python");
      // 下方是另一个代码块：应在两者之间插入段落，而不是把光标送进下一个代码块
      expect(view.state.doc.childCount).toBe(3);
      expect(view.state.doc.child(1).type.name).toBe("paragraph");
      expect(view.state.doc.lastChild!.type.name).toBe("code_block");
      expect(document.activeElement).toBe(view.dom);
      const $from = view.state.selection.$from;
      expect($from.parent.type.name).toBe("paragraph");
      expect($from.parentOffset).toBe(0);
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("ArrowUp from a lower code block enters the upper block's language input first", () => {
    const { view, el } = mount(
      "```typescript\nconst a = 1;\n```\n\n```js\nconst b = 2;\n```",
    );
    try {
      // 光标放到第二个（下方）代码块正文开头
      const secondStart = view.state.doc.child(0).nodeSize;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, secondStart + 1),
        ),
      );

      view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          bubbles: true,
          cancelable: true,
        }),
      );

      // 应先进入上方代码块的语言选择器，而不是直接进入其正文
      expect(getLangFocus(view.state)).toEqual({ pos: 0 });
      const input = el.querySelector(
        ".cb-lang-focus .cb-lang-input",
      ) as HTMLInputElement | null;
      expect(input).toBeTruthy();
      expect(document.activeElement).toBe(input);
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("ArrowUp from the first line of a list below enters the language input", () => {
    const { view, el } = mount("```ts\nfoo\n```\n\n- one\n- two");
    try {
      const firstBlockSize = view.state.doc.child(0).nodeSize;
      const firstItem = firstTextblockPosAfter(view.state.doc, firstBlockSize);
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, firstItem),
        ),
      );
      pressOn(view.dom, "ArrowUp");
      expect(getLangFocus(view.state)).toEqual({ pos: 0 });
      expect(document.activeElement?.className).toBe("cb-lang-input");
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("ArrowUp from a later list item is not hijacked by the code block", () => {
    const { view, el } = mount("```ts\nfoo\n```\n\n- one\n- two");
    try {
      let secondItem = -1;
      view.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === "two") {
          secondItem = pos + 1;
          return false;
        }
        return true;
      });
      expect(secondItem).toBeGreaterThan(0);
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, secondItem),
        ),
      );
      pressOn(view.dom, "ArrowUp");
      expect(getLangFocus(view.state)).toBeNull();
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("ArrowDown from the language input lands in a list below", () => {
    const { view, el } = mount("```ts\nfoo\n```\n\n- item");
    try {
      const input = enterFirstLangInput(view, el);
      exitLangInputBelow(input, el);
      const $from = view.state.selection.$from;
      expect($from.parent.inlineContent).toBe(true);
      expect($from.parent.type.name).toBe("paragraph");
      expect(document.activeElement).toBe(view.dom);
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("ArrowDown from the language input skips a horizontal rule below", () => {
    const { view, el } = mount("```ts\nfoo\n```\n\n---\n\nafter");
    try {
      const input = enterFirstLangInput(view, el);
      exitLangInputBelow(input, el);
      const $from = view.state.selection.$from;
      expect($from.parent.inlineContent).toBe(true);
      expect($from.parent.textContent).toBe("after");
      expect(document.activeElement).toBe(view.dom);
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("does not open the dropdown on focus when the value is an exact language", () => {
    const { view, el } = mount("```typescript\nconst a = 1;\n```");
    try {
      const input = el.querySelector(".cb-lang-input") as HTMLInputElement;
      input.dispatchEvent(new FocusEvent("focus"));
      expect(el.querySelector(".cb-lang-dropdown")).toBeNull();

      // 输入变成非精确前缀后才展示候选
      input.value = "pyt";
      input.dispatchEvent(new Event("input"));
      const items = Array.from(el.querySelectorAll(".cb-lang-item"));
      expect(items.length).toBeGreaterThan(0);

      pressOn(input, "ArrowDown");
      expect(el.querySelector(".cb-lang-item.selected")?.textContent).toBe(
        "Python",
      );
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("filters the list by the typed query after editing", () => {
    const { view, el } = mount("```typescript\nconst a = 1;\n```");
    try {
      const input = el.querySelector(".cb-lang-input") as HTMLInputElement;
      input.focus();
      input.value = "pyt";
      input.dispatchEvent(new Event("input"));
      const labels = Array.from(el.querySelectorAll(".cb-lang-item")).map(
        (i) => i.textContent,
      );
      expect(labels.some((l) => l?.toLowerCase().includes("python"))).toBe(true);
      expect(labels.includes("TypeScript")).toBe(false);
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("hides the dropdown when the query is an exact language match", () => {
    const { view, el } = mount("```typescript\nconst a = 1;\n```");
    try {
      const input = el.querySelector(".cb-lang-input") as HTMLInputElement;
      input.focus();
      input.value = "python";
      input.dispatchEvent(new Event("input"));
      expect(el.querySelector(".cb-lang-dropdown")).toBeNull();

      // 别名精确匹配同样视为“无可选”
      input.value = "ts";
      input.dispatchEvent(new Event("input"));
      expect(el.querySelector(".cb-lang-dropdown")).toBeNull();

      // 非精确前缀仍展示候选
      input.value = "pyt";
      input.dispatchEvent(new Event("input"));
      expect(el.querySelector(".cb-lang-dropdown")).not.toBeNull();
      expect(el.querySelectorAll(".cb-lang-item").length).toBeGreaterThan(0);
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("selects 'text' on focus so typing replaces it", async () => {
    const { view, el } = mount("```\nconst a = 1;\n```");
    try {
      const input = el.querySelector(".cb-lang-input") as HTMLInputElement;
      input.focus();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe("text".length);
    } finally {
      view.destroy();
      el.remove();
    }
  });
});

runFeatureCases(fencedCodeSpecs);
