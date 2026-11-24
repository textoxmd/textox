import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { defaultPlugins } from "../src/editor.ts";
import { parse } from "../src/parser.ts";
import { getSchema } from "../src/schema.ts";

type WidgetDesc = {
  stopEvent(event: Event): boolean;
  widget: { spec: { ignoreSelection?: boolean } };
};

function mount(md: string): EditorView {
  const schema = getSchema();
  const doc = parse(md);
  const state = EditorState.create({
    schema,
    doc,
    plugins: defaultPlugins({ cursorWidget: false }),
  });
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new EditorView(el, { state });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("inline math widget event handling", () => {
  it("does not swallow mousedown on the rendered math widget (click-to-edit)", () => {
    // 光标初始在文档开头（公式 span 之外）→ math-render widget 出现
    const view = mount("before $x^2$ after ");
    const mathEl = view.dom.querySelector("math-jax") as
      | (HTMLElement & { pmViewDesc?: WidgetDesc })
      | null;
    expect(mathEl).not.toBeNull();
    expect(mathEl!.pmViewDesc).toBeDefined();
    // pmViewDesc 是 PM 私有属性；以它作结构守卫是权衡，PM 升级时需同步核对。
    expect(
      mathEl!.pmViewDesc!.stopEvent(new Event("mousedown", { bubbles: true })),
    ).toBe(false);
    view.destroy();
  });
});

// 本次把 widget spec 按 kind 拆分（内置 kind 沿用旧的事件语义，插件 kind
// 走 PM 默认 spec）。下面锁死「内置 kind 保持吞事件语义」，防止拆分后内置侧
// 静默回退、失去保护。
describe("builtin widget event semantics", () => {
  it("emoji widget stops mousedown/keydown and ignores selection", () => {
    const view = mount(":smile: ");
    const emojiEl = view.dom.querySelector(".emoji-glyph") as
      | (HTMLElement & { pmViewDesc?: WidgetDesc })
      | null;
    expect(emojiEl).not.toBeNull();
    expect(emojiEl!.pmViewDesc).toBeDefined();
    expect(
      emojiEl!.pmViewDesc!.stopEvent(new Event("mousedown", { bubbles: true })),
    ).toBe(true);
    expect(
      emojiEl!.pmViewDesc!.stopEvent(new Event("keydown", { bubbles: true })),
    ).toBe(true);
    expect(emojiEl!.pmViewDesc!.widget.spec.ignoreSelection).toBe(true);
    view.destroy();
  });

  it("image widget lets mousedown through but stops keydown", () => {
    // 独占一行的 `![alt](src)` 会被解析为 image_ref 块节点（NodeView，无
    // pmViewDesc）；这里用「段落中间」的行内图片，才会走 image-render widget。
    const view = mount("text ![alt](probe-img.png) more");
    const imgEl = view.dom.querySelector("img.image-render") as
      | (HTMLImageElement & { pmViewDesc?: WidgetDesc })
      | null;
    expect(imgEl).not.toBeNull();
    expect(imgEl!.pmViewDesc).toBeDefined();
    expect(
      imgEl!.pmViewDesc!.stopEvent(new Event("mousedown", { bubbles: true })),
    ).toBe(false);
    expect(
      imgEl!.pmViewDesc!.stopEvent(new Event("keydown", { bubbles: true })),
    ).toBe(true);
    view.destroy();
  });
});
