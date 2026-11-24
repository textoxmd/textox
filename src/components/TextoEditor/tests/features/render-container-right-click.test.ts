// 真机缺陷回归：在渲染出的图表 / 嵌入图片上右键，不应被 mousedown 处理器
// 当成「点进块内」而切到源码态；语言下拉项上的右键也不应直接选中语言。
// 只有左键才进入编辑行为；右键必须放行，让事件照常冒泡给编辑器的右键菜单流程。
// 同类守卫也存在于第一方插件（html / footnote），其回归测试在各自插件目录下。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  defineCodeBlockExtension,
  defineEmbedExtension,
} from "@texto/markdown-editor-api";
import type { EditorExtension, PreviewRegion } from "@texto/markdown-editor-api";
import { resetExtensionPointsForTests } from "@texto/plugin-sdk";

import { parse } from "../../src/parser.ts";
import { getSchema } from "../../src/schema.ts";
import type { Editor, EditorOptions } from "../../src/editor-api.ts";

let schema: ReturnType<typeof getSchema>;
let createEditor: (host: HTMLElement, options?: EditorOptions) => Editor;
beforeAll(async () => {
  schema = getSchema();
  const api = await import("../../src/editor-api.ts");
  createEditor = api.createEditor;
});
import { defaultPlugins } from "../../src/editor.ts";
import { setEditorExtensions } from "../helpers/editor-extensions.ts";
import { bootstrapPluginsForTests } from "../plugins-setup";

beforeEach(() => {
  bootstrapPluginsForTests();
});

afterEach(() => {
  resetExtensionPointsForTests();
});

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

function teardown(view: EditorView, mount: HTMLElement) {
  view.destroy();
  mount.remove();
}

