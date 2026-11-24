import { describe, expect, it, vi } from "vitest";
import { NodeSelection, TextSelection } from "prosemirror-state";

import { createEditor } from "../../src/editor-api";
import { createIrAdapter } from "../../src/history/adapters/ir";
import { modeSwitchAnchorY } from "../../src/scroll-anchor";

function mount(md: string, onChange?: (md: string) => void) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = createEditor(host, {
    initialContent: md,
    nativeHistory: false,
    onChange,
  });
  return { host, editor };
}

describe("IR 历史适配器", () => {
  it("读取光标行/列", () => {
    const { host, editor } = mount("# a\n\nabc");
    const adapter = createIrAdapter(editor);
    // 初始光标由 TextSelection.atStart 归一化到首个文本位置（标题文字起点 pos 1），
    // 即 "# a" 的第 2 列——TextSelection 不能停在块边界（pos 0）。
    expect(adapter.getSelection()).toEqual({
      anchor: { line: 1, col: 2 },
      head: { line: 1, col: 2 },
    });

    // 显式移动光标后按行/列读取（段落内部位置，映射可稳定回读）。
    const pos = editor.lineColToPos(3, 1);
    editor.view.dispatch(
      editor.view.state.tr.setSelection(
        TextSelection.create(editor.view.state.doc, pos),
      ),
    );
    expect(adapter.getSelection()).toEqual({
      anchor: { line: 3, col: 1 },
      head: { line: 3, col: 1 },
    });
    editor.destroy();
    host.remove();
  });

  it("应用目标 markdown 并只替换变化的顶层块", () => {
    const { host, editor } = mount("# a\n\nabc");
    const before = editor.view.state.doc;
    const headingBefore = before.child(0);
    const adapter = createIrAdapter(editor);
    adapter.applyMarkdown("# a\n\nabcd", { anchor: { line: 3, col: 4 }, head: { line: 3, col: 4 } });
    expect(editor.getMarkdown()).toBe("# a\n\nabcd");
    expect(editor.view.state.doc.child(0)).toBe(headingBefore);
    editor.destroy();
    host.remove();
  });

  it("center 对齐把目标行滚到模式切换视觉锚点", () => {
    const { host, editor } = mount("a\n\nb\n\nc");
    const scroller = editor.view.dom.parentElement as HTMLElement;
    scroller.style.overflowY = "auto";
    scroller.getBoundingClientRect = (() => ({
      top: 100,
      bottom: 700,
      height: 600,
      left: 0,
      right: 800,
      width: 800,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    })) as unknown as () => DOMRect;
    // 光标行落在视口下方（top 700）；锚点是窗口视觉锚点（innerHeight × 0.47），
    // 不是容器中线（400）——标题栏占掉顶部，容器中线看起来偏下。
    editor.view.coordsAtPos = (() => ({
      top: 700,
      bottom: 718,
      left: 0,
      right: 0,
    })) as unknown as typeof editor.view.coordsAtPos;
    scroller.scrollTop = 0;

    const adapter = createIrAdapter(editor);
    adapter.applyMarkdown(
      "a\n\nb\n\nc",
      { anchor: { line: 5, col: 1 }, head: { line: 5, col: 1 } },
      "center",
    );
    expect(scroller.scrollTop).toBe(709 - modeSwitchAnchorY());
    editor.destroy();
    host.remove();
  });

  it("默认对齐不改动滚动位置（撤销等路径保持最小滚动）", () => {
    const { host, editor } = mount("a\n\nb\n\nc");
    const scroller = editor.view.dom.parentElement as HTMLElement;
    scroller.style.overflowY = "auto";
    scroller.scrollTop = 0;
    editor.view.coordsAtPos = (() => ({
      top: 700,
      bottom: 718,
      left: 0,
      right: 0,
    })) as unknown as typeof editor.view.coordsAtPos;

    const adapter = createIrAdapter(editor);
    adapter.applyMarkdown("a\n\nb\n\nc", {
      anchor: { line: 5, col: 1 },
      head: { line: 5, col: 1 },
    });
    expect(scroller.scrollTop).toBe(0);
    editor.destroy();
    host.remove();
  });

  it("历史应用不上报 onChange（避免自激循环）", () => {
    const onChange = vi.fn();
    const { host, editor } = mount("# a\n\nabc", onChange);
    const adapter = createIrAdapter(editor);
    adapter.applyMarkdown("# a\n\nabcd", null);
    expect(onChange).not.toHaveBeenCalled();
    // 普通编辑仍然上报。
    editor.view.dispatch(
      editor.view.state.tr.insertText("x", editor.view.state.doc.content.size),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    editor.destroy();
    host.remove();
  });

  it("块边界行/列不会产生非法 TextSelection", () => {
    const { host, editor } = mount("# a\n\nabc");
    const adapter = createIrAdapter(editor);
    // 先把光标移到文档末尾，确保后面断言的是「块边界被吸附」而不是「保持原样」。
    const size = editor.view.state.doc.content.size;
    editor.view.dispatch(
      editor.view.state.tr.setSelection(
        TextSelection.near(editor.view.state.doc.resolve(size)),
      ),
    );
    expect(editor.view.state.selection.from).toBeGreaterThan(1);

    expect(() =>
      adapter.applyMarkdown("# a\n\nabcd", {
        anchor: { line: 1, col: 0 },
        head: { line: 1, col: 0 },
      }),
    ).not.toThrow();
    const sel = editor.view.state.selection;
    expect(sel.$from.parent.isTextblock).toBe(true);
    expect(sel.empty).toBe(true);
    // 第 1 行第 0 列是标题块边界 ⇒ 吸附到最近的 inline 位置（标题文字起点 pos 1）。
    expect(sel.from).toBe(1);
    expect(sel.head).toBe(1);
    editor.destroy();
    host.remove();
  });

  it("跨块选区降级为 caret，不会在撤销后打字删掉中间块", () => {
    const { host, editor } = mount("para\n\n![x](a.png)\n\ntail");
    const adapter = createIrAdapter(editor);
    adapter.applyMarkdown("para\n\n![x](a.png)\n\ntail", {
      anchor: { line: 1, col: 4 },
      head: { line: 5, col: 4 },
    });
    const sel = editor.view.state.selection;
    expect(sel.empty).toBe(true);
    expect(sel.$from.parent.isTextblock).toBe(true);
    editor.view.dispatch(editor.view.state.tr.insertText("Z"));
    expect(editor.getMarkdown()).toContain("![x](a.png)");
    editor.destroy();
    host.remove();
  });

  it("图片等原子块的 NodeSelection 压缩成行/列后也降级为 caret", () => {
    const { host, editor } = mount("para\n\n![x](a.png)\n\ntail");
    const adapter = createIrAdapter(editor);
    const doc = editor.view.state.doc;
    let imagePos = -1;
    doc.forEach((node, offset) => {
      if (node.type.name !== "paragraph") imagePos = offset;
    });
    expect(imagePos).toBeGreaterThan(0);

    editor.view.dispatch(
      editor.view.state.tr.setSelection(NodeSelection.create(doc, imagePos)),
    );
    // 历史只记录行/列：图片的 NodeSelection 会被压成两端分属不同顶层块的行/列。
    const recorded = adapter.getSelection();
    adapter.applyMarkdown("para\n\n![x](a.png)\n\ntail", recorded);
    const sel = editor.view.state.selection;
    expect(sel.empty).toBe(true);
    expect(sel.$from.parent.isTextblock).toBe(true);
    editor.view.dispatch(editor.view.state.tr.insertText("Z"));
    expect(editor.getMarkdown()).toContain("![x](a.png)");
    editor.destroy();
    host.remove();
  });
});

describe("原生历史开关", () => {
  it("nativeHistory:false 时把 Mod-z/Mod-Shift-z 转发给 historyCommands", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const undo = vi.fn(() => true);
    const redo = vi.fn(() => true);
    const editor = createEditor(host, {
      initialContent: "# a",
      nativeHistory: false,
      historyCommands: { undo, redo },
    });
    editor.focus();
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true }),
    );
    expect(undo).toHaveBeenCalledTimes(1);
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        code: "KeyZ",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(redo).toHaveBeenCalledTimes(1);
    editor.destroy();
    host.remove();
  });

  it("会话没有可撤销项时仍消费快捷键（不落到浏览器原生 undo）", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const undo = vi.fn(() => false);
    const redo = vi.fn(() => false);
    const editor = createEditor(host, {
      initialContent: "# a",
      nativeHistory: false,
      historyCommands: { undo, redo },
    });
    editor.focus();
    const event = new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(event);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    editor.destroy();
    host.remove();
  });

  it("history 命令抛错时仍消费快捷键并记录错误", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const undo = vi.fn(() => {
      throw new Error("boom");
    });
    const redo = vi.fn(() => true);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const editor = createEditor(host, {
      initialContent: "# a",
      nativeHistory: false,
      historyCommands: { undo, redo },
    });
    editor.focus();
    const event = new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    expect(() => editor.view.dom.dispatchEvent(event)).not.toThrow();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
    editor.destroy();
    host.remove();
  });
});
