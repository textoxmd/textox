import { describe, expect, it } from "vitest";
import type { EditorView } from "prosemirror-view";

import { getScrollParent } from "../src/scroll-parent.ts";

function fakeView(dom: HTMLElement): EditorView {
  return { dom } as unknown as EditorView;
}

describe("getScrollParent", () => {
  it("返回最近的可纵向滚动祖先", () => {
    const outer = document.createElement("div");
    outer.style.overflowY = "auto";
    const middle = document.createElement("div");
    const root = document.createElement("div");
    middle.appendChild(root);
    outer.appendChild(middle);
    document.body.appendChild(outer);

    expect(getScrollParent(fakeView(root))).toBe(outer);
    outer.remove();
  });

  it("没有可滚动祖先时回退到 parentElement", () => {
    const parent = document.createElement("div");
    const root = document.createElement("div");
    parent.appendChild(root);
    document.body.appendChild(parent);

    expect(getScrollParent(fakeView(root))).toBe(parent);
    parent.remove();
  });
});
