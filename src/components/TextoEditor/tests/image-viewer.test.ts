import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  EditorState,
  Plugin,
  PluginKey,
  TextSelection,
} from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { parse } from "../src/parser.ts";
import { getSchema } from "../src/schema.ts";

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});
import { defaultPlugins } from "../src/editor.ts";
import {
  closeImageViewer,
  isImageViewerOpen,
  openImageViewer,
  openMediaContainer,
  svgDownloadNameFromSource,
} from "../src/features/image-viewer.ts";
import {
  getEditorHost,
  setEditorHost,
  type EditorHost,
  type SaveMediaRequest,
  type SaveMediaResult,
} from "../src/host.ts";
import { defineCodeBlockExtension, defineEmbedExtension } from "@texto/markdown-editor-api";
import { setEditorExtensions } from "./helpers/editor-extensions.ts";

const lockKey = new PluginKey<boolean>("image-viewer-test-locked");

const defaultHost = getEditorHost();

function recordSaveMedia(
  result: SaveMediaResult = { saved: true },
): SaveMediaRequest[] {
  const calls: SaveMediaRequest[] = [];
  const host: EditorHost = {
    ...defaultHost,
    saveMedia: async (request) => {
      calls.push(request);
      return result;
    },
  };
  setEditorHost(host);
  return calls;
}

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

function mountDoc(md: string, editable = true) {
  const doc = parse(md);
  const state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 0),
    plugins: [
      ...(editable ? [] : [withEditable(false)]),
      ...defaultPlugins({ cursorWidget: false, documentPath: "/Users/u/notes.md" }),
    ],
  });
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const view = new EditorView(mount, { state });
  return { view, mount };
}

function overlay(): HTMLElement | null {
  return document.body.querySelector(".image-viewer-overlay");
}

function backdrop(): HTMLElement {
  return overlay()!.querySelector(".image-viewer-backdrop") as HTMLElement;
}

function click(target: Element): void {
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
  );
}

function clickPoint(target: Element, clientX: number, clientY: number): void {
  target.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX,
      clientY,
    }),
  );
}

/** 关闭动画：缩放 200ms + 背景淡出 100ms + 余量 */
const settleClose = () => new Promise((r) => setTimeout(r, 460));
/** 程序化缩放分两帧启动（过渡属性先落地，值下一帧才改） */
const nextFrame = () => new Promise((r) => setTimeout(r, 40));