function rightClick(el: HTMLElement): MouseEvent {
  const ev = new MouseEvent("mousedown", {
    button: 2,
    bubbles: true,
    cancelable: true,
  });
  el.dispatchEvent(ev);
  return ev;
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

/** 文档中第一个指定类型的顶层块的位置（pos）。 */
function topLevelPos(doc: EditorState["doc"], typeName: string): number {
  let pos = -1;
  doc.forEach((node, offset) => {
    if (node.type.name === typeName && pos < 0) pos = offset;
  });
  return pos;
}

function makeMermaidExt(): EditorExtension {
  return defineCodeBlockExtension({
    id: "test.mermaid.right-click",
    languages: ["mermaid"],
    createPreview: (): PreviewRegion => {
      const dom = document.createElement("div");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("data-test", "scene");
      dom.appendChild(svg);
      return { dom, update: () => {} };
    },
  });
}

function makeEmbedExt(): EditorExtension {
  return defineEmbedExtension({
    id: "test.embed.right-click",
    extensions: [".excalidraw"],
    insertLabelKey: "x.insert",
    matches: (src) => src.toLowerCase().endsWith(".excalidraw"),
    createPreview: (): PreviewRegion => {
      const dom = document.createElement("div");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("data-test", "scene");
      dom.appendChild(svg);
      return { dom, update: () => {} };
    },
  });
}

// 语言下拉的自包含夹具：经 defineCodeBlockExtension 贡献 javascript / typescript
// 两个语言（下拉文案由本测试自控，不依赖 syntax-highlight 插件的 hljs 标签）。
// 代码块本身不带语言（''），故不会被该扩展认领，仍落到内置的 lang-input 视图。
function makeLangExt(): EditorExtension {
  return defineCodeBlockExtension({
    id: "test.langs.right-click",
    languages: ["javascript", "typescript"],
    createPreview: (): PreviewRegion => ({
      dom: document.createElement("div"),
      update: () => {},
    }),
  });
}

// 块级数学公式（```math / ```latex）与其它围栏代码块共用同一渲染容器视图，
// 这里用 latex/math 语言扩展复刻其右键守卫（源码即共享的 fenced-code.ts）。
function makeMathExt(): EditorExtension {
  return defineCodeBlockExtension({
    id: "test.math.right-click",
    languages: ["latex", "math"],
    createPreview: (): PreviewRegion => {
      const dom = document.createElement("div");
      dom.setAttribute("data-test", "math");
      return { dom, update: () => {} };
    },
  });
}

describe("fenced code render container mouse buttons", () => {
  const MD = "para\n\n```mermaid\ngraph TD;\n```\n";

  it("right click does not enter code mode", () => {
    const { view, mount } = mountDoc(MD, [makeMermaidExt()]);
    try {
      expect(view.dom.querySelector(".cb-render-mode")).toBeTruthy();
      expect(view.dom.querySelector(".cb-code-mode")).toBeNull();

      const rc = view.dom.querySelector(".cb-render-container") as HTMLElement;
      expect(rc).toBeTruthy();
      const before = view.state.selection.from;

      const ev = rightClick(rc);

      expect(view.state.selection.from).toBe(before);
      expect(view.dom.querySelector(".cb-code-mode")).toBeNull();
      expect(view.dom.querySelector(".cb-render-mode")).toBeTruthy();
      // 右键必须阻止浏览器默认的插入点移动（局部兜底已与编辑器根守卫对齐）。
      expect(ev.defaultPrevented).toBe(true);
    } finally {
      teardown(view, mount);
    }
  });

  it("left click still enters code mode", () => {
    const { view, mount } = mountDoc(MD, [makeMermaidExt()]);
    try {
      expect(view.dom.querySelector(".cb-render-mode")).toBeTruthy();
      const rc = view.dom.querySelector(".cb-render-container") as HTMLElement;
      const codePos = topLevelPos(view.state.doc, "code_block");
      expect(codePos).toBeGreaterThan(0);

      leftClick(rc);

      expect(view.dom.querySelector(".cb-code-mode")).toBeTruthy();
      expect(view.dom.querySelector(".cb-render-mode")).toBeNull();
      expect(view.state.selection.from).toBe(codePos + 1);
    } finally {
      teardown(view, mount);
    }
  });
});

describe("embed render container mouse buttons", () => {
  const MD = "para\n\n![alt](a.excalidraw)\n";

  it("right click does not enter code mode", () => {
    const { view, mount } = mountDoc(MD, [makeEmbedExt()]);
    try {
      const rc = view.dom.querySelector(".image-ref-render") as HTMLElement;
      const src = view.dom.querySelector(".image-ref-source") as HTMLElement;
      expect(rc).toBeTruthy();
      expect(src).toBeTruthy();
      // 初始处于预览态：源码区隐藏、渲染区可见。
      expect(src.style.display).toBe("none");
      expect(rc.style.display).not.toBe("none");

      const before = view.state.selection.from;
      rightClick(rc);

      expect(view.state.selection.from).toBe(before);
      expect(src.style.display).toBe("none");
      expect(rc.style.display).not.toBe("none");
    } finally {
      teardown(view, mount);
    }
  });

  it("left click still enters code mode", () => {
    const { view, mount } = mountDoc(MD, [makeEmbedExt()]);
    try {
      const rc = view.dom.querySelector(".image-ref-render") as HTMLElement;
      const src = view.dom.querySelector(".image-ref-source") as HTMLElement;
      const pos = topLevelPos(view.state.doc, "image_ref");
      expect(pos).toBeGreaterThan(0);

      leftClick(rc);

      expect(view.state.selection.from).toBe(pos + 1);
      expect(src.style.display).toBe("");
    } finally {
      teardown(view, mount);
    }
  });
});

describe("code block language dropdown mouse buttons", () => {
  it("right click on an item does not select the language", async () => {
    const { view, mount } = mountDoc("```\ncode\n```\n", [makeLangExt()]);
    try {
      const input = mount.querySelector(".cb-lang-input") as HTMLInputElement;
      input.dispatchEvent(new FocusEvent("focus"));
      // 空查询展示完整语言列表（精确匹配会按设计隐藏下拉）
      input.value = "";
      input.dispatchEvent(new Event("input"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      const item = Array.from(mount.querySelectorAll(".cb-lang-item")).find(
        (i) => (i as HTMLElement).textContent === "typescript",
      ) as HTMLElement;
      expect(item).toBeTruthy();

      rightClick(item);
      expect(view.state.doc.firstChild!.attrs.lang).toBe("");

      leftClick(item);
      expect(view.state.doc.firstChild!.attrs.lang).toBe("typescript");
    } finally {
      teardown(view, mount);
    }
  });
});

describe("block math render container mouse buttons", () => {
  it("块级数学公式（latex/math code_block）走同一渲染容器：右键不切源码、左键进编辑", () => {
    const MD = "para\n\n```latex\nx^2\n```\n";
    const { view, mount } = mountDoc(MD, [makeMathExt()]);
    try {
      expect(view.dom.querySelector(".cb-render-mode")).toBeTruthy();
      expect(view.dom.querySelector(".cb-code-mode")).toBeNull();

      const rc = view.dom.querySelector(".cb-render-container") as HTMLElement;
      expect(rc).toBeTruthy();
      const before = view.state.selection.from;

      rightClick(rc);

      expect(view.state.selection.from).toBe(before);
      expect(view.dom.querySelector(".cb-code-mode")).toBeNull();
      expect(view.dom.querySelector(".cb-render-mode")).toBeTruthy();

      leftClick(rc);

      expect(view.dom.querySelector(".cb-code-mode")).toBeTruthy();
      expect(view.dom.querySelector(".cb-render-mode")).toBeNull();
      expect(view.state.selection.from).toBe(topLevelPos(view.state.doc, "code_block") + 1);
    } finally {
      teardown(view, mount);
    }
  });
});

// 行内图片（段落中的 `![alt](url)`）与行内公式同构：源码由 `softInside` 在光标
// 进入时露出，右键同样可能把光标移进源码范围 ⇒ 切回源码态。渲染 widget 的
// <img> 对非主键 mousedown 只 preventDefault、不移除冒泡。
describe("inline image render widget mouse buttons", () => {
  const MD = "para\n\ntext ![alt](probe-img.png) more\n";

  it("行内图片渲染态：右键不切回源码、只阻止默认且事件仍冒泡，左键放行", () => {
    const { view, mount } = mountDoc(MD, []);
    try {
      const img = view.dom.querySelector("img.image-render") as HTMLImageElement;
      expect(img).toBeTruthy();

      let bubbled = 0;
      view.dom.addEventListener("mousedown", () => {
        bubbled++;
      });

      const right = new MouseEvent("mousedown", { button: 2, bubbles: true, cancelable: true });
      img.dispatchEvent(right);

      // 右键不得移动光标 ⇒ 阻止浏览器默认落点行为…
      expect(right.defaultPrevented).toBe(true);
      // …但必须照常冒泡给编辑器右键菜单流程。
      expect(bubbled).toBe(1);

      const left = new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true });
      img.dispatchEvent(left);
      expect(left.defaultPrevented).toBe(false);
    } finally {
      teardown(view, mount);
    }
  });
});

// 编辑器根守卫：右键不得移动光标。上一轮只在各渲染容器上加了守卫，但右键点
// 在「块根元素（pre）」「chrome 留白」等位置时，浏览器仍会把 DOM 光标放进块
// 内 ⇒ PM 同步 ⇒ isCursorInside ⇒ 切源码态 —— 这正是「有些位置」的根因。
// 本组经 createEditor 挂载（含 editor-api 在 view.dom 上挂的编辑器根 mousedown
// 守卫），覆盖根元素 / chrome / 语言输入框三处（输入框自行 stopPropagation，
// 故必须自带 preventDefault，根守卫收不到它的事件）。
describe("editor root right-click guard (block math)", () => {
  const MD = "para\n\n```math\nx^2\n```\n";

  function mountEditor(md: string, exts: EditorExtension[]) {
    setEditorExtensions(exts);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, {
      initialContent: md,
      documentPath: "/Users/u/notes/note.md",
    });
    return { editor, host };
  }

  it("右键在块根 / chrome / 语言输入框上都被 preventDefault，且仍处渲染态、选区不变", () => {
    const { editor, host } = mountEditor(MD, [makeMathExt()]);
    try {
      const view = editor.view;
      const pre = view.dom.querySelector("pre") as HTMLElement;
      const chrome = view.dom.querySelector(".cb-chrome") as HTMLElement;
      const input = view.dom.querySelector(".cb-lang-input") as HTMLInputElement;
      expect(pre).toBeTruthy();
      expect(chrome).toBeTruthy();
      expect(input).toBeTruthy();
      expect(view.dom.querySelector(".cb-render-mode")).toBeTruthy();
      expect(view.dom.querySelector(".cb-code-mode")).toBeNull();

      const before = view.state.selection.from;

      for (const el of [pre, chrome, input]) {
        const ev = rightClick(el);
        expect(ev.defaultPrevented).toBe(true);
      }

      expect(view.state.selection.from).toBe(before);
      expect(view.dom.querySelector(".cb-code-mode")).toBeNull();
      expect(view.dom.querySelector(".cb-render-mode")).toBeTruthy();
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("左键三处都不被阻止（对照：根守卫只对右键生效）", () => {
    const { editor, host } = mountEditor(MD, [makeMathExt()]);
    try {
      const view = editor.view;
      const pre = view.dom.querySelector("pre") as HTMLElement;
      const chrome = view.dom.querySelector(".cb-chrome") as HTMLElement;
      const input = view.dom.querySelector(".cb-lang-input") as HTMLInputElement;
      expect(pre).toBeTruthy();
      expect(chrome).toBeTruthy();
      expect(input).toBeTruthy();

      for (const el of [pre, chrome, input]) {
        const ev = leftClick(el);
        expect(ev.defaultPrevented).toBe(false);
      }
    } finally {
      editor.destroy();
      host.remove();
    }
  });
});

// 确定性的「右键不移动光标」：仅 preventDefault 不足以保证不同 WebView 都不移动
// 插入点，故 editor-api 在右键 mousedown 时记录选区快照，并在 contextmenu 时若
// 选区被浏览器改动就恢复。以下覆盖恢复逻辑本体与两条对照（既有行为不被误伤）。
describe("editor root right-click guard: deterministic selection restore", () => {
  const MD = "para\n\n```math\nx^2\n```\n";

  function mountEditor(md: string, exts: EditorExtension[]) {
    setEditorExtensions(exts);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, {
      initialContent: md,
      documentPath: "/Users/u/notes/note.md",
    });
    return { editor, host };
  }

  /** 模拟浏览器把插入点放进代码块内（真机上由右键默认动作触发）。 */
  function moveSelectionIntoCodeBlock(editor: Editor): number {
    const view = editor.view;
    const codePos = topLevelPos(view.state.doc, "code_block");
    expect(codePos).toBeGreaterThan(0);
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, codePos + 1),
      ),
    );
    return codePos;
  }

  function mousedown(el: HTMLElement, button: number): MouseEvent {
    const ev = new MouseEvent("mousedown", {
      button,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    return ev;
  }

  function contextmenu(el: HTMLElement): MouseEvent {
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev;
  }

  function mouseup(el: HTMLElement): MouseEvent {
    const ev = new MouseEvent("mouseup", { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev;
  }

  it("右键后选区被浏览器改动 ⇒ contextmenu 恢复到右键前的选区（确定性）", () => {
    const { editor, host } = mountEditor(MD, [makeMathExt()]);
    try {
      const view = editor.view;
      const rc = view.dom.querySelector(".cb-render-container") as HTMLElement;
      expect(rc).toBeTruthy();

      // 右键前把光标放在段落内（pos=3）。
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)),
      );
      expect(view.state.selection.from).toBe(3);

      // 右键：记录快照 + preventDefault。
      const rcDown = mousedown(rc, 2);
      expect(rcDown.defaultPrevented).toBe(true);

      // 即使浏览器把插入点移进代码块，块级抑制也让它保持渲染态。
      moveSelectionIntoCodeBlock(editor);
      expect(view.dom.querySelector(".cb-code-mode")).toBeNull();
      expect(view.dom.querySelector(".cb-render-mode")).toBeTruthy();

      // 真实右键序列的下一个事件：contextmenu ⇒ 恢复右键前的选区。
      contextmenu(rc);

      expect(view.state.selection.from).toBe(3);
      expect(view.dom.querySelector(".cb-code-mode")).toBeNull();
      expect(view.dom.querySelector(".cb-render-mode")).toBeTruthy();
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("对照：没有右键时，选区进入块内仍应切源码态（既有行为不被误伤）", () => {
    const { editor, host } = mountEditor(MD, [makeMathExt()]);
    try {
      const view = editor.view;
      expect(view.dom.querySelector(".cb-render-mode")).toBeTruthy();
      expect(view.dom.querySelector(".cb-code-mode")).toBeNull();

      moveSelectionIntoCodeBlock(editor);

      expect(view.dom.querySelector(".cb-code-mode")).toBeTruthy();
      expect(view.dom.querySelector(".cb-render-mode")).toBeNull();
      expect(view.state.selection.from).toBe(
        topLevelPos(view.state.doc, "code_block") + 1,
      );
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("对照：左键单击清空快照 ⇒ 之后的 contextmenu 不恢复选区", () => {
    const { editor, host } = mountEditor(MD, [makeMathExt()]);
    try {
      const view = editor.view;
      const rc = view.dom.querySelector(".cb-render-container") as HTMLElement;
      expect(rc).toBeTruthy();

      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)),
      );
      expect(view.state.selection.from).toBe(3);

      // 先右键记录快照（选区在 3）……
      mousedown(rc, 2);
      // ……再左键 mousedown（button 0）：必须清空快照。
      mousedown(rc, 0);

      const codePos = moveSelectionIntoCodeBlock(editor);
      contextmenu(rc);

      // 快照已清空 ⇒ 未被恢复：选区仍在块内。
      expect(view.state.selection.from).toBe(codePos + 1);
      expect(view.dom.querySelector(".cb-code-mode")).toBeTruthy();
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  // 真机（WebKit）证据：右键序列里 contextmenu 阶段选区往往尚未改变，WebKit 是在
  // mouseup / auxclick 阶段才把选区移到鼠标下的词 ⇒ 恢复必须覆盖这三处事件。
  it("WebKit 时序：选区在 mouseup 阶段被挪走 ⇒ 也要恢复", () => {
    const { editor, host } = mountEditor(MD, [makeMathExt()]);
    try {
      const view = editor.view;
      const rc = view.dom.querySelector(".cb-render-container") as HTMLElement;
      expect(rc).toBeTruthy();

      // 右键前把光标放在段落内（pos=3）。
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)),
      );
      expect(view.state.selection.from).toBe(3);

      // 右键 mousedown：记录快照 + preventDefault。
      expect(mousedown(rc, 2).defaultPrevented).toBe(true);

      // contextmenu 阶段 WebKit 尚未改动选区（旧实现会在此丢掉快照）。
      contextmenu(rc);
      expect(view.state.selection.from).toBe(3);

      // WebKit 在 mouseup 阶段把插入点挪进代码块 ⇒ 块级抑制下保持渲染态。
      moveSelectionIntoCodeBlock(editor);
      expect(view.dom.querySelector(".cb-code-mode")).toBeNull();
      expect(view.dom.querySelector(".cb-render-mode")).toBeTruthy();

      // mouseup ⇒ 恢复到右键前的选区与渲染态。
      mouseup(rc);

      expect(view.state.selection.from).toBe(3);
      expect(view.dom.querySelector(".cb-code-mode")).toBeNull();
      expect(view.dom.querySelector(".cb-render-mode")).toBeTruthy();
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("陈旧快照不误恢复：超出时效窗口后 mouseup 不恢复选区", () => {
    const { editor, host } = mountEditor(MD, [makeMathExt()]);
    try {
      const view = editor.view;
      const rc = view.dom.querySelector(".cb-render-container") as HTMLElement;
      expect(rc).toBeTruthy();

      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)),
      );
      expect(view.state.selection.from).toBe(3);

      // 右键时 (ts=1000) 记录快照；后续事件发生在很久以后 (ts=2000)。
      const nowSpy = vi.spyOn(performance, "now").mockReturnValue(1000);
      mousedown(rc, 2);
      nowSpy.mockReturnValue(2000);

      const codePos = moveSelectionIntoCodeBlock(editor);
      mouseup(rc);

      // 快照已过期 ⇒ 不恢复：选区保持被挪走后的位置；块级抑制下也仍在渲染态。
      expect(view.state.selection.from).toBe(codePos + 1);
      expect(view.dom.querySelector(".cb-code-mode")).toBeNull();
      expect(view.dom.querySelector(".cb-render-mode")).toBeTruthy();

      nowSpy.mockRestore();
    } finally {
      editor.destroy();
      host.remove();
    }
  });
});

// 「右键不得切源码态」必须与浏览器引擎、命中目标都无关：不同引擎在右键时是否
// 移动插入点、命中 svg 还是外层 div 都不可控（math 的 svg 设 pointer-events:none，
// 命中目标是外层 div；mermaid 命中 svg）。故不再猜测引擎行为，而在块级别做确定性
// 抑制：右键（button 2）后，即使引擎把插入点移进块内也保持渲染态，直到下一次左键
// 点击或光标离开该块才解除。
describe("code block right-click: deterministic source-mode suppression", () => {
  const MD = "para\n\n```math\nx^2\n```\n";

  function mountEditor(md: string, exts: EditorExtension[]) {
    setEditorExtensions(exts);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, {
      initialContent: md,
      documentPath: "/Users/u/notes/note.md",
    });
    return { editor, host };
  }

  function mousedown(el: HTMLElement, button: number): MouseEvent {
    const ev = new MouseEvent("mousedown", {
      button,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    return ev;
  }

  function blockRoot(editor: Editor): HTMLElement {
    const pre = editor.view.dom.querySelector("pre") as HTMLElement | null;
    expect(pre).toBeTruthy();
    return pre!;
  }

  /** 模拟引擎把插入点放进代码块内（真机上由右键默认动作触发）。 */
  function moveSelectionIntoCodeBlock(editor: Editor): number {
    const view = editor.view;
    const codePos = topLevelPos(view.state.doc, "code_block");
    expect(codePos).toBeGreaterThan(0);
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, codePos + 1)),
    );
    return codePos;
  }

  /** 把光标移出代码块（放到前置段落内，pos=3）。 */
  function moveSelectionOutsideBlock(editor: Editor): void {
    const view = editor.view;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
  }

  it("右键后即使插入点被引擎移进块内，也不切源码态", () => {
    const { editor, host } = mountEditor(MD, [makeMathExt()]);
    try {
      const view = editor.view;
      expect(view.dom.querySelector(".cb-render-mode")).toBeTruthy();
      expect(view.dom.querySelector(".cb-code-mode")).toBeNull();

      moveSelectionOutsideBlock(editor);
      expect(view.state.selection.from).toBe(3);

      // 在块根（pre）上右键——这正是引擎可能把插入点移进块内的路径。
      mousedown(blockRoot(editor), 2);

      // 引擎把插入点移进块内。
      moveSelectionIntoCodeBlock(editor);

      expect(view.dom.querySelector(".cb-code-mode")).toBeNull();
      expect(view.dom.querySelector(".cb-render-mode")).toBeTruthy();
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("对照：没有右键时，同样的事务仍进源码态（既有行为不被误伤）", () => {
    const { editor, host } = mountEditor(MD, [makeMathExt()]);
    try {
      const view = editor.view;
      expect(view.dom.querySelector(".cb-render-mode")).toBeTruthy();
      expect(view.dom.querySelector(".cb-code-mode")).toBeNull();

      moveSelectionOutsideBlock(editor);
      moveSelectionIntoCodeBlock(editor);

      expect(view.dom.querySelector(".cb-code-mode")).toBeTruthy();
      expect(view.dom.querySelector(".cb-render-mode")).toBeNull();
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("左键解除抑制：右键 → 左键 → 再进块 ⇒ 进入源码态", () => {
    const { editor, host } = mountEditor(MD, [makeMathExt()]);
    try {
      const view = editor.view;
      moveSelectionOutsideBlock(editor);
      const pre = blockRoot(editor);

      mousedown(pre, 2);
      moveSelectionIntoCodeBlock(editor);
      expect(view.dom.querySelector(".cb-code-mode")).toBeNull();

      // 左键点击块根 ⇒ 解除抑制
      mousedown(pre, 0);
      moveSelectionOutsideBlock(editor);
      moveSelectionIntoCodeBlock(editor);

      expect(view.dom.querySelector(".cb-code-mode")).toBeTruthy();
      expect(view.dom.querySelector(".cb-render-mode")).toBeNull();
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("光标离开自动解除：右键 → 进块（保持渲染）→ 移出 → 再进块 ⇒ 进入源码态", () => {
    const { editor, host } = mountEditor(MD, [makeMathExt()]);
    try {
      const view = editor.view;
      moveSelectionOutsideBlock(editor);

      mousedown(blockRoot(editor), 2);

      // 右键后进块：抑制生效，保持渲染态。
      moveSelectionIntoCodeBlock(editor);
      expect(view.dom.querySelector(".cb-code-mode")).toBeNull();
      expect(view.dom.querySelector(".cb-render-mode")).toBeTruthy();

      // 光标离开该块 ⇒ 抑制自动解除。
      moveSelectionOutsideBlock(editor);

      // 再进块：此时应恢复既有行为，进入源码态。
      moveSelectionIntoCodeBlock(editor);
      expect(view.dom.querySelector(".cb-code-mode")).toBeTruthy();
      expect(view.dom.querySelector(".cb-render-mode")).toBeNull();
    } finally {
      editor.destroy();
      host.remove();
    }
  });
});
