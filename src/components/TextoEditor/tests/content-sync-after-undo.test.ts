import { describe, expect, test, vi, afterEach, beforeAll } from "vitest";
import { createRef, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

import { TextoEditor } from "../TextoEditor";
import type { TextoEditorRef } from "../TextoEditorRef";

// 回归：双模式（IR/SV）下 content 由宿主改写（切文档、外部写入）时，统一历史
// 会话必须整篇重置，当前视图要立刻刷新；重置之后撤销不能再退回旧文档。
//
// 早期实现里 IR 的 PM doc 在失活（SV 模式）期间不随 content 同步，靠
// internalChangeGen / mountContentGuardRef 决定是否整篇替换。双模式改由
// EditorDocumentSession 统一驱动，这两个守卫只在单 IR 模式使用。

beforeAll(() => {
  (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    registerListener: () => Promise.resolve(() => {}),
    unregisterListener: () => Promise.resolve(),
    emit: () => Promise.resolve(),
  };
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  // 本用例只验证内容同步，不关心 pane 转场动画：按 reduced-motion 处理，
  // 模式切换在同一提交内即时生效（否则失活要晚一帧，同一提交里的内容会先同步进 IR）。
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let onChangeCb: ((md: string) => void) | null = null;
let lastProps: { content: string; editorMode: "ir" | "sv" } | null = null;
const editorRef = createRef<TextoEditorRef>();

function render(props: { content: string; editorMode: "ir" | "sv" }) {
  const el = (content: string, editorMode: "ir" | "sv") =>
    createElement(TextoEditor, {
      content,
      editorMode,
      editable: true,
      onChange: (md: string) => onChangeCb?.(md),
      ref: editorRef,
    });
  // 真实应用里「切模式」与「回写内容」是两次独立提交；这里同样先落模式再落内容，
  // 否则同一提交里内容同步会先于模式生效执行。
  if (lastProps && lastProps.editorMode !== props.editorMode) {
    act(() => {
      root!.render(el(lastProps!.content, props.editorMode));
    });
  }
  act(() => {
    root!.render(el(props.content, props.editorMode));
  });
  lastProps = { content: props.content, editorMode: props.editorMode };
}

function setup(initial: { content: string; editorMode: "ir" | "sv" }) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  lastProps = null;
  render(initial);
  return {
    ref: editorRef,
    render,
    emitted: [] as string[],
    set onChange(cb: (md: string) => void) {
      onChangeCb = cb;
    },
  };
}

function teardown() {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  if (host) {
    host.remove();
    host = null;
  }
}

afterEach(() => {
  teardown();
  vi.restoreAllMocks();
});

describe("双模式：外部 content 变化重置统一历史", () => {
  test("IR 内部编辑偏离后，SV 期间外部 content 回落至挂载文本，IR 激活时须整篇替换刷新", async () => {
    const s = setup({ content: "abc", editorMode: "ir" });
    await act(async () => {});

    // IR 内编辑：会话文档从 "abc" 推进到 "abcdef"。
    const view = editorRef.current!.editorView!;
    s.onChange = (md) => s.emitted.push(md);
    act(() => {
      const end = view.state.doc.content.size;
      view.dispatch(view.state.tr.insertText("def", end, end));
    });
    expect(s.emitted.length).toBeGreaterThan(0);
    expect(view.state.doc.textContent).toBe("abcdef");

    // App 把 IR 输出回写为 content（与会话一致，不触发 reset）。
    render({ content: "abcdef", editorMode: "ir" });

    // 切到 SV：IR 仍停在 "abcdef"。
    render({ content: "abcdef", editorMode: "sv" });

    // SV 期间外部 content 回落到 "abc"（如宿主重载/旧路径回写）；IR 失活、doc 未变。
    render({ content: "abc", editorMode: "sv" });
    expect(view.state.doc.textContent).toBe("abcdef");

    // 切回 IR：会话文档已是 "abc"，doc 必须整篇替换，而不是显示陈旧的 "abcdef"。
    render({ content: "abc", editorMode: "ir" });
    await act(async () => {});
    expect(view.state.doc.textContent).toBe("abc");
  });

  test("外部 content 重置后，撤销不回到重置前的文档", async () => {
    const s = setup({ content: "abc", editorMode: "ir" });
    await act(async () => {});
    const view = editorRef.current!.editorView!;

    // IR 内编辑产生一步历史。
    act(() => {
      const end = view.state.doc.content.size;
      view.dispatch(view.state.tr.insertText("def", end, end));
    });
    render({ content: "abcdef", editorMode: "ir" });
    expect(view.state.doc.textContent).toBe("abcdef");

    // 宿主改写 content（切文档 / 外部写入）：会话整篇重置，视图立即刷新。
    render({ content: "xyz", editorMode: "ir" });
    await act(async () => {});
    expect(view.state.doc.textContent).toBe("xyz");

    // 重置清空历史：撤销无可回退，不能退回 "abcdef" 或 "abc"。
    act(() => {
      editorRef.current!.undo();
    });
    expect(view.state.doc.textContent).toBe("xyz");

    void s;
  });
});
