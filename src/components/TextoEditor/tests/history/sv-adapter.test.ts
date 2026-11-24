import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { EditorView } from "@codemirror/view";

import { SourceCodeEditor } from "../../src/source-view";
import type { SourceViewApi } from "../../src/source-view";
import { createSvAdapter } from "../../src/history/adapters/sv";
import type { CursorRange } from "../../src/history/types";
import { modeSwitchAnchorY } from "../../src/scroll-anchor";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT =
  true;

interface MountProps {
  content: string;
  onChange?: (
    content: string,
    selection: CursorRange,
    selectionBefore?: CursorRange | (() => CursorRange),
  ) => void;
  onUndo?: () => boolean;
  onRedo?: () => boolean;
  syncContent?: boolean;
  active?: boolean;
  onViewReady?: (api: SourceViewApi | null) => void;
}

async function mount(props: MountProps) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let api: SourceViewApi | null = null;
  const render = async (next: MountProps) => {
    await act(async () => {
      root.render(
        createElement(SourceCodeEditor, {
          onChange: () => {},
          ...next,
          onViewReady: (nextApi: SourceViewApi | null) => {
            api = nextApi;
            next.onViewReady?.(nextApi);
          },
        }),
      );
    });
  };
  await render(props);
  return {
    host,
    get api() {
      return api as SourceViewApi;
    },
    render,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

// CodeMirror 按 navigator.platform 把 Mod- 归一化成 Meta-（mac）或 Ctrl-。
const IS_MAC = /Mac/.test(navigator.platform);

function getView(host: HTMLElement): EditorView {
  const editor = host.querySelector(".cm-editor");
  expect(editor).not.toBeNull();
  const view = EditorView.findFromDOM(editor as HTMLElement);
  expect(view).not.toBeNull();
  return view as EditorView;
}

function press(
  host: HTMLElement,
  init: KeyboardEventInit & { keyCode?: number },
) {
  const content = host.querySelector(".cm-content");
  expect(content).not.toBeNull();
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...(IS_MAC ? { metaKey: true } : { ctrlKey: true }),
    ...init,
  } as KeyboardEventInit);
  content!.dispatchEvent(event);
  return event;
}

const MOD_Z = { key: "z", code: "KeyZ", keyCode: 90 } as const;