function rectOf(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

afterEach(() => {
  closeImageViewer();
  setEditorHost(defaultHost);
  document.body.innerHTML = "";
});

describe("image viewer overlay", () => {
  it("opens for an image source and closes on Esc", async () => {
    openImageViewer({ kind: "img", src: "https://x/img.png", alt: "图" });
    expect(isImageViewerOpen()).toBe(true);
    const root = overlay()!;
    const img = root.querySelector(".image-viewer-content img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toContain("img.png");
    expect(root.querySelector(".image-viewer-zoom-label")!.textContent).toBe(
      "100%",
    );

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(isImageViewerOpen()).toBe(false);
    await settleClose();
    expect(overlay()).toBeNull();
  });

  it("opens with a zoom animation growing out of the source image", async () => {
    const origin = document.createElement("img");
    origin.getBoundingClientRect = () => rectOf(300, 200, 240, 120);
    document.body.appendChild(origin);
    const pane = document.createElement("div");
    pane.className = "editor-area";
    pane.getBoundingClientRect = () => rectOf(240, 0, 1200, 900);
    document.body.appendChild(pane);

    openImageViewer({
      kind: "img",
      src: "https://x/img.png",
      naturalWidth: 1200,
      naturalHeight: 600,
      origin,
    });
    const root = overlay()!;
    const content = root.querySelector(".image-viewer-content") as HTMLElement;
    // 首帧：内容摆在编辑器里原图的位置与大小（240 / 1200 = 0.2）
    expect(content.style.transform).toContain("scale(0.2000)");
    // 过渡属性已在首帧落地，值留到下一帧（避免引擎跳过过渡直接跳到终点）
    expect(content.style.transition).toMatch(/transform 400ms/);
    // 背景单独一层从透明淡入：浮层自身不参与透明度变化（副本全程不透明）
    expect(backdrop().style.opacity).toBe("0");
    expect(backdrop().style.transition).toMatch(/opacity 250ms/);
    expect(root.style.opacity).toBe("");

    // 下一帧过渡到「适应窗口」
    await new Promise((r) => setTimeout(r, 60));
    expect(content.style.transition).toContain("transform");
    expect(content.style.transform).toBe("translate3d(0.00px, 0.00px, 0) scale(0.94) rotate(0deg)");
    expect(backdrop().style.opacity).toBe("1");
  });

  it("skips the zoom animation when reduce motion is enabled", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    try {
      const origin = document.createElement("img");
      origin.getBoundingClientRect = () => rectOf(300, 200, 240, 120);
      document.body.appendChild(origin);
      const pane = document.createElement("div");
      pane.className = "editor-area";
      pane.getBoundingClientRect = () => rectOf(240, 0, 1200, 900);
      document.body.appendChild(pane);

      openImageViewer({
        kind: "img",
        src: "https://x/img.png",
        naturalWidth: 1200,
        naturalHeight: 600,
        origin,
      });
      const content = overlay()!.querySelector(
        ".image-viewer-content",
      ) as HTMLElement;
      // 不做缩放动画：直接落在适应窗口的位置
      expect(content.style.transition).toBe("none");
      expect(content.style.transform).toContain("scale(0.94)");
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("zooms in / out from the toolbar and returns to 100% via the label", () => {
    openImageViewer({ kind: "img", src: "https://x/img.png" });
    const root = overlay()!;
    expect(root.dataset.scale).toBe("1.000");

    click(root.querySelector(".image-viewer-zoom-in")!);
    expect(Number(root.dataset.scale)).toBeGreaterThan(1);
    expect(root.querySelector(".image-viewer-zoom-label")!.textContent).toBe(
      "125%",
    );

    click(root.querySelector(".image-viewer-zoom-out")!);
    expect(root.dataset.scale).toBe("1.000");

    click(root.querySelector(".image-viewer-zoom-out")!);
    expect(Number(root.dataset.scale)).toBeLessThan(1);
    click(root.querySelector(".image-viewer-zoom-label")!);
    expect(root.dataset.scale).toBe("1.000");
  });

  it("zooms with the wheel and rotates from the toolbar", () => {
    openImageViewer({ kind: "img", src: "https://x/img.png" });
    const root = overlay()!;

    root.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true }),
    );
    expect(Number(root.dataset.scale)).toBeGreaterThan(1);

    click(root.querySelector(".image-viewer-rotate")!);
    expect(root.dataset.rotation).toBe("90");
  });

  it("shows a hairline ring only while dragging", () => {
    openImageViewer({ kind: "img", src: "https://x/img.png" });
    const root = overlay()!;
    const stage = root.querySelector(".image-viewer-stage") as HTMLElement;
    const content = root.querySelector(".image-viewer-content") as HTMLElement;
    const pointer = (type: string, x: number, y: number) =>
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
      });

    // 静止时完全融入背景：无描边、无投影
    expect(content.style.boxShadow).toBe("none");

    // 拖动开始 → 出现贴边 1px 细线（无模糊 / 偏移）
    stage.dispatchEvent(pointer("pointerdown", 100, 100));
    expect(content.style.boxShadow).toContain("0 0 0 1.000px");
    expect(content.style.boxShadow).not.toMatch(/\d+px \d+px \d+px/);

    // 拖动中保持
    stage.dispatchEvent(pointer("pointermove", 180, 150));
    expect(content.style.boxShadow).toContain("0 0 0 1.000px");

    // 松手 → 细线消失
    stage.dispatchEvent(pointer("pointerup", 180, 150));
    expect(content.style.boxShadow).toBe("none");
  });

  it("keeps the toolbar to zoom / rotate / close (no fit button)", () => {
    openImageViewer({ kind: "img", src: "https://x/img.png" });
    const root = overlay()!;
    const classes = Array.from(
      root.querySelectorAll(".image-viewer-btn, .image-viewer-zoom-label"),
    ).map((el) => el.className);
    // 「适应窗口」按钮已移除：浮层本身就是适应窗口状态，点它没有反馈
    expect(classes.some((c) => c.includes("image-viewer-fit"))).toBe(false);
    expect(classes.some((c) => c.includes("image-viewer-zoom-out"))).toBe(true);
    expect(classes.some((c) => c.includes("image-viewer-zoom-label"))).toBe(true);
    expect(classes.some((c) => c.includes("image-viewer-zoom-in"))).toBe(true);
    expect(classes.some((c) => c.includes("image-viewer-rotate"))).toBe(true);
    expect(classes.some((c) => c.includes("image-viewer-download"))).toBe(true);
    expect(classes.some((c) => c.includes("image-viewer-close"))).toBe(true);
  });

  it("downloads the current image through the host", async () => {
    const calls = recordSaveMedia();
    openImageViewer({ kind: "img", src: "https://x/img.png" });
    const button = overlay()!.querySelector(
      ".image-viewer-download",
    ) as HTMLButtonElement;
    expect(button).toBeTruthy();

    click(button);
    await new Promise((r) => setTimeout(r, 0));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.source).toEqual({
      kind: "url",
      url: "https://x/img.png",
    });
    expect(calls[0]!.suggestedName).toBe("img.png");
    expect(calls[0]!.extension).toBe("png");
    expect(calls[0]!.filterName).toBe("Image");
  });

  it("uses the basename of a local asset url", async () => {
    const calls = recordSaveMedia();
    openImageViewer({
      kind: "img",
      src: "asset://localhost/%2FUsers%2Fu%2Fassets%2Fa.png",
    });
    click(overlay()!.querySelector(".image-viewer-download")!);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls[0]!.suggestedName).toBe("a.png");
  });

  it("uses the basename of an encoded windows asset url", async () => {
    const calls = recordSaveMedia();
    openImageViewer({
      kind: "img",
      src: "http://asset.localhost/C%3A%5CUsers%5Cu%5CPictures%5Ccat.png",
    });
    click(overlay()!.querySelector(".image-viewer-download")!);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls[0]!.suggestedName).toBe("cat.png");
  });

  it("falls back to image.png when the url has no image extension", async () => {
    const calls = recordSaveMedia();
    openImageViewer({ kind: "img", src: "https://picsum.photos/800/600" });
    click(overlay()!.querySelector(".image-viewer-download")!);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls[0]!.suggestedName).toBe("image.png");
    expect(calls[0]!.extension).toBe("png");
  });

  it("uses the real image extension even when a vector name is suggested", async () => {
    const calls = recordSaveMedia();
    openImageViewer({
      kind: "img",
      src: "https://x/flow.png",
      suggestedName: "flow.svg",
    });
    click(overlay()!.querySelector(".image-viewer-download")!);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls[0]!.suggestedName).toBe("flow.png");
    expect(calls[0]!.extension).toBe("png");
  });

  it("falls back to image.png for a query-only url", async () => {
    const calls = recordSaveMedia();
    openImageViewer({
      kind: "img",
      src: "https://x/download?file=cat.png",
    });
    click(overlay()!.querySelector(".image-viewer-download")!);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls[0]!.suggestedName).toBe("image.png");
  });

  it("downloads a rendered SVG as text", async () => {
    const calls = recordSaveMedia();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 320 180");
    svg.innerHTML = '<rect width="320" height="180" fill="#f00"/>';

    openImageViewer({
      kind: "element",
      element: svg,
      suggestedName: "mermaid.svg",
    });
    click(overlay()!.querySelector(".image-viewer-download")!);
    await new Promise((r) => setTimeout(r, 0));

    expect(calls).toHaveLength(1);
    const source = calls[0]!.source;
    expect(source.kind).toBe("text");
    if (source.kind !== "text") throw new Error("expected text source");
    expect(source.mimeType).toBe("image/svg+xml");
    expect(source.text).toContain("<svg");
    expect(source.text).toContain('width="320"');
    expect(source.text).not.toContain("max-width");
    expect(source.text).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(calls[0]!.suggestedName).toBe("mermaid.svg");
    expect(calls[0]!.extension).toBe("svg");
  });

  it("adds the xlink namespace when the SVG uses xlink", async () => {
    const calls = recordSaveMedia();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 10 10");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttributeNS(
      "http://www.w3.org/1999/xlink",
      "xlink:href",
      "#shape",
    );
    svg.appendChild(use);

    openImageViewer({ kind: "element", element: svg });
    click(overlay()!.querySelector(".image-viewer-download")!);
    await new Promise((r) => setTimeout(r, 0));

    const source = calls[0]!.source;
    if (source.kind !== "text") throw new Error("expected text source");
    expect(source.text).toContain("xmlns:xlink");
  });

  it("does not offer download when a rendered element has no SVG", () => {
    const div = document.createElement("div");
    div.innerHTML = "<span>plain</span>";
    openImageViewer({ kind: "element", element: div });
    expect(overlay()!.querySelector(".image-viewer-download")).toBeNull();
  });

  it("keeps the viewer open and re-enables the button when saving is cancelled", async () => {
    recordSaveMedia({ saved: false });
    openImageViewer({ kind: "img", src: "https://x/img.png" });
    const button = overlay()!.querySelector(
      ".image-viewer-download",
    ) as HTMLButtonElement;

    click(button);
    await new Promise((r) => setTimeout(r, 0));

    expect(isImageViewerOpen()).toBe(true);
    expect(button.disabled).toBe(false);
  });

  it("disables the download button while a save is pending", async () => {
    let resolveSave!: (value: SaveMediaResult) => void;
    const pending = new Promise<SaveMediaResult>((resolve) => {
      resolveSave = resolve;
    });
    setEditorHost({ ...defaultHost, saveMedia: () => pending });

    openImageViewer({ kind: "img", src: "https://x/img.png" });
    const button = overlay()!.querySelector(
      ".image-viewer-download",
    ) as HTMLButtonElement;
    click(button);
    expect(button.disabled).toBe(true);

    resolveSave({ saved: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(button.disabled).toBe(false);
  });

  it("drops the compositing hint after the gesture so content re-rasterizes sharp", async () => {
    openImageViewer({ kind: "img", src: "https://x/img.png" });
    const root = overlay()!;
    const stage = root.querySelector(".image-viewer-stage") as HTMLElement;

    // 操作中：提升为合成层（拖动 / 滚轮跟手）
    stage.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
        button: 0,
      }),
    );
    stage.dispatchEvent(
      new MouseEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        clientX: 140,
        clientY: 120,
        button: 0,
      }),
    );
    expect(root.classList.contains("is-transforming")).toBe(true);

    // 停下来后撤掉提示 → 在最终比例上重新栅格化（避免放大后发虚）
    await new Promise((r) => setTimeout(r, 260));
    expect(root.classList.contains("is-transforming")).toBe(false);
  });

  it("clones a rendered SVG with its intrinsic size", () => {
    const source = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    source.setAttribute("viewBox", "0 0 320 180");
    source.innerHTML = '<rect width="320" height="180" fill="#f00"/>';

    openImageViewer({ kind: "element", element: source });
    const clone = overlay()!.querySelector(
      ".image-viewer-content svg",
    ) as SVGElement;
    expect(clone).toBeTruthy();
    expect(clone.getAttribute("width")).toBe("320");
    expect(clone.getAttribute("height")).toBe("180");
    // 克隆是副本：不搬走原节点
    expect(source.parentElement).toBeNull();
  });

  it("uses a formula's declared ex size instead of its viewBox units", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    // 公式（MathJax）SVG：width/height 是 ex，viewBox 是内部单位（大两个数量级）
    svg.style.fontSize = "10px";
    svg.setAttribute("width", "40ex");
    svg.setAttribute("height", "2ex");
    svg.setAttribute("viewBox", "0 -1000 6000 1000");
    svg.innerHTML = '<rect width="6000" height="1000"/>';

    openImageViewer({ kind: "element", element: svg });
    const clone = overlay()!.querySelector(
      ".image-viewer-content svg",
    ) as SVGElement;
    // 按 ex 换算（happy-dom 没有 x-height 度量 → 1ex 回退 0.5em），
    // 绝不能拿到 viewBox 的 6000 / 1000
    const fontPx = Number.parseFloat(getComputedStyle(svg).fontSize) || 16;
    expect(Number(clone.getAttribute("width"))).toBeCloseTo(40 * fontPx * 0.5);
    expect(Number(clone.getAttribute("height"))).toBeCloseTo(2 * fontPx * 0.5);
    expect(Number(clone.getAttribute("width"))).toBeLessThan(1000);
  });

  it("keeps mermaid's max-width + viewBox sizing", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.maxWidth = "640px";
    svg.setAttribute("viewBox", "0 0 640 320");

    openImageViewer({ kind: "element", element: svg });
    const clone = overlay()!.querySelector(
      ".image-viewer-content svg",
    ) as SVGElement;
    expect(clone.getAttribute("width")).toBe("640");
    expect(clone.getAttribute("height")).toBe("320");
  });

  it("hides the source image during the transition and restores it on close", async () => {
    const origin = document.createElement("img");
    origin.getBoundingClientRect = () => rectOf(300, 200, 240, 120);
    origin.style.visibility = "visible";
    document.body.appendChild(origin);

    openImageViewer({
      kind: "img",
      src: "https://x/img.png",
      naturalWidth: 1200,
      naturalHeight: 600,
      origin,
    });
    // 背景不透明之后才隐藏源图（此刻副本已放大走开，背景挡住了空洞）
    await new Promise((r) => setTimeout(r, 420));
    expect(origin.style.visibility).toBe("hidden");

    closeImageViewer();
    await settleClose();
    expect(origin.style.visibility).toBe("visible");
  });

  it("restores the source image when reopened before the close finishes", async () => {
    const origin = document.createElement("img");
    origin.getBoundingClientRect = () => rectOf(300, 200, 240, 120);
    origin.style.visibility = "visible";
    document.body.appendChild(origin);
    const open = () =>
      openImageViewer({
        kind: "img",
        src: "https://x/img.png",
        naturalWidth: 1200,
        naturalHeight: 600,
        origin,
      });

    open();
    closeImageViewer();
    // 关闭动画还没跑完就再次打开同一张图：隐藏状态要按引用计数记，不能把
    // 上一次留下的 hidden 当成"原值"写回去（否则原图永久隐藏）
    open();
    await settleClose();
    expect(origin.style.visibility).toBe("hidden");

    closeImageViewer();
    await settleClose();
    expect(origin.style.visibility).toBe("visible");
  });

  it("returns focus to the editor when closing", async () => {
    const editor = document.createElement("div");
    editor.tabIndex = 0;
    document.body.appendChild(editor);
    editor.focus();
    expect(document.activeElement).toBe(editor);

    openImageViewer({ kind: "img", src: "https://x/img.png" });
    expect(document.activeElement).not.toBe(editor);

    closeImageViewer();
    await settleClose();
    expect(document.activeElement).toBe(editor);
  });

  it("keeps the background opaque until the zoom-back finishes (no blink)", async () => {
    const origin = document.createElement("img");
    origin.getBoundingClientRect = () => rectOf(300, 200, 240, 120);
    origin.style.visibility = "visible";
    document.body.appendChild(origin);

    openImageViewer({
      kind: "img",
      src: "https://x/img.png",
      naturalWidth: 1200,
      naturalHeight: 600,
      origin,
    });
    // 等打开流程走完（背景不透明、源图已隐藏）再关闭
    await new Promise((r) => setTimeout(r, 420));
    closeImageViewer();

    // 缩放期间：背景保持完全不透明（只设置了过渡，值还没改）
    expect(backdrop().style.transition).toMatch(/opacity 100ms/);
    expect(backdrop().style.opacity).toBe("1");

    // 缩放中段：源图仍隐藏、浮层仍不透明 —— 不会露出一块空洞，也不会闪
    await new Promise((r) => setTimeout(r, 150));
    expect(overlay()).not.toBeNull();
    expect(backdrop().style.opacity).toBe("1");
    expect(origin.style.visibility).toBe("hidden");

    // 缩放落位后：先还原原图（副本正好压在它上面，视觉上无缝），再淡出背景
    await new Promise((r) => setTimeout(r, 110));
    expect(origin.style.visibility).toBe("visible");
    expect(backdrop().style.opacity).toBe("0");

    await settleClose();
    expect(overlay()).toBeNull();
    expect(origin.style.visibility).toBe("visible");
  });

  it("keeps the current rotation while zooming back", async () => {
    const origin = document.createElement("img");
    origin.getBoundingClientRect = () => rectOf(300, 200, 240, 120);
    document.body.appendChild(origin);

    openImageViewer({
      kind: "img",
      src: "https://x/img.png",
      naturalWidth: 1200,
      naturalHeight: 600,
      origin,
    });
    const content = overlay()!.querySelector(
      ".image-viewer-content",
    ) as HTMLElement;
    click(overlay()!.querySelector(".image-viewer-rotate")!);
    await nextFrame();
    expect(content.style.transform).toContain("rotate(90deg)");

    closeImageViewer();
    await nextFrame();
    // 收尾时不"摆正"回 0°：避免关闭瞬间转一下
    expect(content.style.transform).toContain("rotate(90deg)");
  });

  it("keeps the compositing hint through the whole open animation", async () => {
    const origin = document.createElement("img");
    origin.getBoundingClientRect = () => rectOf(300, 200, 240, 120);
    document.body.appendChild(origin);

    openImageViewer({
      kind: "img",
      src: "https://x/img.png",
      naturalWidth: 1200,
      naturalHeight: 600,
      origin,
    });
    const root = overlay()!;

    // 动画结束后仍保持合成层：中途撤销会重建图层、重新栅格化，正好卡一下
    await new Promise((r) => setTimeout(r, 250));
    expect(root.classList.contains("is-transforming")).toBe(true);

    await new Promise((r) => setTimeout(r, 550));
    expect(root.classList.contains("is-transforming")).toBe(false);
  });

  it("choreographs background, content and toolbar separately", async () => {
    const origin = document.createElement("img");
    origin.getBoundingClientRect = () => rectOf(300, 200, 240, 120);
    document.body.appendChild(origin);

    openImageViewer({
      kind: "img",
      src: "https://x/img.png",
      naturalWidth: 1200,
      naturalHeight: 600,
      origin,
    });
    const root = overlay()!;
    const toolbar = root.querySelector(".image-viewer-toolbar") as HTMLElement;
    const content = root.querySelector(".image-viewer-content") as HTMLElement;

    // 首帧：工具栏退到下方且透明 —— 内容先动、控件后到
    expect(toolbar.style.opacity).toBe("0");
    expect(toolbar.style.transform).toContain("translateY(6px)");

    await new Promise((r) => setTimeout(r, 60));
    // 内容 400ms、背景 250ms 单独淡入、工具栏延迟 100ms 错后淡入
    expect(content.style.transition).toMatch(/transform 400ms/);
    expect(backdrop().style.transition).toMatch(/opacity 250ms/);
    expect(backdrop().style.opacity).toBe("1");
    expect(toolbar.style.transition).toContain("100ms");
    expect(toolbar.style.opacity).toBe("1");
  });

  it("never scales up on the way back for a tall image (no grow-then-shrink)", () => {
    // 竖长图：编辑器里按原始尺寸铺开（比编辑区还高），放大层里只能按高度适应
    const origin = document.createElement("img");
    origin.getBoundingClientRect = () => rectOf(300, 100, 800, 2000);
    document.body.appendChild(origin);
    const pane = document.createElement("div");
    pane.className = "editor-area";
    pane.getBoundingClientRect = () => rectOf(240, 0, 1200, 900);
    document.body.appendChild(pane);

    openImageViewer({
      kind: "img",
      src: "https://x/img.png",
      naturalWidth: 800,
      naturalHeight: 2000,
      origin,
    });
    const root = overlay()!;
    const content = root.querySelector(".image-viewer-content") as HTMLElement;
    const scaleOf = (transform: string) =>
      Number(/scale\(([\d.]+)\)/.exec(transform)?.[1] ?? NaN);

    // 适应窗口：被高度限制（0.94 * 900 / 2000 ≈ 0.42）
    const fit = Number(root.dataset.scale);
    expect(fit).toBeLessThan(1);
    // 打开起点不放大：不会以编辑器里的原始尺寸（1x）开场
    expect(scaleOf(content.style.transform)).toBeLessThanOrEqual(fit + 1e-6);

    // 关闭落点同样不超过当前比例
    closeImageViewer();
    expect(scaleOf(content.style.transform)).toBeLessThanOrEqual(fit + 1e-6);
  });

  it("keeps the overlay open when a drag ends (drag must not count as a click)", () => {
    openImageViewer({ kind: "img", src: "https://x/img.png" });
    const root = overlay()!;
    const stage = root.querySelector(".image-viewer-stage") as HTMLElement;
    const pointer = (type: string, x: number, y: number) =>
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
      });

    stage.dispatchEvent(pointer("pointerdown", 100, 100));
    stage.dispatchEvent(pointer("pointermove", 180, 150));
    stage.dispatchEvent(pointer("pointerup", 180, 150));
    // 浏览器在拖拽结束后补发的 click
    stage.dispatchEvent(pointer("click", 180, 150));

    expect(isImageViewerOpen()).toBe(true);
    const content = root.querySelector(".image-viewer-content") as HTMLElement;
    expect(content.style.transform).toContain("80.00px");
  });

  it("closes when the backdrop is clicked without dragging", async () => {
    openImageViewer({ kind: "img", src: "https://x/img.png" });
    const root = overlay()!;
    const stage = root.querySelector(".image-viewer-stage") as HTMLElement;

    stage.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100, button: 0 }),
    );
    stage.dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true, clientX: 100, clientY: 100, button: 0 }),
    );
    click(stage);

    expect(isImageViewerOpen()).toBe(false);
    await settleClose();
    expect(overlay()).toBeNull();
  });

  it("keeps the overlay open when the click lands on the picture itself", () => {
    openImageViewer({ kind: "img", src: "https://x/img.png" });
    const root = overlay()!;
    const stage = root.querySelector(".image-viewer-stage") as HTMLElement;
    const content = root.querySelector(".image-viewer-content") as HTMLElement;
    // happy-dom 不做布局：手工给出图片在屏幕上的包围盒
    content.getBoundingClientRect = () => rectOf(400, 250, 600, 400);

    clickPoint(stage, 700, 450);
    expect(isImageViewerOpen()).toBe(true);

    // 图外的暗色背景仍然关闭
    clickPoint(stage, 40, 40);
    expect(isImageViewerOpen()).toBe(false);
  });

  it("starts below the app title bar", () => {
    const titleBar = document.createElement("div");
    titleBar.className = "title-bar";
    titleBar.getBoundingClientRect = () => rectOf(0, 0, 1200, 32);
    document.body.appendChild(titleBar);

    openImageViewer({ kind: "img", src: "https://x/img.png" });
    expect(overlay()!.style.top).toBe("32px");

    // 窗口尺寸变化（如进入全屏）后重新测量
    titleBar.getBoundingClientRect = () => rectOf(0, 0, 1200, 0);
    window.dispatchEvent(new Event("resize"));
    expect(overlay()!.style.top).toBe("0px");
  });

  it("has no top inset when the window has no title bar", () => {
    openImageViewer({ kind: "img", src: "https://x/img.png" });
    expect(overlay()!.style.top).toBe("0px");
  });

  it("covers only the editor pane, leaving sidebar and title bar free", () => {
    const titleBar = document.createElement("div");
    titleBar.className = "title-bar";
    titleBar.getBoundingClientRect = () => rectOf(0, 0, 1440, 32);
    const pane = document.createElement("div");
    pane.className = "editor-area";
    pane.getBoundingClientRect = () => rectOf(240, 0, 1180, 800);
    document.body.append(titleBar, pane);

    openImageViewer({ kind: "img", src: "https://x/img.png" });
    const style = overlay()!.style;
    expect(style.left).toBe("240px");
    expect(style.top).toBe("32px");
    expect(style.width).toBe("1180px");
    expect(style.height).toBe("768px");
    expect(style.right).toBe("auto");
  });
});

