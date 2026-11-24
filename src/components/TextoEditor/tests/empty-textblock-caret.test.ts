import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { defaultPlugins } from "../src/editor.ts";
import { parse } from "../src/parser.ts";
import { getSchema } from "../src/schema.ts";

// WebKit 不为空 textblock（仅含 ProseMirror trailing <br>）绘制插入点。
// 这些用例守住修复的两端：空块 DOM 前提 + CSS 选择器确实命中。
const TEXTBLOCKS = ":is(p, h1, h2, h3, h4, h5, h6, td, th)";
const TRAILING_BREAK_SELECTOR = `${TEXTBLOCKS}:has(> br.ProseMirror-trailingBreak:only-child)`;

const WIDGETS_CSS = "src/components/TextoEditor/styles/widgets.css";

describe("empty textblock caret", () => {
  let schema: ReturnType<typeof getSchema>;
  beforeAll(() => {
    schema = getSchema();
  });

  function mount(md: string) {
    const state = EditorState.create({
      schema,
      doc: parse(md),
      plugins: defaultPlugins({ cursorWidget: false }),
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    const view = new EditorView(el, { state });
    return { view, el };
  }

  it("keeps the zero-width-space CSS rule for empty textblocks", () => {
    const css = readFileSync(WIDGETS_CSS, "utf8");
    expect(css).toContain(`${TEXTBLOCKS}:empty::before`);
    expect(css).toContain(`${TEXTBLOCKS}:has(> br.ProseMirror-trailingBreak:only-child)::before`);
    expect(css).toMatch(/content:\s*"\\200B"/i);
  });

  it("matches an empty paragraph carrying the trailing break", () => {
    const { view, el } = mount("");
    try {
      const p = view.dom.querySelector("p");
      expect(p).not.toBeNull();
      const br = p!.querySelector("br.ProseMirror-trailingBreak");
      expect(br).not.toBeNull();
      expect(br!.parentElement).toBe(p);
      expect(p!.matches(TRAILING_BREAK_SELECTOR)).toBe(true);
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("matches an empty heading carrying the trailing break", () => {
    const { view, el } = mount("# ");
    try {
      const h1 = view.dom.querySelector("h1");
      expect(h1).not.toBeNull();
      const br = h1!.querySelector("br.ProseMirror-trailingBreak");
      expect(br).not.toBeNull();
      expect(br!.parentElement).toBe(h1);
      expect(h1!.matches(TRAILING_BREAK_SELECTOR)).toBe(true);
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("matches an empty table cell carrying the trailing break", () => {
    const { view, el } = mount("| a | b |\n| - | - |\n| | |");
    try {
      const td = view.dom.querySelector("td");
      expect(td).not.toBeNull();
      expect(td!.querySelector("br.ProseMirror-trailingBreak")).not.toBeNull();
      expect(td!.matches(TRAILING_BREAK_SELECTOR)).toBe(true);
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("does not match a textblock with content", () => {
    const { view, el } = mount("hello");
    try {
      const p = view.dom.querySelector("p");
      expect(p).not.toBeNull();
      expect(p!.matches(TRAILING_BREAK_SELECTOR)).toBe(false);
    } finally {
      view.destroy();
      el.remove();
    }
  });
});
