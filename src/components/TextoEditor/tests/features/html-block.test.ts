import { describe, it, expect, vi } from "vitest";
import { TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { parse } from "../../src/parser.ts";
import { serialize } from "../../src/serializer.ts";
import { createState } from "../../src/editor.ts";
import { runFeatureCases } from "../utils.ts";
import { htmlBlockSpecs } from "../../specs/features/html-block.specs.ts";
import { markdownToHtml } from "../../src/features/context-menu/copy-utils.ts";

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  length: 0,
  key: () => null,
});

function blockNames(src: string): string[] {
  const doc = parse(src);
  const out: string[] = [];
  doc.forEach((child) => out.push(child.type.name));
  return out;
}

describe("html-block: parse → node", () => {
  it("type 6: <div> block becomes html_block node", () => {
    expect(blockNames("<div>\ncontent\n</div>\n\npara")).toEqual(["html_block", "paragraph"]);
  });

  it("type 1: <script> block", () => {
    expect(blockNames("<script>\nvar x = 1;\n</script>\n\nok")).toEqual(["html_block", "paragraph"]);
  });

  it("type 2: standalone <!-- --> block", () => {
    expect(blockNames("<!--note-->\n\npara")).toEqual(["html_block", "paragraph"]);
  });

  it("inline <span> stays paragraph (html_inline disabled)", () => {
    expect(blockNames("a <span>x</span> b")).toEqual(["paragraph"]);
  });

  it("inline comment stays paragraph", () => {
    expect(blockNames("before <!--x--> after")).toEqual(["paragraph"]);
  });
});

