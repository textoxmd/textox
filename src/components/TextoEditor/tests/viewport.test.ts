import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Fragment, type Node as PMNode } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import {
  countTextblocks,
  computeViewportFromScroll,
  FULL_DOC_THRESHOLD,
  getViewport,
} from "../src/viewport.ts";
import { createState } from "../src/editor.ts";
import { getSchema } from "../src/schema.ts";
import { parse } from "../src/parser.ts";

const mounted: HTMLElement[] = [];

beforeEach(() => {
  // 显式固定窗口可视区，避免隐式依赖 happy-dom 默认尺寸。
  vi.stubGlobal("innerWidth", 1024);
  vi.stubGlobal("innerHeight", 768);
});

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.remove();
  vi.unstubAllGlobals();
});

function markdown(n: number): string {
  return Array.from({ length: n }, (_, i) => `**bold${i}**`).join("\n\n");
}

function blockStart(doc: PMNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i += 1) pos += doc.child(i).nodeSize;
  return pos;
}

function rect(
  top: number,
  left: number,
  right: number,
  bottom: number,
): DOMRect {
  return {
    top,
    left,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function fakeView(
  dom: HTMLElement,
  posAtCoords: (coords: { left: number; top: number }) => { pos: number } | null,
): EditorView {
  return { dom, posAtCoords } as unknown as EditorView;
}

/**
 * 挂载「容器 > 编辑器根」结构，并固定两者的 rect；afterEach 统一清理。
 * `scrollable: false` 时容器不设置 overflowY，让 getScrollParent 回退到父节点。
 */
function fixture(
  containerRect: DOMRect,
  editorRect: DOMRect,
  { scrollable = true }: { scrollable?: boolean } = {},
): HTMLElement {
  const outer = document.createElement("div");
  if (scrollable) outer.style.overflowY = "auto";
  const inner = document.createElement("div");
  outer.appendChild(inner);
  document.body.appendChild(outer);
  mounted.push(outer);

  outer.getBoundingClientRect = () => containerRect;
  inner.getBoundingClientRect = () => editorRect;
  return inner;
}

const CONTAINER_RECT = rect(0, 0, 800, 600);
// 编辑器整篇高度 12000，顶部滚出视口 3000px
const SCROLLED_EDITOR_RECT = rect(-3000, 0, 800, 9000);
// 页面自滚动且没有内层滚动祖先：容器与编辑器被迫同为负坐标。
const SELF_SCROLLED_RECT = rect(-3000, 0, 800, 9000);

function throwingPosAtCoords(): never {
  throw new Error("posAtCoords should not be called");
}

describe("computeViewportFromScroll", () => {
  it("用滚动容器与编辑器 rect 的交集采样", () => {
    const doc = parse(markdown(1500));
    const state = createState(doc);

    const inner = fixture(CONTAINER_RECT, SCROLLED_EDITOR_RECT);

    const calls: Array<{ left: number; top: number }> = [];
    const view = fakeView(inner, (coords) => {
      calls.push(coords);
      const index = coords.top < 300 ? 100 : 140;
      return { pos: blockStart(doc, index) + 1 };
    });

    const viewport = computeViewportFromScroll(view, state);

    expect(viewport).not.toBeNull();
    expect(viewport!.blockStart).toBe(0);
    expect(viewport!.blockEnd).toBe(240);
    expect(calls).toEqual([
      { left: 400, top: 20 },
      { left: 400, top: 580 },
    ]);
  });

  it("posAtCoords 失败时返回 null", () => {
    const doc = parse(markdown(1500));
    const state = createState(doc);

    const inner = fixture(CONTAINER_RECT, SCROLLED_EDITOR_RECT);
    const view = fakeView(inner, () => null);
    expect(computeViewportFromScroll(view, state)).toBeNull();
  });

  it("滚动容器高度为 0 时提前返回 null", () => {
    const doc = parse(markdown(1500));
    const state = createState(doc);

    const inner = fixture(rect(0, 0, 800, 0), SCROLLED_EDITOR_RECT);
    const posAt = vi.fn(() => ({ pos: 1 }));
    const view = fakeView(inner, posAt);

    expect(computeViewportFromScroll(view, state)).toBeNull();
    expect(posAt).not.toHaveBeenCalled();
  });

  it("容器与编辑器纵向完全不相交时提前返回 null", () => {
    const doc = parse(markdown(1500));
    const state = createState(doc);

    const inner = fixture(CONTAINER_RECT, rect(700, 0, 800, 9000));
    const posAt = vi.fn(() => ({ pos: 1 }));
    const view = fakeView(inner, posAt);

    expect(computeViewportFromScroll(view, state)).toBeNull();
    expect(posAt).not.toHaveBeenCalled();
  });

  it("横向无交集时提前返回 null", () => {
    const doc = parse(markdown(1500));
    const state = createState(doc);

    const inner = fixture(CONTAINER_RECT, rect(-3000, 900, 1700, 9000));
    const posAt = vi.fn(() => ({ pos: 1 }));
    const view = fakeView(inner, posAt);

    expect(computeViewportFromScroll(view, state)).toBeNull();
    expect(posAt).not.toHaveBeenCalled();
  });

  it("横向交集完全在窗口右侧时提前返回 null", () => {
    const doc = parse(markdown(1500));
    const state = createState(doc);

    const inner = fixture(rect(0, 1200, 2000, 600), rect(-3000, 1300, 3000, 9000));
    const posAt = vi.fn(() => ({ pos: 1 }));
    const view = fakeView(inner, posAt);

    expect(computeViewportFromScroll(view, state)).toBeNull();
    expect(posAt).not.toHaveBeenCalled();
  });

  it("块数不超过阈值时提前返回 null", () => {
    const doc = parse(markdown(FULL_DOC_THRESHOLD));
    const state = createState(doc);

    const inner = fixture(CONTAINER_RECT, SCROLLED_EDITOR_RECT);
    const posAt = vi.fn(() => ({ pos: 1 }));
    const view = fakeView(inner, posAt);

    expect(computeViewportFromScroll(view, state)).toBeNull();
    expect(posAt).not.toHaveBeenCalled();
  });

  it("posAtCoords 抛错时返回 null", () => {
    const doc = parse(markdown(1500));
    const state = createState(doc);

    const inner = fixture(CONTAINER_RECT, SCROLLED_EDITOR_RECT);
    const view = fakeView(inner, throwingPosAtCoords);
    expect(computeViewportFromScroll(view, state)).toBeNull();
  });

  it("窗口贴近文档末尾时上界被 clamp 到总块数", () => {
    const total = 1500;
    const doc = parse(markdown(total));
    const state = createState(doc);

    const inner = fixture(CONTAINER_RECT, SCROLLED_EDITOR_RECT);
    const view = fakeView(inner, (coords) => {
      const index = coords.top < 300 ? 1490 : 1495;
      return { pos: blockStart(doc, index) + 1 };
    });

    const viewport = computeViewportFromScroll(view, state);

    expect(viewport).not.toBeNull();
    expect(viewport!.blockStart).toBe(1390);
    expect(viewport!.blockEnd).toBe(total);
  });

  it("无滚动祖先且页面自滚动为负坐标时用窗口可视区裁剪", () => {
    const doc = parse(markdown(1500));
    const state = createState(doc);

    const inner = fixture(SELF_SCROLLED_RECT, SELF_SCROLLED_RECT, {
      scrollable: false,
    });

    const calls: Array<{ left: number; top: number }> = [];
    const view = fakeView(inner, (coords) => {
      calls.push(coords);
      const index = coords.top < 400 ? 100 : 140;
      return { pos: blockStart(doc, index) + 1 };
    });

    const viewport = computeViewportFromScroll(view, state);

    expect(viewport).not.toBeNull();
    expect(calls).toEqual([
      { left: 400, top: 20 },
      { left: 400, top: 748 },
    ]);
  });
});

describe("countTextblocks", () => {
  it("空文档返回 0", () => {
    const empty = getSchema().topNodeType.create(null, Fragment.empty);
    expect(countTextblocks(empty)).toBe(0);
  });

  it("同一文档连续调用两次返回相同值（缓存分支）", () => {
    const doc = parse(markdown(12));
    const spy = vi.spyOn(doc, "descendants");

    expect(countTextblocks(doc)).toBe(12);
    expect(countTextblocks(doc)).toBe(12);
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });
});


type TestEditor = {
  view: EditorView;
  setMarkdown(md: string): void;
  destroy(): void;
};

let createEditor: (
  host: HTMLElement,
  options?: Record<string, unknown>,
) => TestEditor;

beforeAll(async () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async () => undefined,
    convertFileSrc: () => "",
  };
  (window as unknown as Record<string, unknown>).__TAURI__ = {};
  createEditor = (await import("../src/editor-api.ts")).createEditor as typeof createEditor;
});

