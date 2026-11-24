import { describe, expect, test, vi, afterEach, beforeAll } from "vitest";
import { createRef, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

import { TextoEditor } from "../TextoEditor";
import type { TextoEditorRef } from "../TextoEditorRef";

// 回归：自动大写（autoCapitalize）开关不得影响 spellcheck。
//
// 浏览器拼写检查在大文档下会随每次按键重扫全文（Chromium 76+ 的 GC 抖动、
// macOS 的 AppleSpell），因此 IR 编辑器必须**始终**保持 spellcheck=off。
// 此前 autoCapitalize=true 分支把 spellcheck/autocomplete 与 autocapitalize
// 一起移除，导致开启自动大写的用户被静默打开拼写检查。
//
// 容器 div 上的属性是真正的兜底：ProseMirror 的 view.dom 在 SV→IR 切换时
// 会被 rebuild() 换成全新元素（editor-api.ts），只有靠继承容器属性才能保持
// 关闭。这里断言属性而非 IDL 属性——happy-dom 不实现继承语义，
// 真实的继承效果已在 Chromium 中另行验证。

beforeAll(() => {
  (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    registerListener: () => Promise.resolve(() => {}),
    unregisterListener: () => Promise.resolve(),
    emit: () => Promise.resolve(),
  };
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const editorRef = createRef<TextoEditorRef>();

function render(props: { content: string; autoCapitalize?: boolean }) {
  const el = createElement(TextoEditor, {
    content: props.content,
    editable: true,
    autoCapitalize: props.autoCapitalize,
    onChange: () => {},
    ref: editorRef,
  });
  act(() => {
    root!.render(el);
  });
}

async function setup(autoCapitalize: boolean) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  render({ content: "hello", autoCapitalize });
  await act(async () => {});
  return {
    container: host.querySelector(".prosemirror-editor-container") as HTMLElement,
    editable: editorRef.current!.editorView!.dom as HTMLElement,
  };
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  if (host) {
    host.remove();
    host = null;
  }
  vi.restoreAllMocks();
});

describe("spellcheck 与自动大写开关解耦", () => {
  test("autoCapitalize 关闭时 spellcheck/autocomplete 关闭", async () => {
    const { container, editable } = await setup(false);
    expect(container.getAttribute("spellcheck")).toBe("false");
    expect(editable.getAttribute("spellcheck")).toBe("false");
    expect(container.getAttribute("autocomplete")).toBe("off");
    expect(editable.getAttribute("autocomplete")).toBe("off");
    // 自动大写关闭：autocapitalize 显式关闭；autocorrect 不在可编辑元素上设置（IME）
    expect(editable.getAttribute("autocapitalize")).toBe("off");
    expect(editable.hasAttribute("autocorrect")).toBe(false);
  });

  test("autoCapitalize 开启时 spellcheck 仍必须关闭（容器兜底）", async () => {
    const { container, editable } = await setup(true);
    // 容器是 rebuild() 后新 view.dom 的唯一兜底，必须始终带 spellcheck=false
    expect(container.getAttribute("spellcheck")).toBe("false");
    expect(container.getAttribute("autocomplete")).toBe("off");
    expect(editable.getAttribute("spellcheck")).toBe("false");
    // 开启自动大写：autocapitalize 必须被移除（否则功能失效）
    expect(container.hasAttribute("autocapitalize")).toBe(false);
    expect(editable.hasAttribute("autocapitalize")).toBe(false);
    // autocorrect 依旧不设置，避免干扰 Windows IME
    expect(editable.hasAttribute("autocorrect")).toBe(false);
  });
});
