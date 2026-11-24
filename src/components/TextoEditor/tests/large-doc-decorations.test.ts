import { beforeAll, describe, expect, it, vi } from "vitest";
import { TextSelection } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";

import { getDelims } from "../src/normalize.ts";
import { createState } from "../src/editor.ts";
import { parse } from "../src/parser.ts";
import { getViewport } from "../src/viewport.ts";

let createEditor: (
  host: HTMLElement,
  options?: Record<string, unknown>,
) => { view: import("prosemirror-view").EditorView; setMarkdown(md: string): void; destroy(): void };

beforeAll(async () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async () => undefined,
    convertFileSrc: () => "",
  };
  (window as unknown as Record<string, unknown>).__TAURI__ = {};
  createEditor = (await import("../src/editor-api.ts")).createEditor as typeof createEditor;
});

function markdown(n: number): string {
  return Array.from({ length: n }, (_, i) => `**bold${i}**`).join("\n\n");
}

function blockStart(doc: PMNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i += 1) pos += doc.child(i).nodeSize;
  return pos;
}

function hasDelimForBlock(
  doc: PMNode,
  delims: ReturnType<typeof getDelims>,
  index: number,
): boolean {
  const start = blockStart(doc, index);
  const end = start + doc.child(index).nodeSize;
  return delims.some((d) => d.spanFrom >= start && d.spanTo <= end);
}

function moveCaretToBlock(state: ReturnType<typeof createState>, index: number) {
  const pos = blockStart(state.doc, index) + 2;
  return state.apply(
    state.tr.setSelection(TextSelection.near(state.doc.resolve(pos))),
  );
}

function mixedMarkdown(n: number): string {
  const parts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    parts.push(`**bold${i}**`);
    if (i % 2 === 0) parts.push("```\ncode\n```");
  }
  return parts.join("\n\n");
}

function blockPosByType(doc: PMNode, typeName: string, index: number): number {
  let seen = 0;
  let result = -1;
  doc.descendants((node, pos) => {
    if (result >= 0) return false;
    if (node.type.name !== typeName) return true;
    if (seen === index) {
      result = pos;
      return false;
    }
    seen += 1;
    return true;
  });
  return result;
}

function typeBlockHasDelim(
  doc: PMNode,
  delims: ReturnType<typeof getDelims>,
  typeName: string,
  index: number,
): boolean {
  const pos = blockPosByType(doc, typeName, index);
  if (pos < 0) return false;
  const node = doc.nodeAt(pos);
  if (!node) return false;
  const start = pos + 1;
  const end = start + node.content.size;
  return delims.some((d) => d.spanFrom >= start && d.spanTo <= end);
}

function moveCaretToTypedBlock(
  state: ReturnType<typeof createState>,
  typeName: string,
  index: number,
) {
  const pos = blockPosByType(state.doc, typeName, index);
  if (pos < 0) throw new Error(`block not found: ${typeName} ${index}`);
  return state.apply(
    state.tr.setSelection(TextSelection.near(state.doc.resolve(pos + 2))),
  );
}

describe("大文档视口内联装饰", () => {
  it("光标移动后 delims 重新投影到新窗口", () => {
    const state = createState(parse(markdown(1500)));
    expect(hasDelimForBlock(state.doc, getDelims(state), 1499)).toBe(false);

    const next = moveCaretToBlock(state, 1400);
    const delims = getDelims(next);

    expect(hasDelimForBlock(next.doc, delims, 1499)).toBe(true);
    expect(hasDelimForBlock(next.doc, delims, 100)).toBe(false);
  });

  it("整篇替换扩大文档后，光标移动仍覆盖末端块", () => {
    const state = createState(parse(markdown(500)));
    const appended = state.apply(
      state.tr.replaceWith(
        0,
        state.doc.content.size,
        parse(markdown(1500)).content,
      ),
    );

    const next = moveCaretToBlock(appended, 1450);
    expect(hasDelimForBlock(next.doc, getDelims(next), 1499)).toBe(true);
  });

  it("代码块穿插的大文档中，窗口内段落仍按逻辑块对齐", () => {
    const state = createState(parse(mixedMarkdown(1500)));
    const next = moveCaretToTypedBlock(state, "paragraph", 1400);
    const delims = getDelims(next);

    expect(typeBlockHasDelim(next.doc, delims, "paragraph", 1400)).toBe(true);
    expect(typeBlockHasDelim(next.doc, delims, "paragraph", 100)).toBe(false);
  });

  it("代码块穿插的大文档中，文档变更后的窗口投影仍按逻辑块对齐", () => {
    const state = createState(parse(mixedMarkdown(1500)));
    const next = moveCaretToTypedBlock(state, "paragraph", 1400);
    const edited = next.apply(
      next.tr.insert(
        next.doc.content.size,
        next.schema.nodes.paragraph!.create(),
      ),
    );

    expect(getViewport(edited)).toEqual(getViewport(next));
    expect(
      typeBlockHasDelim(edited.doc, getDelims(edited), "paragraph", 1400),
    ).toBe(true);
  });

  it("光标移到大文档中段后，窗口内末端段落不裸露 **", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: markdown(1500) });
    const view = editor.view;

    try {
      const pos = blockStart(view.state.doc, 1400) + 2;
      view.dispatch(
        view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))),
      );

      const last = view.dom.querySelectorAll("p").item(1499)!;
      expect(last.querySelectorAll(".syntax-hidden").length).toBe(2);
      expect(last.textContent).toBe("**bold1499**");
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("整篇替换扩大文档后，窗口内末端段落不裸露 **", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: markdown(500) });

    try {
      editor.setMarkdown(markdown(1500));
      const view = editor.view;
      const pos = blockStart(view.state.doc, 1450) + 2;
      view.dispatch(
        view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))),
      );

      const last = view.dom.querySelectorAll("p").item(1499)!;
      expect(last.querySelectorAll(".syntax-hidden").length).toBe(2);
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("滚动触发视口窗口移动后，窗口内段落装饰随之重建", async () => {
    vi.stubGlobal("innerWidth", 1024);
    vi.stubGlobal("innerHeight", 768);
    const host = document.createElement("div");
    host.style.overflowY = "auto";
    document.body.appendChild(host);
    const editor = createEditor(host, { initialContent: markdown(1500) });
    const view = editor.view;

    const rect = (
      top: number,
      left: number,
      right: number,
      bottom: number,
    ): DOMRect =>
      ({
        top,
        left,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
        x: left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    const nextFrame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    try {
      host.getBoundingClientRect = () => rect(0, 0, 800, 600);
      view.dom.getBoundingClientRect = () => rect(-3000, 0, 800, 9000);
      let base = 100;
      view.posAtCoords = ((coords: { left: number; top: number }) => {
        const index = coords.top < 300 ? base : base + 40;
        return { pos: blockStart(view.state.doc, index) + 1 } as never;
      }) as typeof view.posAtCoords;

      // 冲掉挂载时的初始 refresh(true)：窗口停在文档头部 0..240。
      await nextFrame();
      expect(getViewport(view.state)).toMatchObject({
        blockStart: 0,
        blockEnd: 240,
      });

      // 滚动到中段：只派发视口刷新元事务，选区与文档都不变。
      base = 500;
      host.scrollTop = 500;
      host.dispatchEvent(new Event("scroll"));
      await nextFrame();
      expect(getViewport(view.state)).toMatchObject({
        blockStart: 400,
        blockEnd: 640,
      });

      const paragraph = view.dom.querySelectorAll("p").item(620)!;
      expect(paragraph.querySelectorAll(".syntax-hidden").length).toBe(2);
    } finally {
      editor.destroy();
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
