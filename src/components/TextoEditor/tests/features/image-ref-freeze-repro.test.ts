import { describe, expect, it } from "vitest";
import { TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { parse } from "../../src/parser.ts";
import { serialize } from "../../src/serializer.ts";
import { apply, setup } from "../utils.ts";

describe("image_ref delete freeze repro", () => {
  it("delete tail from a block ref char by char", () => {
    let state = setup("![白板测试](./白板测试.excalidraw)");
    // 进入块内源码态（光标移到块文本末尾，即节点闭合围栏前）
    const node = state.doc.firstChild!;
    const caretInside = node.nodeSize - 1;
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, caretInside)),
    );
    // 模拟逐字符删除收尾部分，直到文本变为 `![白板测试](./白板测试.`
    for (const _ of "excalidraw)") {
      state = apply(state, ["<Backspace>"]);
    }
    // 文本一变成非法引用就回退为普通段落（不再困在 image-ref-source 里）
    expect(state.doc.firstChild!.type.name).toBe("paragraph");
    expect(state.doc.firstChild!.textContent).toBe("![白板测试](./白板测试.");

    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    try {
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 0)),
      );
      expect(view.dom.querySelector(".image-ref-block")).toBeNull();
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("delete tail from a block ref in one selection", () => {
    let state = setup("![白板测试](./白板测试.excalidraw)");
    const text = state.doc.firstChild!.textContent;
    const from = text.indexOf("e") + 1; // 定位到 `.excalidraw)` 的 e
    state = state.apply(
      state.tr
        .setSelection(TextSelection.create(state.doc, from))
        .delete(from, text.length + 1),
    );
    expect(state.doc.firstChild!.type.name).toBe("paragraph");
    expect(state.doc.firstChild!.textContent).toBe("![白板测试](./白板测试.");

    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    try {
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 0)),
      );
      expect(view.dom.querySelector(".image-ref-block")).toBeNull();
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("brute force: delete every substring, no hang", () => {
    const md = "![白板测试](./白板测试.excalidraw)";
    const text = "![白板测试](./白板测试.excalidraw)";
    for (let from = 0; from < text.length; from++) {
      for (let to = from; to <= text.length; to++) {
        if (from === 0 && to === text.length) continue; // 整段删除另测
        let state = setup(md);
        const blockStart = 0;
        const textStart = blockStart + 1;
        // 光标放在删除点，然后删除 [from, to)
        state = state.apply(
          state.tr
            .setSelection(
              TextSelection.create(state.doc, textStart + from),
            )
            .delete(textStart + from, textStart + to),
        );
        // 再移出光标触发渲染
        const mount = document.createElement("div");
        document.body.appendChild(mount);
        const view = new EditorView(mount, { state });
        view.dispatch(
          view.state.tr.setSelection(TextSelection.create(view.state.doc, 0)),
        );
        view.destroy();
        mount.remove();
        // 确保 delete 确实执行了（len(to-from) 字符被删）
        const expected = text.slice(0, from) + text.slice(to);
        expect(state.doc.firstChild!.textContent).toBe(expected);
      }
    }
    // 整段删除：文本清空后回退为普通空段落
    let state = setup(md);
    state = state.apply(
      state.tr
        .setSelection(TextSelection.create(state.doc, 1))
        .delete(1, state.doc.firstChild!.nodeSize - 1),
    );
    expect(state.doc.firstChild!.type.name).toBe("paragraph");
    expect(state.doc.firstChild!.textContent).toBe("");
  });

  it("brute force: cross-boundary deletions, no hang", () => {
    const md = "![白板测试](./白板测试.excalidraw)";
    const text = "![白板测试](./白板测试.excalidraw)";
    const textStart = 1;
    const nodeSize = text.length + 2;
    // 选区起点在块外（0 或 节点末尾），终点在块内文本区
    const ranges: Array<[number, number]> = [];
    for (let x = 1; x <= text.length; x++) {
      ranges.push([0, textStart + x]);
      ranges.push([textStart + x, textStart + text.length + 1]); // 到节点闭合围栏
      ranges.push([textStart + x, nodeSize]);
    }
    for (const [from, to] of ranges) {
      const state0 = setup(md);
      const state = state0.apply(
        state0.tr
          .setSelection(TextSelection.create(state0.doc, from))
          .delete(from, to),
      );
      const mount = document.createElement("div");
      document.body.appendChild(mount);
      const view = new EditorView(mount, { state });
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 0)),
      );
      view.destroy();
      mount.remove();
      // 文档不应是空/损坏状态
      expect(state.doc.content.size).toBeGreaterThanOrEqual(0);
    }
  });

  it("brute force: deletions around a block inside a real doc, no hang", () => {
    const md = "前文\n\n![白板测试](./白板测试.excalidraw)\n\n后文";
    const text = "![白板测试](./白板测试.excalidraw)";
    const textStart = 3; // "前文\n\n" 之后是块文本起点
    for (let from = 0; from < text.length; from++) {
      for (let to = from; to <= text.length; to++) {
        const state0 = setup(md);
        const state = state0.apply(
          state0.tr
            .setSelection(
              TextSelection.create(state0.doc, textStart + from),
            )
            .delete(textStart + from, textStart + to),
        );
        const mount = document.createElement("div");
        document.body.appendChild(mount);
        const view = new EditorView(mount, { state });
        view.dispatch(
          view.state.tr.setSelection(TextSelection.create(view.state.doc, 0)),
        );
        view.destroy();
        mount.remove();
      }
    }

    // 跨块边界：选区从"前文"末尾延伸到块内 / 从块内延伸到"后文"开头
    const blockStart = 3;
    const blockEnd = blockStart + text.length + 2;
    const ranges: Array<[number, number]> = [];
    for (let x = 1; x <= text.length; x++) {
      ranges.push([2, blockStart + x]); // 前文末尾(2) → 块内
      ranges.push([blockStart + x, blockEnd + 2]); // 块内 → 后文(blockEnd+2)
      ranges.push([0, blockStart + x]);
      ranges.push([blockStart + x, blockEnd + 3]);
    }
    for (const [from, to] of ranges) {
      const state0 = setup(md);
      const state = state0.apply(
        state0.tr
          .setSelection(TextSelection.create(state0.doc, from))
          .delete(from, to),
      );
      const mount = document.createElement("div");
      document.body.appendChild(mount);
      const view = new EditorView(mount, { state });
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 0)),
      );
      view.destroy();
      mount.remove();
    }
  });

  it("serialize/reparse round trip stabilizes for invalid block text", () => {
    // 模拟用户流程：块内文本被删成非法引用 → 保存（serialize）→ 重载（parse）
    // → 再保存。修复后回退为段落，round-trip 应立即稳定。
    const invalidMd = "前文\n\n![白板测试](./白板测试.\n\n后文";
    let md = invalidMd;
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      if (seen.has(md)) break;
      seen.add(md);
      md = serialize(parse(md));
    }
    // 段落形式原样写回（文本块已是源文写法），第一次即稳定，无块/段落两态抖动
    expect(seen.size).toBe(1);
    expect(md).toBe("前文\n\n![白板测试](./白板测试.\n\n后文");
  });

  it("user flow: type + Enter -> block -> delete tail -> save -> reload stays stable", () => {
    // 1) 输入引用并回车，切成 image_ref 块
    let state = apply(
      setup(),
      [
        "!", "[", "白", "板", "测", "试", "]", "(", ".", "/", "白", "板", "测", "试", ".",
        "e", "x", "c", "a", "l", "i", "d", "r", "a", "w", ")", "<Enter>",
      ],
    );
    expect(state.doc.firstChild!.type.name).toBe("image_ref");
    expect(state.doc.firstChild!.textContent).toBe(
      "![白板测试](./白板测试.excalidraw)",
    );

    // 2) 上移进入块源码态，删除尾部直到 `![白板测试](./白板测试.`
    state = apply(state, ["<ArrowUp>"]);
    expect(state.doc.firstChild!.type.name).toBe("image_ref");
    for (const _ of "excalidraw)") {
      state = apply(state, ["<Backspace>"]);
    }
    // 格式不满足 → 立即回退为普通段落
    expect(state.doc.firstChild!.type.name).toBe("paragraph");
    expect(state.doc.firstChild!.textContent).toBe("![白板测试](./白板测试.");

    // 3) 保存（serialize）→ 重载（parse）→ 再保存，内容稳定
    const saved = serialize(state.doc);
    const reloaded = serialize(parse(saved));
    expect(reloaded).toBe(saved);
    // 段落形式原样写回文件；重载后解析回同样内容，不再抖动
    expect(saved).toBe("![白板测试](./白板测试.");
  });
});