describe("SV 历史 API", () => {
  it("applyMarkdown 更新文本并恢复光标，且不触发 onChange", async () => {
    const onChange = vi.fn();
    const ref = { current: null as null | { applyMarkdown: (md: string, sel: unknown) => void; getMarkdown: () => string } };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(SourceCodeEditor, {
          content: "abc",
          onChange,
          onViewReady: (api: unknown) => { ref.current = api as typeof ref.current; },
        }),
      );
    });
    act(() => {
      ref.current!.applyMarkdown("abcd", { anchor: { line: 1, col: 4 }, head: { line: 1, col: 4 } });
    });
    expect(ref.current!.getMarkdown()).toBe("abcd");
    expect(onChange).not.toHaveBeenCalled();
    act(() => root.unmount());
    host.remove();
  });

  it("applyMarkdown 的 center 对齐把行放到模式切换视觉锚点（模式切换）", async () => {
    const mounted = await mount({ content: "a\nb\nc" });
    const view = getView(mounted.host);
    const spy = vi.spyOn(EditorView, "scrollIntoView");
    try {
      act(() =>
        mounted.api.applyMarkdown(
          "a\nb\nc",
          { anchor: { line: 3, col: 0 }, head: { line: 3, col: 0 } },
          "center",
        ),
      );
      // 锚点是窗口坐标下的视觉锚点，不是滚动容器中线（标题栏会让容器中线偏下）。
      // yMargin = 锚点 y − 行高/2 − 滚动容器顶；第 3 行第 0 列 offset = 4。
      const scrollerTop = view.scrollDOM.getBoundingClientRect().top;
      const yMargin =
        modeSwitchAnchorY() - view.lineBlockAt(4).height / 2 - scrollerTop;
      expect(spy).toHaveBeenCalledWith(4, { y: "start", yMargin });
    } finally {
      spy.mockRestore();
      mounted.unmount();
    }
  });

  it("applyMarkdown 默认对齐不请求居中滚动", async () => {
    const mounted = await mount({ content: "a\nb\nc" });
    const spy = vi.spyOn(EditorView, "scrollIntoView");
    try {
      act(() =>
        mounted.api.applyMarkdown(
          "a\nb\nc",
          { anchor: { line: 3, col: 0 }, head: { line: 3, col: 0 } },
        ),
      );
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      mounted.unmount();
    }
  });

  it("普通输入经 updateListener 上报内容与行/列选区", async () => {
    const onChange = vi.fn();
    const mounted = await mount({ content: "abc", onChange });
    const view = getView(mounted.host);
    act(() => {
      view.dispatch({
        changes: { from: 3, insert: "d" },
        selection: { anchor: 4 },
        userEvent: "input.type",
      });
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const call = onChange.mock.calls[0]!;
    expect(call[0]).toBe("abcd");
    expect(call[1]).toEqual({
      anchor: { line: 1, col: 4 },
      head: { line: 1, col: 4 },
    });
    // 第三个参数是事务开始前的选区（撤销目标光标），惰性求值：初始光标在文档开头
    const before = call[2] as CursorRange | (() => CursorRange) | undefined;
    expect(typeof before).toBe("function");
    expect((before as () => CursorRange)()).toEqual({
      anchor: { line: 1, col: 0 },
      head: { line: 1, col: 0 },
    });
    mounted.unmount();
  });

  it("applyMarkdown 期间抑制 updateListener 的 onChange（逐次断言）", async () => {
    const onChange = vi.fn();
    const mounted = await mount({ content: "abc", onChange });
    act(() => mounted.api.applyMarkdown("abcd", null));
    expect(onChange).not.toHaveBeenCalled();
    act(() =>
      mounted.api.applyMarkdown("abcde", {
        anchor: { line: 1, col: 5 },
        head: { line: 1, col: 5 },
      }),
    );
    expect(onChange).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("getSelection 按行/列读取当前光标", async () => {
    const mounted = await mount({ content: "abc\ndef" });
    expect(mounted.api.getSelection()).toEqual({
      anchor: { line: 1, col: 0 },
      head: { line: 1, col: 0 },
    });

    act(() =>
      mounted.api.applyMarkdown("abc\ndef", {
        anchor: { line: 2, col: 2 },
        head: { line: 2, col: 2 },
      }),
    );
    expect(mounted.api.getSelection()).toEqual({
      anchor: { line: 2, col: 2 },
      head: { line: 2, col: 2 },
    });
    mounted.unmount();
  });

  it("applyMarkdown 保留区间选区的 anchor/head 方向", async () => {
    // 失活挂载：happy-dom 的 selectionchange 是同步派发的（真实浏览器为异步任务），
    // 编辑器获得焦点时 CM 在 dispatch 中写 DOM 选区会触发重入。这里只验证选区映射。
    const mounted = await mount({ content: "abc", active: false });
    act(() =>
      mounted.api.applyMarkdown("abc\ndef", {
        anchor: { line: 2, col: 3 },
        head: { line: 2, col: 1 },
      }),
    );
    expect(mounted.api.getSelection()).toEqual({
      anchor: { line: 2, col: 3 },
      head: { line: 2, col: 1 },
    });
    mounted.unmount();
  });

  it("selection 为 null 时保留当前光标", async () => {
    const mounted = await mount({ content: "abc\ndef" });
    act(() =>
      mounted.api.applyMarkdown("abc\ndef", {
        anchor: { line: 2, col: 3 },
        head: { line: 2, col: 3 },
      }),
    );
    act(() => mounted.api.applyMarkdown("abc\nXYZdef", null));
    expect(mounted.api.getMarkdown()).toBe("abc\nXYZdef");
    expect(mounted.api.getSelection()).toEqual({
      anchor: { line: 2, col: 3 },
      head: { line: 2, col: 3 },
    });
    mounted.unmount();
  });

  it("越界选区被夹到文档长度内", async () => {
    const mounted = await mount({ content: "abc" });
    act(() =>
      mounted.api.applyMarkdown("ab", {
        anchor: { line: 1, col: 99 },
        head: { line: 1, col: 99 },
      }),
    );
    expect(mounted.api.getMarkdown()).toBe("ab");
    expect(mounted.api.getSelection()).toEqual({
      anchor: { line: 1, col: 2 },
      head: { line: 1, col: 2 },
    });
    mounted.unmount();
  });

  it("CRLF markdown 归一化为 LF，选区按 LF 长度夹取", async () => {
    const mounted = await mount({ content: "a\nb" });
    act(() =>
      mounted.api.applyMarkdown("a\r\nbX", {
        anchor: { line: 2, col: 2 },
        head: { line: 2, col: 2 },
      }),
    );
    expect(mounted.api.getMarkdown()).toBe("a\nbX");
    expect(mounted.api.getSelection()).toEqual({
      anchor: { line: 2, col: 2 },
      head: { line: 2, col: 2 },
    });
    mounted.unmount();
  });

  it("CRLF content 挂载不产生多余重写", async () => {
    const onChange = vi.fn();
    const mounted = await mount({ content: "a\r\nb", onChange });
    expect(mounted.api.getMarkdown()).toBe("a\nb");
    // 归一化后文本相等 ⇒ 不 dispatch，onChange 也不应被惊动。
    expect(onChange).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("CRLF content 在 SV 下也能提取大纲", async () => {
    const onOutlineChange = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(SourceCodeEditor, {
          content: "# a\r\n\r\nbody\r\n\r\n## b\r\n",
          onChange: () => {},
          onOutlineChange,
        }),
      );
    });
    const last = onOutlineChange.mock.calls[onOutlineChange.mock.calls.length - 1];
    const outline = last?.[0] ?? [];
    expect(outline.map((item: { text: string }) => item.text)).toEqual(["a", "b"]);
    act(() => root.unmount());
    host.remove();
  });

  it("onUndo / onRedo 接管 Mod-z / Mod-Shift-z / Mod-y", async () => {
    const undo = vi.fn(() => true);
    const redo = vi.fn(() => true);
    const mounted = await mount({ content: "abc", onUndo: undo, onRedo: redo });
    act(() => mounted.api.focus());

    expect(press(mounted.host, { key: "z", code: "KeyZ", keyCode: 90 }).defaultPrevented).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).not.toHaveBeenCalled();

    // 真实按键在 Shift 下 key 为大写；CM 靠 keyCode 回推基础键名匹配 Mod-Shift-z。
    expect(
      press(mounted.host, { key: "Z", code: "KeyZ", keyCode: 90, shiftKey: true })
        .defaultPrevented,
    ).toBe(true);
    expect(redo).toHaveBeenCalledTimes(1);

    expect(press(mounted.host, { key: "y", code: "KeyY", keyCode: 89 }).defaultPrevented).toBe(true);
    expect(redo).toHaveBeenCalledTimes(2);

    mounted.unmount();
  });

  it("未提供 onUndo / onRedo 时快捷键被消费且文档不变（不回退 CM 原生撤销）", async () => {
    const mounted = await mount({ content: "abc" });
    const view = getView(mounted.host);
    act(() => {
      view.dispatch({
        changes: { from: 3, insert: "d" },
        userEvent: "input.type",
      });
    });
    expect(view.state.doc.toString()).toBe("abcd");

    act(() => mounted.api.focus());
    const undoEvent = press(mounted.host, MOD_Z);
    expect(undoEvent.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("abcd");

    // 真实按键在 Shift 下 key 为大写；CM 靠 keyCode 回推基础键名匹配 Mod-Shift-z。
    const redoEvent = press(mounted.host, {
      key: "Z",
      code: "KeyZ",
      keyCode: 90,
      shiftKey: true,
    });
    expect(redoEvent.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("abcd");
    mounted.unmount();
  });

  it("onUndo 返回 false 时不回退 CM（避免撤销被记成新编辑）", async () => {
    const undo = vi.fn(() => false);
    const mounted = await mount({ content: "abc", onUndo: undo });
    const view = getView(mounted.host);
    act(() => {
      view.dispatch({
        changes: { from: 3, insert: "d" },
        userEvent: "input.type",
      });
    });
    expect(view.state.doc.toString()).toBe("abcd");

    const event = press(mounted.host, MOD_Z);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("abcd");
    mounted.unmount();
  });

  it("卸载时 onViewReady(null) 注销 API", async () => {
    const seen: Array<SourceViewApi | null> = [];
    const mounted = await mount({
      content: "abc",
      onViewReady: (api) => seen.push(api),
    });
    expect(seen[0]).toBe(mounted.api);
    expect(seen[0]).not.toBeNull();
    mounted.unmount();
    expect(seen[seen.length - 1]).toBeNull();
  });

  it("syncContent=false 时不跟随 content prop", async () => {
    const onChange = vi.fn();
    const mounted = await mount({ content: "abc", onChange, syncContent: false });
    await mounted.render({ content: "xyz", onChange, syncContent: false });
    expect(mounted.api.getMarkdown()).toBe("abc");
    expect(onChange).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("默认同步 content prop 且抑制 onChange", async () => {
    const onChange = vi.fn();
    const mounted = await mount({ content: "abc", onChange });
    await mounted.render({ content: "xyz", onChange });
    expect(mounted.api.getMarkdown()).toBe("xyz");
    expect(onChange).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("SV 适配器转发四个方法", async () => {
    const mounted = await mount({ content: "abc" });
    const adapter = createSvAdapter(mounted.api);
    act(() =>
      adapter.applyMarkdown("abc\ndef", {
        anchor: { line: 2, col: 2 },
        head: { line: 2, col: 2 },
      }),
    );
    expect(adapter.getMarkdown()).toBe("abc\ndef");
    expect(adapter.getSelection()).toEqual({
      anchor: { line: 2, col: 2 },
      head: { line: 2, col: 2 },
    });
    expect(() => act(() => adapter.focus())).not.toThrow();
    mounted.unmount();
  });
});
