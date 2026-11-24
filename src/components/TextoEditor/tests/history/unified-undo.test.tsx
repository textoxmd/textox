import { describe, expect, it, beforeAll, afterEach, vi } from "vitest";
import { createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { TextSelection } from "prosemirror-state";
import { TextoEditor } from "../../TextoEditor";
import type { TextoEditorProps } from "../../TextoEditor";
import type { TextoEditorRef } from "../../TextoEditorRef";

// 统一撤销：IR / SV 共用一份历史会话。IR 里做的编辑，切到 SV 后撤销，
// 两边文档与外部 content 都必须回到编辑前的状态。
beforeAll(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  // 不 stub requestAnimationFrame：同步回调会在 EditorView 构造期间派发事务
  // （fenced-code 插件首次高亮），此时 dispatchTransaction 闭包里的 view 尚未赋值。
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
});

type Mounted = {
  ref: ReturnType<typeof createRef<TextoEditorRef>>;
  changes: string[];
  render: (content: string, editorMode: "ir" | "sv") => Promise<void>;
};

async function mount(
  mode: "ir" | "sv" = "ir",
  extraProps: Partial<TextoEditorProps> = {},
  content = "abc",
): Promise<Mounted> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const ref = createRef<TextoEditorRef>();
  const changes: string[] = [];
  const render = async (content: string, editorMode: "ir" | "sv") => {
    await act(async () => {
      root!.render(createElement(TextoEditor, {
        ...extraProps,
        content,
        editorMode,
        editable: true,
        onChange: (md: string) => changes.push(md),
        ref,
      }));
    });
  };
  await render(content, mode);
  return { ref, changes, render };
}

/** 源码视图按需加载：轮询等它的 CodeMirror DOM 出现。 */
async function waitForSourceView(): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const el = document.querySelector<HTMLElement>(".cm-content");
    if (el) return el;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }
  throw new Error("source view did not mount");
}

