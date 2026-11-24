import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { Editor } from "../src/editor-api.ts";
import {
  isSourcePreserveEnabled,
  setSourcePreserveEnabled,
} from "../src/source-preserve-config.ts";

(window as any).__TAURI_INTERNALS__ = {
  transformCallback: () => 0,
  invoke: async () => undefined,
  convertFileSrc: () => "",
};
(window as any).__TAURI__ = {};

const STORAGE_KEY = "texto:source-preserve";

let createEditor: (host: HTMLElement, options?: any) => Editor;
beforeAll(async () => {
  // happy-dom 无真实 origin，localStorage 访问会抛错；提供内存实现以模拟 App。
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
  const api = await import("../src/editor-api.ts");
  createEditor = api.createEditor;
});

afterEach(() => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
});

function replaceInView(editor: Editor, word: string, repl: string): void {
  const doc = editor.view.state.doc;
  let from = -1;
  let to = -1;
  doc.descendants((node, pos) => {
    if (from >= 0) return false;
    if (!node.isTextblock) return true;
    const idx = node.textContent.indexOf(word);
    if (idx >= 0) {
      from = pos + 1 + idx;
      to = from + word.length;
      return false;
    }
    return true;
  });
  if (from < 0) throw new Error(`word not found: ${word}`);
  const tr = editor.view.state.tr.insertText(repl, from, to);
  editor.view.dispatch(tr);
}

function withEditor(
  md: string,
  fn: (editor: Editor) => void,
): void {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = createEditor(host, { initialContent: md });
  try {
    fn(editor);
  } finally {
    editor.destroy();
    host.remove();
  }
}

// 打开/编辑「标题 + 引用块」的典型回归：开启保真后只应改动被编辑的行。
const seed = "# Alerts\n\n\n> [!TYPE]\n>\n> content line\n\nbody\n";

describe("source-preserve settings toggle", () => {
  test("默认关闭（localStorage 未设置）", () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
    expect(isSourcePreserveEnabled()).toBe(false);
  });

  test("setSourcePreserveEnabled 写入后可被 isSourcePreserveEnabled 读到", () => {
    setSourcePreserveEnabled(true);
    expect(isSourcePreserveEnabled()).toBe(true);
    setSourcePreserveEnabled(false);
    expect(isSourcePreserveEnabled()).toBe(false);
  });

  test("显式关闭能压过 env 默认开启；未显式选择时才回退 env", () => {
    vi.stubEnv("VITE_SOURCE_PRESERVE", "true");
    try {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      expect(isSourcePreserveEnabled()).toBe(true);
      setSourcePreserveEnabled(false);
      expect(isSourcePreserveEnabled()).toBe(false);
      setSourcePreserveEnabled(true);
      expect(isSourcePreserveEnabled()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("开关开启：改标题只改标题行，空行与 [!TYPE] 保持原样", () => {
    setSourcePreserveEnabled(true);
    withEditor(seed, (editor) => {
      replaceInView(editor, "Alerts", "Alerts1");
      expect(editor.getMarkdown()).toBe(
        "# Alerts1\n\n\n> [!TYPE]\n>\n> content line\n\nbody\n",
      );
    });
  });

  test("开关关闭（默认）：同一次编辑走 canonical，全篇被重排", () => {
    withEditor(seed, (editor) => {
      replaceInView(editor, "Alerts", "Alerts1");
      const out = editor.getMarkdown();
      // 空行 2→1 折叠；`[!TYPE]` 原样保留 —— 文本块已是源文写法（含转义），
      // canonical 不再二次转义（见 docs/superpowers/specs 的 escape 设计）。
      expect(out).toBe("# Alerts1\n\n> [!TYPE]\n>\n> content line\n\nbody");
    });
  });
});