describe("image_ref block zoom", () => {
  it("adds a hover trigger that opens the enlarged preview", () => {
    const { view, mount } = mountDoc("![图](https://x/img.png)");
    try {
      const block = mount.querySelector(".image-ref-block") as HTMLElement;
      const trigger = block.querySelector(
        ".media-zoom-trigger",
      ) as HTMLElement | null;
      expect(trigger).toBeTruthy();

      click(trigger!);
      const img = overlay()!.querySelector(
        ".image-viewer-content img",
      ) as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.getAttribute("src")).toContain("img.png");
      // 点放大按钮不应把光标放进块内（不会切到源码编辑态）
      expect(view.state.selection.from).toBe(0);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("opens the viewer when the preview is clicked in locked mode", () => {
    const { view, mount } = mountDoc("![图](https://x/img.png)", false);
    try {
      expect(view.editable).toBe(false);
      const render = mount.querySelector(".image-ref-render") as HTMLElement;
      expect(render.style.display).not.toBe("none");
      click(render);
      expect(isImageViewerOpen()).toBe(true);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("uses the image file name for the download", async () => {
    const calls = recordSaveMedia();
    const { view, mount } = mountDoc("![图](https://x/cat.png)");
    try {
      click(mount.querySelector(".media-zoom-trigger")!);
      click(overlay()!.querySelector(".image-viewer-download")!);
      await new Promise((r) => setTimeout(r, 0));
      expect(calls[0]!.suggestedName).toBe("cat.png");
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});

describe("inline image zoom", () => {
  it("opens the viewer on double click", () => {
    const { view, mount } = mountDoc("前文 ![图](https://x/img.png) 后文");
    try {
      const img = mount.querySelector("img.image-render") as HTMLImageElement;
      expect(img).toBeTruthy();
      img.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
      expect(isImageViewerOpen()).toBe(true);
      expect(overlay()!.querySelector(".image-viewer-content img")).toBeTruthy();
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});

describe("fenced diagram zoom", () => {
  // 用桩渲染器代替 mermaid：异步出图的路径与真实渲染器一致
  const TEST_LANG = "zoomtest";
  setEditorExtensions([
    defineCodeBlockExtension({
      id: "test.zoomtest",
      languages: [TEST_LANG],
      createPreview: () => {
        const dom = document.createElement("div");
        return {
          dom,
          update: () => {
            dom.innerHTML =
              '<div class="zoomtest-media">' +
              '<svg viewBox="0 0 200 100"><rect width="200" height="100"/></svg>' +
              "</div>";
          },
        };
      },
    }),
  ]);

  it("adds a trigger that enlarges the rendered diagram", async () => {
    const { view, mount } = mountDoc(`\`\`\`${TEST_LANG}\ngraph TD\nA-->B\n\`\`\``);
    try {
      const render = mount.querySelector(".cb-render-container") as HTMLElement;
      expect(render).toBeTruthy();
      await new Promise((r) => setTimeout(r, 0));

      const trigger = render.querySelector(".media-zoom-trigger");
      expect(trigger).toBeTruthy();
      click(trigger!);
      const clone = overlay()!.querySelector(
        ".image-viewer-content svg",
      ) as SVGElement;
      expect(clone).toBeTruthy();
      expect(clone.getAttribute("width")).toBe("200");
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("uses the code block language as the download name", async () => {
    const calls = recordSaveMedia();
    const { view, mount } = mountDoc(
      `\`\`\`${TEST_LANG}\ngraph TD\nA-->B\n\`\`\``,
    );
    try {
      const render = mount.querySelector(
        ".cb-render-container",
      ) as HTMLElement;
      await new Promise((r) => setTimeout(r, 0));

      click(render.querySelector(".media-zoom-trigger")!);
      click(overlay()!.querySelector(".image-viewer-download")!);
      await new Promise((r) => setTimeout(r, 0));

      expect(calls[0]!.suggestedName).toBe("zoomtest.svg");
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});

describe("download file names", () => {
  function svgPreview(): { dom: HTMLElement; update: () => void } {
    const dom = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 50");
    dom.appendChild(svg);
    return { dom, update: () => {} };
  }

  it("maps mermaid and math code blocks", async () => {
    const calls = recordSaveMedia();
    setEditorExtensions([
      defineCodeBlockExtension({
        id: "test.download.mermaid",
        languages: ["mermaid"],
        createPreview: () => svgPreview(),
      }),
      defineCodeBlockExtension({
        id: "test.download.math",
        languages: ["math"],
        createPreview: () => svgPreview(),
      }),
    ]);

    const mermaid = mountDoc("```mermaid\ngraph TD\nA-->B\n```");
    try {
      await new Promise((r) => setTimeout(r, 0));
      click(mermaid.mount.querySelector(".media-zoom-trigger")!);
      click(overlay()!.querySelector(".image-viewer-download")!);
      await new Promise((r) => setTimeout(r, 0));
      expect(calls[0]!.suggestedName).toBe("mermaid.svg");
    } finally {
      mermaid.view.destroy();
      mermaid.mount.remove();
    }

    const math = mountDoc("```math\nx^2\n```");
    try {
      await new Promise((r) => setTimeout(r, 0));
      click(math.mount.querySelector(".media-zoom-trigger")!);
      click(overlay()!.querySelector(".image-viewer-download")!);
      await new Promise((r) => setTimeout(r, 0));
      expect(calls[1]!.suggestedName).toBe("formula.svg");
    } finally {
      math.view.destroy();
      math.mount.remove();
    }
  });

  it("uses the embedded file name with .svg", async () => {
    const calls = recordSaveMedia();
    setEditorExtensions([
      defineEmbedExtension({
        id: "test.download.embed",
        extensions: [".excalidraw"],
        insertLabelKey: "x.insert",
        matches: (src) => src.toLowerCase().endsWith(".excalidraw"),
        createPreview: () => svgPreview(),
      }),
    ]);

    const { view, mount } = mountDoc("![board](drawings/flow.excalidraw)");
    try {
      await new Promise((r) => setTimeout(r, 0));
      click(mount.querySelector(".media-zoom-trigger")!);
      click(overlay()!.querySelector(".image-viewer-download")!);
      await new Promise((r) => setTimeout(r, 0));
      expect(calls[0]!.suggestedName).toBe("flow.svg");
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("derives names from encoded and queried sources", () => {
    expect(svgDownloadNameFromSource("drawings/flow.excalidraw?v=1#z")).toBe(
      "flow.svg",
    );
    expect(svgDownloadNameFromSource("my%20board.excalidraw")).toBe(
      "my board.svg",
    );
    expect(svgDownloadNameFromSource("C:\\notes\\board.excalidraw")).toBe(
      "board.svg",
    );
    expect(svgDownloadNameFromSource(undefined)).toBeUndefined();
  });
});

describe("openMediaContainer download options", () => {
  it("forwards a suggested name to the viewer", async () => {
    const calls = recordSaveMedia();
    const container = document.createElement("div");
    container.innerHTML = '<svg viewBox="0 0 10 10"></svg>';
    document.body.appendChild(container);

    openMediaContainer(container, { suggestedName: "custom.svg" });
    click(overlay()!.querySelector(".image-viewer-download")!);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls[0]!.suggestedName).toBe("custom.svg");
  });
});
