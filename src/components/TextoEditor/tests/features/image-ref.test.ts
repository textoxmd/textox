import { beforeAll, describe, expect, it } from "vitest";
import { EditorState, Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { parse } from "../../src/parser.ts";
import { getSchema } from "../../src/schema.ts";

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});
import { serialize } from "../../src/serializer.ts";
import { defaultPlugins } from "../../src/editor.ts";
import { apply, runFeatureCases, setup } from "../utils.ts";
import { imageRefSpecs } from "../../specs/features/image-ref.specs.ts";

function roundTripStable(md: string): void {
  const doc1 = parse(md);
  const md2 = serialize(doc1);
  const doc2 = parse(md2);
  expect(doc1.eq(doc2)).toBe(true);
}

const lockKey = new PluginKey<boolean>("test-locked");

/** 与 editor-api 的 editable 插件等价的测试用插件 */
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

describe("image_ref block", () => {
  it("parses a standalone ![](path.excalidraw) into a block with source text", () => {
    const doc = parse("![](drawings/flow.excalidraw)");
    const node = doc.firstChild!;
    expect(node.type.name).toBe("image_ref");
    expect(node.textContent).toBe("![](drawings/flow.excalidraw)");
  });

  it("parses standalone png/jpg images into blocks too", () => {
    expect(parse("![图](img.png)").firstChild!.type.name).toBe("image_ref");
    expect(parse("![](https://example.com/img.png)").firstChild!.type.name).toBe(
      "image_ref",
    );
  });

  it("keeps alt and title in the source text", () => {
    const doc = parse('![流程图](drawings/flow.excalidraw "标题")');
    expect(doc.firstChild!.textContent).toBe(
      '![流程图](drawings/flow.excalidraw "标题")',
    );
  });

  it("leaves mid-paragraph refs as plain paragraphs", () => {
    const doc = parse("见下图 ![](drawings/flow.excalidraw)");
    expect(doc.firstChild!.type.name).toBe("paragraph");
  });

  it("recurses into blockquotes", () => {
    const doc = parse("> ![](drawings/flow.excalidraw)");
    const bq = doc.firstChild!;
    expect(bq.type.name).toBe("blockquote");
    expect(bq.firstChild!.type.name).toBe("image_ref");
  });

  it("keeps image refs inline inside list items (no empty filler paragraph)", () => {
    const doc = parse("- ![](img.png)");
    const item = doc.firstChild!.firstChild!;
    expect(item.type.name).toBe("list_item");
    expect(item.childCount).toBe(1);
    expect(item.firstChild!.type.name).toBe("paragraph");
    expect(item.firstChild!.textContent).toBe("![](img.png)");
    // 整个文档里不应出现 image_ref
    let refs = 0;
    doc.descendants((n) => {
      if (n.type.name === "image_ref") refs++;
      return true;
    });
    expect(refs).toBe(0);
  });

  it("still converts inside a blockquote nested in a list item", () => {
    const doc = parse("- > ![](img.png)");
    const item = doc.firstChild!.firstChild!;
    const bq = item.child(item.childCount - 1);
    expect(bq.type.name).toBe("blockquote");
    expect(bq.firstChild!.type.name).toBe("image_ref");
  });

  it("serializes back to the standard markdown form", () => {
    expect(serialize(parse("![](drawings/flow.excalidraw)"))).toBe(
      "![](drawings/flow.excalidraw)",
    );
    expect(serialize(parse('![流程图](drawings/flow.excalidraw "标题")'))).toBe(
      '![流程图](drawings/flow.excalidraw "标题")',
    );
    expect(serialize(parse("![图](img.png)"))).toBe("![图](img.png)");
  });

  it("round-trips stably", () => {
    roundTripStable("![](drawings/flow.excalidraw)");
    roundTripStable('![流程图](drawings/flow.excalidraw "标题")');
    roundTripStable("![图](img.png)");
    roundTripStable("- ![](img.png)");
  });

  it("switches to editable source when the cursor enters the block", () => {
    const doc = parse("![](drawings/flow.excalidraw)");
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 0),
      plugins: defaultPlugins({ cursorWidget: false }),
    });
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    try {
      const block = mount.querySelector(".image-ref-block") as HTMLElement;
      const render = block.querySelector(
        ".image-ref-render",
      ) as HTMLElement;
      const source = block.querySelector(".image-ref-source") as HTMLElement;
      // 初始光标在文档开头（块外）→ 预览态
      expect(render.style.display).not.toBe("none");
      // 光标移入块内文本 → 源码编辑态（可编辑文本，而非图片）
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)),
      );
      expect(source.style.display).not.toBe("none");
      expect(render.style.display).toBe("none");
      // 光标移出 → 回到预览态
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 0)),
      );
      expect(render.style.display).not.toBe("none");
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("typing a standalone ref immediately shows the block source (no inline img widget)", () => {
    const state = apply(
      setup(),
      ["!", "[", "图", "]", "(", "i", "m", "g", ".", "p", "n", "g", ")"],
    );
    // 只有敲完收尾的 `)`（跳过自动配对括号、光标到达段尾）才会提交为块
    expect(state.doc.firstChild!.type.name).toBe("image_ref");
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    try {
      const block = mount.querySelector(".image-ref-block") as HTMLElement;
      expect(block).toBeTruthy();
      const source = block.querySelector(".image-ref-source") as HTMLElement;
      // 光标刚留在块内 → 立即是源码编辑态（.image-ref-source 可见）
      expect(source.style.display).not.toBe("none");
      // 不再出现行内图片管线的 <img> widget
      expect(mount.querySelector("img.image-render")).toBeNull();
      const render = mount.querySelector(".image-ref-render") as HTMLElement;
      expect(render.style.display).toBe("none");
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("waits for the closing paren before committing a typed ref", () => {
    // src 已非空、自动配对的 `)` 也已写入文本，但光标还没越过 `)`
    let state = apply(
      setup(),
      ["!", "[", "图", "]", "(", "i", "m", "g", ".", "p", "n", "g"],
    );
    expect(state.doc.firstChild!.type.name).toBe("paragraph");
    expect(state.doc.firstChild!.textContent).toBe("![图](img.png)");
    // 敲下收尾的 `)` 后才提交为块
    state = apply(state, [")"]);
    expect(state.doc.firstChild!.type.name).toBe("image_ref");
    expect(state.doc.firstChild!.textContent).toBe("![图](img.png)");
  });

  it("keeps a ref whose src has a space as a paragraph (no premature block)", () => {
    const state = apply(
      setup(),
      [
        "!", "[", "图", "]", "(", "m", "y", " ", "i", "m", "g", ".", "p", "n", "g", ")",
      ],
    );
    expect(state.doc.firstChild!.type.name).toBe("paragraph");
    expect(state.doc.firstChild!.textContent).toBe("![图](my img.png)");
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    try {
      expect(mount.querySelector(".image-ref-block")).toBeNull();
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("renders invalid block text as a styled error when the cursor leaves", () => {
    // 正常输入路径不会产生非法块，但编辑中途（如 src 里出现空格）会留下；
    // 光标移出后应显示统一的错误样式，而不是源码框
    const badNode = schema.nodes.image_ref.create(
      null,
      schema.text("![图](a b)"),
    );
    const doc = schema.nodes.doc.create(
      null,
      [badNode, schema.nodes.paragraph.create()],
    );
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 0),
      plugins: defaultPlugins({ cursorWidget: false }),
    });
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    try {
      const block = mount.querySelector(".image-ref-block") as HTMLElement;
      expect(block).toBeTruthy();
      const source = block.querySelector(".image-ref-source") as HTMLElement;
      expect(source.style.display).toBe("none");
      const error = block.querySelector(".image-ref-error") as HTMLElement;
      expect(error).toBeTruthy();
      expect(error.textContent).toContain("Not a valid image reference");
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("typing prose after a standalone ref falls back to the inline image widget", () => {
    const state = apply(
      setup(),
      [
        "!", "[", "图", "]", "(", "i", "m", "g", ".", "p", "n", "g", ")",
        " ", "看", "下", "图",
      ],
    );
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    try {
      // 回退为普通段落：行内 <img> widget 渲染，无 image_ref 块
      expect(mount.querySelector(".image-ref-block")).toBeNull();
      expect(mount.querySelector("img.image-render")).toBeTruthy();
      expect(view.state.doc.firstChild!.type.name).toBe("paragraph");
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("undo after the immediate commit restores the paragraph (no auto-reconvert)", () => {
    let state = apply(
      setup(),
      ["!", "[", "图", "]", "(", "i", "m", "g", ".", "p", "n", "g", ")"],
    );
    expect(state.doc.firstChild!.type.name).toBe("image_ref");
    // 历史按输入连击分组，连续撤销可一路退回普通段落；且撤销到段落状态后，
    // 光标移动（仅 selection 事务）不会被 appendTransaction 立即重新转换
    state = apply(state, ["<Mod-z>", "<Mod-z>", "<Mod-z>"]);
    expect(state.doc.firstChild!.type.name).toBe("paragraph");
    state = apply(state, ["<ArrowLeft>"]);
    expect(state.doc.firstChild!.type.name).toBe("paragraph");
  });
});

describe("image_ref block locked mode", () => {
  it("does not enter source mode when the preview is clicked while locked", () => {
    const doc = parse("![](drawings/flow.excalidraw)");
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
      expect(view.dom.getAttribute("contenteditable")).toBe("false");
      const block = mount.querySelector(".image-ref-block") as HTMLElement;
      const render = block.querySelector(".image-ref-render") as HTMLElement;
      const source = block.querySelector(".image-ref-source") as HTMLElement;
      expect(source.style.display).toBe("none");
      render.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          clientX: 0,
          clientY: 0,
          button: 0,
        }),
      );
      // 点击预览既不移动光标，也不切到源码态
      expect(view.state.selection.from).toBe(0);
      expect(source.style.display).toBe("none");
      expect(render.style.display).not.toBe("none");
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("keeps the preview visible when the caret is inside the block while locked", () => {
    const doc = parse("![](drawings/flow.excalidraw)");
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
      const block = mount.querySelector(".image-ref-block") as HTMLElement;
      const render = block.querySelector(".image-ref-render") as HTMLElement;
      const source = block.querySelector(".image-ref-source") as HTMLElement;
      // 模拟点击/键盘导航把光标放进块内文本（锁定下仍允许选择与导航）
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)),
      );
      expect(source.style.display).toBe("none");
      expect(render.style.display).not.toBe("none");
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("returns to source mode after unlock when the caret is inside", () => {
    const doc = parse("![](drawings/flow.excalidraw)");
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
      const block = mount.querySelector(".image-ref-block") as HTMLElement;
      const render = block.querySelector(".image-ref-render") as HTMLElement;
      const source = block.querySelector(".image-ref-source") as HTMLElement;
      // 锁定时光标落入块内 → 仍是预览
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)),
      );
      expect(source.style.display).toBe("none");
      // 解锁 → 光标在块内 → 回到源码编辑态
      view.dispatch(view.state.tr.setMeta(lockKey, true));
      expect(view.editable).toBe(true);
      expect(source.style.display).not.toBe("none");
      expect(render.style.display).toBe("none");
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});

runFeatureCases(imageRefSpecs);
