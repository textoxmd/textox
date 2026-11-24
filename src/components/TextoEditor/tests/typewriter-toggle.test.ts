import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import type { Editor } from "../src/editor-api.ts";
import { typewriterPluginKey } from "../src/features/typewriter/index.ts";

(window as any).__TAURI_INTERNALS__ = {
  transformCallback: () => 0,
  invoke: async () => undefined,
  convertFileSrc: () => "",
};
(window as any).__TAURI__ = {};

const TYPEWRITER_STORAGE_KEY = "texto:typewriter-mode";

// happy-dom 无真实 origin，localStorage 访问会抛错；提供内存实现以模拟 App。
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
  setItem: (key: string, value: string) => void storage.set(key, String(value)),
  removeItem: (key: string) => void storage.delete(key),
  clear: () => storage.clear(),
});
afterAll(() => vi.unstubAllGlobals());

let createEditor: (host: HTMLElement, options?: any) => Editor;
beforeAll(async () => {
  const api = await import("../src/editor-api.ts");
  createEditor = api.createEditor;
});

function makeHost(): HTMLElement {
  const host = document.createElement("div");
  host.style.height = "600px";
  document.body.appendChild(host);
  return host;
}

/** 留白收起动画（220ms）跑完后再断言最终 DOM 状态 */
async function waitPadAnimation(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 400));
}

describe("typewriter 模式开关", () => {
  test("不再从 localStorage 读取初值（单一数据源为宿主配置）", () => {
    localStorage.setItem(TYPEWRITER_STORAGE_KEY, "true");
    const host = makeHost();
    const editor = createEditor(host, { initialContent: "正文内容" });
    const pm = host.querySelector(".ProseMirror") as HTMLElement;

    expect(typewriterPluginKey.getState(editor.view.state)?.enabled).toBe(false);
    expect(pm.classList.contains("tw-pad")).toBe(false);

    editor.destroy();
    host.remove();
  });

  test("开启时加上虚拟留白，取消时平滑收起后再移除", async () => {
    const host = makeHost();
    const editor = createEditor(host, { initialContent: "正文内容" });
    const pm = host.querySelector(".ProseMirror") as HTMLElement;
    expect(pm.classList.contains("tw-pad")).toBe(false);

    editor.view.dispatch(
      editor.view.state.tr.setMeta(typewriterPluginKey, { enabled: true }),
    );
    expect(typewriterPluginKey.getState(editor.view.state)?.enabled).toBe(true);
    expect(pm.classList.contains("tw-pad")).toBe(true);

    editor.view.dispatch(
      editor.view.state.tr.setMeta(typewriterPluginKey, { enabled: false }),
    );
    expect(typewriterPluginKey.getState(editor.view.state)?.enabled).toBe(false);
    // 取消也是动画：留白先渐变收起，而不是瞬间移除
    expect(pm.classList.contains("tw-pad")).toBe(true);

    await waitPadAnimation();
    expect(pm.classList.contains("tw-pad")).toBe(false);

    editor.destroy();
    host.remove();
  });

  test("留白完全收起后 DOM 不再残留内联尺寸变量", async () => {
    const host = makeHost();
    const editor = createEditor(host, { initialContent: "正文内容" });
    const pm = host.querySelector(".ProseMirror") as HTMLElement;

    editor.view.dispatch(
      editor.view.state.tr.setMeta(typewriterPluginKey, { enabled: true }),
    );
    expect(pm.classList.contains("tw-pad")).toBe(true);

    editor.view.dispatch(
      editor.view.state.tr.setMeta(typewriterPluginKey, { enabled: false }),
    );
    await waitPadAnimation();

    expect(pm.classList.contains("tw-pad")).toBe(false);
    expect(pm.style.getPropertyValue("--tw-pad-top")).toBe("");
    expect(pm.style.getPropertyValue("--tw-pad-bottom")).toBe("");

    editor.destroy();
    host.remove();
  });

  test("开启模式会清掉“用户手动滚动”暂停标记", () => {
    const host = makeHost();
    const editor = createEditor(host, { initialContent: "正文内容" });
    expect(typewriterPluginKey.getState(editor.view.state)?.userScrolled).toBe(false);

    editor.view.dispatch(
      editor.view.state.tr.setMeta(typewriterPluginKey, { userScrolled: true }),
    );
    expect(typewriterPluginKey.getState(editor.view.state)?.userScrolled).toBe(true);

    editor.view.dispatch(
      editor.view.state.tr.setMeta(typewriterPluginKey, { enabled: false }),
    );
    editor.view.dispatch(
      editor.view.state.tr.setMeta(typewriterPluginKey, { enabled: true }),
    );
    const state = typewriterPluginKey.getState(editor.view.state);
    expect(state?.enabled).toBe(true);
    expect(state?.userScrolled).toBe(false);

    editor.destroy();
    host.remove();
  });
});
