import { beforeAll, describe, expect, test } from "vitest";
import type { Editor } from "../src/editor-api.ts";

(window as any).__TAURI_INTERNALS__ = {
  transformCallback: () => 0,
  invoke: async () => undefined,
  convertFileSrc: () => "",
};
(window as any).__TAURI__ = {};

let createEditor: (host: HTMLElement, options?: any) => Editor;
let getImageLoadStatus: () => ReadonlyMap<string, string>;
beforeAll(async () => {
  const api = await import("../src/editor-api.ts");
  createEditor = api.createEditor;
  const image = await import("../src/features/image.ts");
  getImageLoadStatus = (image as any).__getImageLoadStatus;
});

// 懒加载回归：打开文档时正文优先渲染，图片接近视口才发起加载/探测。

describe("图片懒加载", () => {
  test("image_ref 块预览的 img 带 loading=lazy / decoding=async", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    // 前文段落让初始光标落在块外 → 图片块处于预览态
    const editor = createEditor(host, {
      initialContent: "前文\n\n![alt](https://example.com/img.png)",
    });

    const img = host.querySelector(".image-ref-img") as HTMLImageElement | null;
    expect(img).toBeTruthy();
    expect(img!.loading).toBe("lazy");
    expect(img!.decoding).toBe("async");

    editor.destroy();
    host.remove();
  });

  test("打开文档时不再全量预探测（探针保持空闲）", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: "![a](https://a.com/1.png) ![b](https://b.com/2.png)" });

    // 回归保护：不再对全文档图片一次性 probe（imageLoadStatus 应保持为空，
    // 直到图片接近视口触发 IntersectionObserver）
    expect(getImageLoadStatus().size).toBe(0);

    editor.destroy();
    host.remove();
  });
});