function nextFrame(): Promise<null> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

/**
 * 挂载真实编辑器，并固定「800×600 滚动容器 + 顶部滚出 3000px 的编辑器」几何。
 * `posAtCoords` 桩按真实 `host.scrollTop` 返回第 base / base+40 块：
 * 未滚动 → 100/140（窗口 0..240），滚过 400px → 500/540（窗口 400..640）。
 */
function scrollHarness(
  options: { contentBlocks?: number; onChange?: () => void } = {},
) {
  const host = document.createElement("div");
  host.style.overflowY = "auto";
  document.body.appendChild(host);

  const editor = createEditor(host, {
    initialContent: markdown(options.contentBlocks ?? 1500),
    ...(options.onChange ? { onChange: options.onChange } : {}),
  });
  const view = editor.view;

  host.getBoundingClientRect = () => rect(0, 0, 800, 600);
  view.dom.getBoundingClientRect = () => rect(-3000, 0, 800, 9000);
  view.posAtCoords = ((coords: { left: number; top: number }) => {
    const base = host.scrollTop >= 400 ? 500 : 100;
    const index = coords.top < 300 ? base : base + 40;
    return { pos: blockStart(view.state.doc, index) + 1 } as never;
  }) as typeof view.posAtCoords;

  return {
    editor,
    host,
    view,
    scrollTo(top: number) {
      host.scrollTop = top;
      host.dispatchEvent(new Event("scroll"));
    },
    dispose() {
      editor.destroy();
      host.remove();
    },
  };
}