describe("统一撤销", () => {
  it("IR 编辑 → 切 SV → 撤销恢复两边", async () => {
    const { ref, changes, render } = await mount("ir");
    const view = ref.current!.editorView!;
    act(() => {
      // 追加到首段文本末尾（段落内容从 pos 1 起，nodeSize - 1 是其文本末尾）
      const end = view.state.doc.firstChild!.nodeSize - 1;
      view.dispatch(view.state.tr.insertText("def", end, end));
    });
    await render("abcdef", "sv");
    // 等源码视图真正挂载：撤销要落到 SV 侧（会话按当前视觉模式回写）
    await waitForSourceView();
    act(() => { ref.current!.undo(); });
    expect(changes[changes.length - 1]).toBe("abc");
    await render("abc", "ir");
    expect(ref.current!.editorView!.state.doc.textContent).toBe("abc");
  });

  it("代码块末尾输入后撤销，光标仍在代码块内", async () => {
    // 回归：撤销组曾经记录「事务后」的选区。在代码块内容末尾打字后，光标落在
    // 块边界（posToLineCol 映射到闭合围栏之后），撤销时按行/列回推就跳到了下一段
    // 的起点。撤销目标必须是事务**开始前**的光标。
    const content = "```js\nfoo\nbar\n```\n\nafter";
    const { ref } = await mount("ir", {}, content);
    const view = ref.current!.editorView!;
    const codeBlock = view.state.doc.child(0);
    const end = 1 + codeBlock.content.size;
    expect(view.state.doc.resolve(end).parent.type.name).toBe("code_block");

    act(() => {
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, end)),
      );
      view.dispatch(view.state.tr.insertText("X", end));
    });
    expect(view.state.doc.child(0).textContent).toBe("foo\nbarX");

    act(() => { ref.current!.undo(); });
    expect(view.state.doc.child(0).textContent).toBe("foo\nbar");
    expect(view.state.selection.$from.parent.type.name).toBe("code_block");
  });

  it("删除代码块最后一行字符后撤销，光标仍在代码块内", async () => {
    // 回归：before 光标曾用「删除后的 doc」换算行/列。删除代码块末尾字符时，
    // 事务前的块内末尾位置在删除后已落到块外，换算出的行/列偏差 ⇒ 撤销跳到下一行。
    // 事务前的选区必须用**事务前的 doc 与保真上下文**换算。
    const content = "```js\nfoo\nbar\n```\n\nafter";
    const { ref } = await mount("ir", {}, content);
    const view = ref.current!.editorView!;
    const codeBlock = view.state.doc.child(0);
    const end = 1 + codeBlock.content.size; // 块内容末尾
    expect(view.state.doc.resolve(end).parent.type.name).toBe("code_block");

    act(() => {
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, end)),
      );
      // 删除最后一个字符 "r"
      view.dispatch(view.state.tr.delete(end - 1, end));
    });
    expect(view.state.doc.child(0).textContent).toBe("foo\nba");

    act(() => { ref.current!.undo(); });
    expect(view.state.doc.child(0).textContent).toBe("foo\nbar");
    expect(view.state.selection.$from.parent.type.name).toBe("code_block");
  });

  it("代码块内普通输入撤销后光标仍在代码块内", async () => {
    const content = "```js\nfoo\nbar\n```\n\nafter";
    const { ref } = await mount("ir", {}, content);
    const view = ref.current!.editorView!;
    const inside = 4; // "foo" 之后（块内，非块边界）
    expect(view.state.doc.resolve(inside).parent.type.name).toBe("code_block");

    act(() => {
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, inside)),
      );
      view.dispatch(view.state.tr.insertText("X", inside));
    });
    expect(view.state.doc.child(0).textContent).toBe("fooX\nbar");

    act(() => { ref.current!.undo(); });
    expect(view.state.doc.child(0).textContent).toBe("foo\nbar");
    expect(view.state.selection.$from.parent.type.name).toBe("code_block");
  });

  it("首次挂载不会覆盖已保存的光标位置", async () => {
    const { getEditorPosition, setEditorPosition } = await import(
      "../../src/editorPositionStore"
    );
    // 上次停留：第 3 行第 1 列（"abc" 的 "a" 之后）
    setEditorPosition(7, 3, 1);

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const ref = createRef<TextoEditorRef>();
    await act(async () => {
      root!.render(createElement(TextoEditor, {
        content: "# a\n\nabc",
        editorMode: "ir",
        editable: true,
        positionKey: 7,
        onChange: () => {},
        ref,
      }));
    });

    // 挂载不能把 IR 的初始光标（文档开头）写回 store
    expect(getEditorPosition(7)).toEqual({ line: 3, col: 1 });
    // 并且真的恢复到保存的位置：光标落在第 3 行 "abc" 的第 1 列，而不是文档开头
    const view = ref.current!.editorView!;
    expect(view.state.selection.head).toBeGreaterThan(1);
    const $head = view.state.selection.$head;
    expect($head.parent.textContent).toBe("abc");
    expect($head.parentOffset).toBe(1);

    // 真正的模式切换仍然要保存当前光标：guard 只跳过首次挂载，不能吞掉正常保存
    act(() => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    });
    await act(async () => {
      root!.render(createElement(TextoEditor, {
        content: "# a\n\nabc",
        editorMode: "sv",
        editable: true,
        positionKey: 7,
        onChange: () => {},
        ref,
      }));
    });
    // 光标在第 1 行（标题行），说明真正切换时保存的是"当前"光标而非旧的 3/1
    const saved = getEditorPosition(7);
    expect(saved?.line).toBe(1);
    expect(saved).not.toEqual({ line: 3, col: 1 });
  });

  it("IR → SV 切换把光标行滚到视口中间", async () => {
    // 回归：模式切换曾用 CodeMirror 的 `scrollIntoView: true`（最小滚动），
    // 目标行在视口下方时会被贴到最底边。切换必须显式请求居中。
    const { EditorView } = await import("@codemirror/view");
    const spy = vi.spyOn(EditorView, "scrollIntoView");
    try {
      const { setEditorPosition } = await import("../../src/editorPositionStore");
      setEditorPosition(23, 1, 1);
      const { render } = await mount("ir", { positionKey: 23 });
      await render("abc", "sv");
      await waitForSourceView();
      // 锚点是窗口视觉中线：CM 用 `y: 'start'` + 换算后的 yMargin 实现，
      // 而不是容器中线（`y: 'center'`，会因标题栏看起来偏下）。
      expect(spy).toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({ y: "start", yMargin: expect.any(Number) }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("SV chunk 已加载后重新挂载仍能同步", async () => {
    // 第一次挂载：把源码视图的懒加载跑完（lazy 进入 fulfilled），然后卸载。
    await mount("ir");
    await waitForSourceView();
    act(() => root!.unmount());
    root = null;
    host?.remove();
    host = null;

    // 第二次挂载：SV 现在延迟到窗口空闲后挂载（约 800ms），先等它出现，
    // 再验证父子 effect 顺序下会话仍能被注册并同步。
    const second = await mount("ir");
    await waitForSourceView();
    expect(document.querySelector(".cm-content")).not.toBeNull();
    const view = second.ref.current!.editorView!;
    act(() => {
      const end = view.state.doc.content.size - 1;
      view.dispatch(view.state.tr.insertText("XYZ", end, end));
    });
    await act(async () => {
      root!.render(createElement(TextoEditor, {
        content: view.state.doc.textContent,
        editorMode: "sv",
        editable: true,
        onChange: () => {},
        ref: second.ref,
      }));
    });
    await waitForSourceView();
    const svText = document.querySelector(".cm-content")?.textContent ?? "";
    expect(svText).toContain("XYZ");
  });

  it("SV 可见时命令打到隐藏 IR 也会同步到源码视图", async () => {
    const { ref } = await mount("sv");
    await waitForSourceView();
    const before = document.querySelector(".cm-content")?.textContent ?? "";
    expect(before).toBe("abc");

    // 全局快捷键/工具栏命令不判断模式，会直接改隐藏的 IR；会话必须把结果补同步到 SV
    act(() => { ref.current!.toggleHeading(2); });
    await act(async () => {});
    const after = document.querySelector(".cm-content")?.textContent ?? "";
    expect(after).toContain("##");
    expect(after).toContain("abc");
  });

  it("SV 可见时插入图片同步到源码视图", async () => {
    let insertImage: ((url: string, name: string) => void) | null = null;
    const { changes } = await mount("sv", {
      onInsertImage: (cb) => {
        insertImage = cb;
      },
    });
    await waitForSourceView();

    // onInsertImage 的回调直接 dispatch 到（隐藏的）IR，不经过 withView；
    // 同步必须由 IR 的 onChange 统一兜住。
    act(() => { insertImage?.("img.png", "x.png"); });
    await act(async () => {});

    const expected = "![x.png](img.png)";
    expect(changes[changes.length - 1]).toContain(expected);
    const svText = document.querySelector(".cm-content")?.textContent ?? "";
    expect(svText).toContain(expected);
  });

  it("SV 挂载后撤销直接作用在源码视图上", async () => {
    const { ref, changes, render } = await mount("ir");
    const view = ref.current!.editorView!;
    act(() => {
      const end = view.state.doc.firstChild!.nodeSize - 1;
      view.dispatch(view.state.tr.insertText("def", end, end));
    });
    await render("abcdef", "sv");
    const source = await waitForSourceView();
    expect(source.textContent).toBe("abcdef");

    // 外部 content 仍停在 "abcdef"（没有重新渲染）：源码视图变成 "abc"
    // 只可能来自会话把它写回当前激活视图。
    act(() => { ref.current!.undo(); });
    expect(changes[changes.length - 1]).toBe("abc");
    expect(source.textContent).toBe("abc");
  });

  it("SV 编辑/撤销后打到隐藏 IR 的命令不会回滚 SV", async () => {
    const { ref, changes, render } = await mount("ir");
    const view = ref.current!.editorView!;
    act(() => {
      const end = view.state.doc.firstChild!.nodeSize - 1;
      view.dispatch(view.state.tr.insertText("def", end, end));
    });
    await render("abcdef", "sv");
    await waitForSourceView();

    act(() => { ref.current!.undo(); });
    expect(changes[changes.length - 1]).toBe("abc");
    // 会话已是 "abc"，隐藏的 IR 仍停在撤销前的文本 —— 命令必须先把会话同步进 IR，
    // 否则会在旧文档上执行并把 "abcdef" 的命令效果提交回会话。
    expect(view.state.doc.textContent).toBe("abcdef");

    act(() => { ref.current!.toggleHeading(2); });
    await act(async () => {});
    const svText = document.querySelector(".cm-content")?.textContent ?? "";
    expect(svText).toContain("## abc");
    expect(svText).not.toContain("abcdef");
  });

  it("isFocused 反映焦点是否在编辑器内", async () => {
    const { ref } = await mount("ir");
    act(() => { (document.activeElement as HTMLElement | null)?.blur(); });
    expect(ref.current!.isFocused()).toBe(false);

    act(() => { ref.current!.editorView!.focus(); });
    expect(ref.current!.isFocused()).toBe(true);

    act(() => {
      const outside = document.createElement("input");
      document.body.appendChild(outside);
      outside.focus();
    });
    expect(ref.current!.isFocused()).toBe(false);
  });

  it("编辑器根内的普通输入框不算编辑器焦点", async () => {
    const { ref } = await mount("ir");
    act(() => { ref.current!.editorView!.focus(); });
    expect(ref.current!.isFocused()).toBe(true);

    // 查找面板 / 代码块语言输入位于编辑器根内，但 Cmd+Z 应只作用于输入框本身
    act(() => {
      const input = document.createElement("input");
      document.querySelector(".texto-editor")!.appendChild(input);
      input.focus();
    });
    expect(ref.current!.isFocused()).toBe(false);
  });

  it("源码视图的 CM 隐藏输入仍算编辑器焦点", async () => {
    const { ref } = await mount("sv");
    const source = await waitForSourceView();
    act(() => {
      const textarea = document.createElement("textarea");
      source.closest(".cm-editor")!.appendChild(textarea);
      textarea.focus();
    });
    expect(ref.current!.isFocused()).toBe(true);
  });
});

// ref 级保存点：会话测试覆盖 dirty 语义，这里只保证 ref 把调用透传到会话
// （双模式），并在纯 IR 下退化为「读当前内容 + 空操作」。
describe("保存点 ref", () => {
  it("双模式：编辑后 beginSavePoint 返回当前内容与 stateId", async () => {
    const { ref } = await mount("ir");
    const view = ref.current!.editorView!;
    act(() => {
      const end = view.state.doc.firstChild!.nodeSize - 1;
      view.dispatch(view.state.tr.insertText("def", end, end));
    });

    const point = ref.current!.beginSavePoint();
    expect(point?.content).toBe("abcdef");
    expect(point?.stateId).toBeGreaterThan(0);
    expect(point?.sessionId).toBeGreaterThan(0);
    expect(point?.saveSeq).toBeGreaterThan(0);
    ref.current!.confirmSavePoint(point!.stateId, point!.sessionId, point!.saveSeq);
    // 会话内容不受 confirm 影响
    expect(ref.current!.beginSavePoint()?.content).toBe("abcdef");
  });

  it("纯 IR：beginSavePoint 返回内容，confirmSavePoint/markSaved 不报错", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const ref = createRef<TextoEditorRef>();
    await act(async () => {
      root!.render(createElement(TextoEditor, {
        content: "abc",
        editable: true,
        onChange: () => {},
        ref,
      }));
    });

    const point = ref.current!.beginSavePoint();
    expect(point?.content).toBe("abc");
    expect(point?.stateId).toBe(0);
    expect(point?.sessionId).toBe(0);
    expect(point?.saveSeq).toBe(0);
    expect(() => {
      ref.current!.confirmSavePoint(point!.stateId, point!.sessionId, point!.saveSeq);
      ref.current!.markSaved();
    }).not.toThrow();
  });
});
