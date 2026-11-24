// 语法管线重建（`reloadSyntax`）：插件贡献的解析规则 / NodeView 变化后要重建
// 编辑器状态，但文本、光标 offset 与滚动位置必须保住——否则每次启用/禁用插件
// 都会把用户的光标和视口甩回文档开头。
import { afterEach, describe, expect, it } from "vitest";
import { TextSelection } from "prosemirror-state";

import { createEditor } from "../../src/editor-api.ts";
import type { Editor } from "../../src/editor-api.ts";
import { getScrollParent } from "../../src/scroll-parent.ts";

const mounted: Array<{ editor: Editor; host: HTMLElement }> = [];

/** 建一个带真实滚动容器的编辑器：外层容器负责纵向滚动（与生产一致）。 */
function mount(content: string): { editor: Editor; host: HTMLElement } {
  const host = document.createElement("div");
  // 不加载 CSS 的测试环境里没有 `.prosemirror-editor-container { overflow-y:auto }`，
  // 用内联样式补上，让 getScrollParent() 在测试里选中与生产同一个元素。
  host.style.overflowY = "auto";
  document.body.appendChild(host);
  const editor = createEditor(host, { initialContent: content });
  const entry = { editor, host };
  mounted.push(entry);
  return entry;
}

afterEach(() => {
  for (const { editor, host } of mounted.splice(0)) {
    editor.destroy();
    host.remove();
  }
});

describe("editor.reloadSyntax", () => {
  it("重建后保留文本与光标 offset", () => {
    const { editor } = mount("hello world");
    const view = editor.view;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)),
    );

    const docBefore = view.state.doc;
    const scrollerBefore = getScrollParent(view);

    expect(editor.reloadSyntax()).toBe(true);

    // 重建必须真的换了 doc / view（否则空实现也能通过文本断言）。
    expect(editor.view.state.doc).not.toBe(docBefore);
    expect(editor.view).not.toBe(view);
    // 视口容器本身不变（只有 PM 视图被换掉），所以滚动位置有地方可以落地。
    expect(getScrollParent(editor.view)).toBe(scrollerBefore);

    expect(editor.getMarkdown()).toBe("hello world");
    expect(editor.view.state.selection.from).toBe(6);
    expect(editor.view.state.selection.empty).toBe(true);
  });

  it("重建后保留非折叠选区的方向", () => {
    const { editor } = mount("first paragraph\n\nsecond paragraph");
    const view = editor.view;
    // 跨段落选区：anchor 在第一段，head 在第二段，位置都落在文本节点内。
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 22)),
    );
    expect(view.state.selection.empty).toBe(false);
    expect(view.state.selection.anchor).toBe(3);
    expect(view.state.selection.head).toBe(22);

    expect(editor.reloadSyntax()).toBe(true);

    expect(editor.getMarkdown()).toBe("first paragraph\n\nsecond paragraph");
    // 只存 from 再用 TextSelection.near 恢复会折叠成一个光标——这里必须仍是
    // 非折叠选区，且方向（anchor < head）不变。
    expect(editor.view.state.selection.empty).toBe(false);
    expect(editor.view.state.selection.anchor).toBe(3);
    expect(editor.view.state.selection.head).toBe(22);
  });

  it("重建后保留反向选区（anchor > head）", () => {
    const { editor } = mount("first paragraph\n\nsecond paragraph");
    const view = editor.view;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 22, 3)),
    );
    expect(view.state.selection.anchor).toBe(22);
    expect(view.state.selection.head).toBe(3);

    expect(editor.reloadSyntax()).toBe(true);

    expect(editor.view.state.selection.empty).toBe(false);
    expect(editor.view.state.selection.anchor).toBe(22);
    expect(editor.view.state.selection.head).toBe(3);
  });

  it("重建后保留滚动位置", () => {
    const { editor, host } = mount("hello world");
    // 测试里滚动容器就是外层 host；先确认这里不是「设了却没滚」的假阳性。
    expect(getScrollParent(editor.view)).toBe(host);

    host.scrollTop = 240;
    expect(host.scrollTop).toBe(240);

    expect(editor.reloadSyntax()).toBe(true);

    expect(host.scrollTop).toBe(240);
  });

  it("源码模式跳过重建", () => {
    const { editor } = mount("hello world");

    editor.toggleSource();
    expect(editor.isSourceMode()).toBe(true);

    // 源码视图没有 PM 视图可重建；exitSource() 自己会 rebuild。
    expect(() => editor.reloadSyntax()).not.toThrow();
    expect(editor.reloadSyntax()).toBe(false);
    expect(editor.isSourceMode()).toBe(true);

    editor.toggleSource();
    expect(editor.isSourceMode()).toBe(false);
    expect(editor.getMarkdown()).toBe("hello world");
  });

  it("光标在文档末尾时重建不抛错且选区合法", () => {
    const { editor } = mount("# title\n\n- a\n- b\n\npara");
    const view = editor.view;
    const end = view.state.doc.content.size;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(end), -1)),
    );

    expect(() => editor.reloadSyntax()).not.toThrow();

    const from = editor.view.state.selection.from;
    expect(editor.getMarkdown()).toContain("- a");
    expect(from).toBeGreaterThanOrEqual(0);
    expect(from).toBeLessThanOrEqual(editor.view.state.doc.content.size);
  });
});