describe("viewportPlugin 刷新生命周期", () => {
  it("滚动到新位置后派发刷新事务并移动窗口", async () => {
    const h = scrollHarness();
    try {
      // 冲掉挂载时的初始 refresh(true)：此时窗口按顶端采样。
      await nextFrame();
      const initial = getViewport(h.view.state);
      expect(initial.fullDoc).toBe(false);
      expect(initial.blockStart).toBe(0);
      expect(initial.blockEnd).toBe(240);

      h.scrollTo(500);
      await nextFrame();

      const scrolled = getViewport(h.view.state);
      expect(scrolled.fullDoc).toBe(false);
      expect(scrolled.blockStart).toBe(400);
      expect(scrolled.blockEnd).toBe(640);
    } finally {
      h.dispose();
    }
  });

  it("同一帧内的文档替换会把挂起的滚动刷新升级为强制刷新", async () => {
    const host = document.createElement("div");
    host.style.overflowY = "auto";
    document.body.appendChild(host);

    const editor = createEditor(host, { initialContent: markdown(1500) });
    try {
      const view = editor.view;
      host.getBoundingClientRect = () => rect(0, 0, 800, 600);
      view.dom.getBoundingClientRect = () => rect(-3000, 0, 800, 9000);
      let base = 100;
      view.posAtCoords = ((coords: { left: number; top: number }) => {
        const index = coords.top < 300 ? base : base + 40;
        return { pos: blockStart(view.state.doc, index) + 1 } as never;
      }) as typeof view.posAtCoords;

      await nextFrame();
      expect(getViewport(view.state).blockEnd).toBe(240);

      // 同一帧内：滚动位移小于阈值（非强制刷新会自行跳过），紧接着整篇替换
      // 触发 refresh(true)。挂起的回调必须升级为强制刷新，否则窗口留在
      // 替换前的 0..240（docChanged 已按「光标仍在窗口内」保留旧窗口）。
      host.scrollTop = 10;
      base = 500;
      host.dispatchEvent(new Event("scroll"));
      editor.setMarkdown(markdown(1500));
      await nextFrame();

      const viewport = getViewport(view.state);
      expect(viewport.fullDoc).toBe(false);
      expect(viewport.blockStart).toBe(400);
      expect(viewport.blockEnd).toBe(640);
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("在窗口内打字保留窗口，且只派发一次（不追加元事务）", async () => {
    const h = scrollHarness();
    try {
      await nextFrame();
      h.scrollTo(500);
      await nextFrame();
      expect(getViewport(h.view.state)).toMatchObject({
        blockStart: 400,
        blockEnd: 640,
      });

      const doc = h.view.state.doc;
      const pos = blockStart(doc, 500) + 1;
      h.view.dispatch(
        h.view.state.tr.setSelection(TextSelection.near(doc.resolve(pos))),
      );

      const dispatch = vi.spyOn(h.view, "dispatch");
      h.view.dispatch(h.view.state.tr.insertText("x", pos));
      // 立刻检查：本次事务内窗口不得先退回光标窗口（400..600）。
      expect(getViewport(h.view.state)).toMatchObject({
        fullDoc: false,
        blockStart: 400,
        blockEnd: 640,
      });
      await nextFrame();

      expect(getViewport(h.view.state)).toMatchObject({
        fullDoc: false,
        blockStart: 400,
        blockEnd: 640,
      });
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally {
      h.dispose();
    }
  });

  it("滚动刷新派发的元事务不改文档、不触发 onChange", async () => {
    const onChange = vi.fn();
    const h = scrollHarness({ onChange });
    try {
      await nextFrame();
      const docBefore = h.view.state.doc;
      const dispatch = vi.spyOn(h.view, "dispatch");

      h.scrollTo(500);
      await nextFrame();

      expect(getViewport(h.view.state)).toMatchObject({
        blockStart: 400,
        blockEnd: 640,
      });
      expect(h.view.state.doc).toBe(docBefore);
      expect(onChange).not.toHaveBeenCalled();
      expect(dispatch).toHaveBeenCalledTimes(1);
      const refreshTr = dispatch.mock.calls[0]![0];
      expect(refreshTr.docChanged).toBe(false);
      expect(refreshTr.steps.length).toBe(0);
    } finally {
      h.dispose();
    }
  });

  it("滚动位移小于阈值时不派发刷新事务", async () => {
    const h = scrollHarness();
    try {
      await nextFrame();
      h.scrollTo(500);
      await nextFrame();
      const before = getViewport(h.view.state);

      const dispatch = vi.spyOn(h.view, "dispatch");
      h.scrollTo(510);
      await nextFrame();

      expect(getViewport(h.view.state)).toBe(before);
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      h.dispose();
    }
  });

  it("多编辑器隔离：销毁 A 后 B 的滚动刷新仍生效", async () => {
    const a = scrollHarness();
    let aAlive = true;
    const b = scrollHarness();
    try {
      await nextFrame();
      expect(getViewport(a.view.state).blockEnd).toBe(240);
      expect(getViewport(b.view.state).blockEnd).toBe(240);

      a.scrollTo(500);
      await nextFrame();
      expect(getViewport(a.view.state)).toMatchObject({
        blockStart: 400,
        blockEnd: 640,
      });
      // A 的滚动不应影响 B 的窗口。
      expect(getViewport(b.view.state)).toMatchObject({
        blockStart: 0,
        blockEnd: 240,
      });

      a.dispose();
      aAlive = false;

      b.scrollTo(500);
      await nextFrame();
      expect(getViewport(b.view.state)).toMatchObject({
        blockStart: 400,
        blockEnd: 640,
      });

      // B 的非 docChanged 事务也必须用 B 自己的滚动几何：若退回模块级共享
      // view（A 已销毁 ⇒ 共享引用为 null），这里会算成光标窗口 1100..1340。
      const bDoc = b.view.state.doc;
      b.view.dispatch(
        b.view.state.tr.setSelection(
          TextSelection.near(bDoc.resolve(blockStart(bDoc, 1200) + 1)),
        ),
      );
      await nextFrame();
      expect(getViewport(b.view.state)).toMatchObject({
        blockStart: 400,
        blockEnd: 640,
      });

      // B 再次滚动仍可继续移动窗口（监听器未被远端销毁牵连）。
      b.host.getBoundingClientRect = () => rect(0, 0, 800, 600);
      b.view.posAtCoords = ((coords: { left: number; top: number }) => {
        const index = coords.top < 300 ? 1200 : 1240;
        return { pos: blockStart(b.view.state.doc, index) + 1 } as never;
      }) as typeof b.view.posAtCoords;
      b.scrollTo(900);
      await nextFrame();
      expect(getViewport(b.view.state)).toMatchObject({
        blockStart: 1100,
        blockEnd: 1340,
      });
    } finally {
      if (aAlive) a.dispose();
      b.dispose();
    }
  });
});
