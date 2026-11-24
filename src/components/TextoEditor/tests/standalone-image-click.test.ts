import { describe, expect, test } from "vitest";
import { EditorView } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";
import { setup } from "./utils.ts";

describe("standalone image block interaction", () => {
  const md = `![alt](https://x/img.png)`;

  test("renders as an image_ref block with a block-level preview", () => {
    const state = setup(md);
    const stateOutside = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 0)),
    );
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state: stateOutside });
    try {
      const block = mount.querySelector(".image-ref-block") as HTMLElement | null;
      expect(block).toBeTruthy();
      const img = block?.querySelector("img.image-ref-img") as HTMLImageElement | null;
      expect(img).toBeTruthy();
      expect(img!.src).toContain("img.png");
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("clicking the preview enters the editable source text", () => {
    const state = setup(md);
    const stateOutside = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 0)),
    );
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state: stateOutside });
    try {
      const block = mount.querySelector(".image-ref-block") as HTMLElement;
      const render = block.querySelector(
        ".image-ref-render",
      ) as HTMLElement;
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
      // 光标进入块内 → 源码编辑态
      expect(source.style.display).not.toBe("none");
      expect(render.style.display).toBe("none");
      expect(view.state.selection.from).toBeGreaterThan(0);
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});