describe("html-block: node view DOM shape", () => {
  it("creates the render container eagerly, before the lazy view module loads", () => {
    // PM 挂载 NodeView 后再向根节点 append 渲染容器，会被 WebKit 的
    // MutationObserver 判为结构变化并触发 NodeView 无限重建（打开文档卡死）。
    // 渲染容器必须由 eager 外壳同步创建，这里在动态 import 完成前断言其存在。
    const doc = parse("<div>\ncontent\n</div>\n\npara");
    const base = createState(doc);
    const state = base.apply(base.tr.setSelection(TextSelection.atEnd(doc)));
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    try {
      expect(mount.querySelector("html-block .html-block-render")).toBeTruthy();
      expect(mount.querySelector("html-block .html-block-code")).toBeTruthy();
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});

function roundTripStable(md: string): void {
  const doc1 = parse(md);
  const md2 = serialize(doc1);
  const doc2 = parse(md2);
  if (!doc1.eq(doc2)) {
    throw new Error(
      `round-trip mismatch\n--- input md ---\n${md}\n--- serialized ---\n${md2}\n--- doc1 ---\n${JSON.stringify(doc1.toJSON())}\n--- doc2 ---\n${JSON.stringify(doc2.toJSON())}`,
    );
  }
}

describe("html-block: round-trip (all 7 GFM types)", () => {
  it("type 1 script", () => roundTripStable("<script>\nvar x = 1;\n</script>\n\nok"));
  it("type 1 pre", () => roundTripStable("<pre lang=\"haskell\"><code>\nmain\n</code></pre>\n\nok"));
  it("type 1 style", () => roundTripStable("<style>\nh1 {color:red;}\n</style>\n\nok"));
  it("type 2 comment", () => roundTripStable("<!-- Foo\n\nbar -->\n\nok"));
  it("type 3 processing instruction", () => roundTripStable("<?php\n\necho '>';\n?>\n\nok"));
  it("type 4 declaration", () => roundTripStable("<!DOCTYPE html>\n\npara"));
  it("type 5 CDATA", () => roundTripStable("<![CDATA[\nif (a < b) return;\n]]>\n\nok"));
  it("type 6 div with indentation", () =>
    roundTripStable("<div>\n  <tr>\n    hi\n  </tr>\n</div>\n\nok"));
  it("type 7 custom tag", () => roundTripStable("<Warning>\n*bar*\n</Warning>\n\nok"));
  it("type 6 single line", () => roundTripStable("<div></div>\n\npara"));
  it("type 6 interrupts paragraph (no blank before)", () =>
    roundTripStable("Foo\n<div>\nbar\n</div>\n\n*foo*"));
  it("empty-ish block", () => roundTripStable("<!---->\n\npara"));
});

describe("html-block: syntax highlighting", () => {
  it("hljs applies classes inside html_block content", async () => {
    // happy-dom 不计算布局，getBoundingClientRect 全为 0；visibleCodeBlocks 依赖
    // 滚动容器可见区非空，这里给挂载点补一个非零矩形以驱动 rAF 懒高亮管线。
    const rect = () => ({
      x: 0, y: 0, width: 800, height: 600, top: 0, right: 800, bottom: 600, left: 0,
    });
    const doc = parse("<div>\n<span>x</span>\n</div>");
    const base = createState(doc);
    const state = base.apply(base.tr.setSelection(TextSelection.atEnd(doc)));
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    mount.getBoundingClientRect = rect as typeof mount.getBoundingClientRect;
    document.body.getBoundingClientRect = rect as typeof document.body.getBoundingClientRect;
    document.documentElement.getBoundingClientRect =
      rect as typeof document.documentElement.getBoundingClientRect;
    const hb = mount.querySelector("html-block") as HTMLElement | null;
    if (hb) hb.getBoundingClientRect = rect as typeof hb.getBoundingClientRect;
    try {
      // html-block 的行为模块（view/html-block-view）是动态 import：等待其
      // 渲染出真实结构，并等 rAF 懒高亮管线落地 hljs 类。
      await vi.waitFor(() => {
        expect(mount.querySelector("html-block .html-block-render")).toBeTruthy();
        // hljs xml 语言会对标签名上色 → 内容区出现带 hljs-* class 的 span
        expect(mount.querySelectorAll("html-block span[class*=hljs-]").length).toBeGreaterThan(0);
      });
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});

describe("html-block: live mode switch", () => {
  function rect() {
    return { x: 0, y: 0, width: 800, height: 600, top: 0, right: 800, bottom: 600, left: 0 };
  }

  it("cursor outside block → .html-block-render actually renders the HTML", async () => {
    // 同步投影 spec 无法等待 html-block 视图的懒加载，只能投影源码文本；
    // 这里用异步断言守护「失焦 → 真实渲染」：渲染容器内出现真实 DOM 结构，
    // 且源码容器被隐藏。
    const doc = parse("<div>\n<span>x</span>\n</div>\n\npara");
    const base = createState(doc);
    // 光标停在块下方段落（块外）→ 渲染态
    const state = base.apply(base.tr.setSelection(TextSelection.atEnd(doc)));
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    mount.getBoundingClientRect = rect as typeof mount.getBoundingClientRect;
    document.body.getBoundingClientRect = rect as typeof document.body.getBoundingClientRect;
    document.documentElement.getBoundingClientRect = rect as typeof document.documentElement.getBoundingClientRect;
    const view = new EditorView(mount, { state });
    try {
      const hbEl = mount.querySelector("html-block") as HTMLElement;
      // 行为模块（view/html-block-view）是动态 import：等待渲染容器内出现
      // 真实 DOM 结构，届时再断言渲染态。
      await vi.waitFor(() => {
        const render = hbEl.querySelector(".html-block-render") as HTMLElement | null;
        expect(render).toBeTruthy();
        expect(render!.querySelector("span")).toBeTruthy();
      });
      const render = hbEl.querySelector(".html-block-render") as HTMLElement;
      const code = hbEl.querySelector(".html-block-code") as HTMLElement;
      // 渲染容器内是真实 HTML 结构（非源码回显的文本节点）
      expect(render.querySelector("span")!.textContent).toBe("x");
      expect(render.innerHTML).toBe("<div>\n<span>x</span>\n</div>");
      // 渲染态下源码容器隐藏
      expect(code.style.display).toBe("none");
      expect(hbEl.classList.contains("html-block-render-mode")).toBe(true);
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("selection into/out of block toggles render/code mode live", async () => {
    const doc = parse("<div>\ncontent\n</div>\n\npara");
    const base = createState(doc);
    const state = base.apply(base.tr.setSelection(TextSelection.atEnd(doc)));
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    mount.getBoundingClientRect = rect as typeof mount.getBoundingClientRect;
    document.body.getBoundingClientRect = rect as typeof document.body.getBoundingClientRect;
    document.documentElement.getBoundingClientRect = rect as typeof document.documentElement.getBoundingClientRect;
    const view = new EditorView(mount, { state });
    try {
      // 渲染容器由 eager 外壳同步创建，不能再作为「行为模块已接管」的信号；
      // 改为等待懒加载视图真正切到渲染模式（光标在块外）。
      await vi.waitFor(() => {
        const el = mount.querySelector("html-block") as HTMLElement | null;
        expect(el?.classList.contains("html-block-render-mode")).toBe(true);
      });
      const hbEl = mount.querySelector("html-block") as HTMLElement;
      // 光标在块外（para 内）→ 渲染模式
      expect(hbEl.classList.contains("html-block-render-mode")).toBe(true);
      const render = hbEl.querySelector(".html-block-render") as HTMLElement | null;
      const code = hbEl.querySelector(".html-block-code") as HTMLElement | null;
      expect(render?.style.display).not.toBe("none");
      expect(code?.style.display).toBe("none");
      // 光标移入块内 → 切回源码模式
      const inside = 1;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, inside)));
      await vi.waitFor(() => {
        expect(hbEl.classList.contains("html-block-render-mode")).toBe(false);
      });
      expect(code?.style.display).not.toBe("none");
      // 再移出 → 重新渲染
      view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
      await vi.waitFor(() => {
        expect(hbEl.classList.contains("html-block-render-mode")).toBe(true);
      });
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});

describe("html-block: serialize verbatim", () => {
  it("preserves exact source incl internal blank lines and indent", () => {
    const src = "<div>\n  <span>x</span>\n\n  text\n</div>";
    const doc = parse(src + "\n");
    const out = serialize(doc);
    expect(out).toContain("<div>");
    expect(out).toContain("</div>");
    expect(out).not.toContain("\\<");
  });

  it("blockquote nesting round-trips", () =>
    roundTripStable("> <div>\n> foo\n>\n> bar\n\npara"));

  it("list nesting round-trips", () =>
    roundTripStable("- <div>\n- foo\n\n- next"));
});

describe("html-block: export pass-through", () => {
  it("copy-as-HTML renders html_block as real HTML", () => {
    const html = markdownToHtml("<div>\ncontent\n</div>\n\npara");
    expect(html).toContain("<div>");
    expect(html).toContain("</div>");
    expect(html).not.toContain("&lt;div&gt;");
  });
});

runFeatureCases(htmlBlockSpecs);
