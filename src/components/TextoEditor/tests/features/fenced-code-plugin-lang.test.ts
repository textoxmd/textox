import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EditorState, Plugin, PluginKey } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { defineCodeBlockExtension } from "@texto/markdown-editor-api";
import { resetExtensionPointsForTests } from "@texto/plugin-sdk";

import { parse } from "../../src/parser.ts";
import { getSchema } from "../../src/schema.ts";

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});
import { defaultPlugins } from "../../src/editor.ts";
import { setEditorExtensions } from "../helpers/editor-extensions.ts";

afterEach(() => {
  resetExtensionPointsForTests();
});

describe("code block language dropdown includes plugin languages", () => {
  it("lists a plugin-contributed language", () => {
    setEditorExtensions([
      defineCodeBlockExtension({
        id: "test.plantuml",
        languages: ["plantuml"],
        createPreview: () => ({ dom: document.createElement("div"), update: () => {} }),
      }),
    ]);

    const doc = parse("```\ncode\n```");
    const el = document.createElement("div");
    document.body.appendChild(el);
    const view = new EditorView(el, {
      state: EditorState.create({
        schema,
        doc,
        plugins: defaultPlugins({ cursorWidget: false }),
      }),
    });

    try {
      const input = el.querySelector(".cb-lang-input") as HTMLInputElement;
      input.dispatchEvent(new FocusEvent("focus"));
      const labels = Array.from(el.querySelectorAll(".cb-lang-item")).map(
        (item) => (item as HTMLElement).textContent,
      );
      expect(labels).toContain("plantuml");
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("keeps the built-in list first and does not duplicate a built-in language", () => {
    setEditorExtensions([
      defineCodeBlockExtension({
        id: "test.mermaid",
        languages: ["mermaid"],
        createPreview: () => ({ dom: document.createElement("div"), update: () => {} }),
      }),
    ]);

    const doc = parse("```\ncode\n```");
    const el = document.createElement("div");
    document.body.appendChild(el);
    const view = new EditorView(el, {
      state: EditorState.create({
        schema,
        doc,
        plugins: defaultPlugins({ cursorWidget: false }),
      }),
    });

    try {
      const input = el.querySelector(".cb-lang-input") as HTMLInputElement;
      input.dispatchEvent(new FocusEvent("focus"));
      const labels = Array.from(el.querySelectorAll(".cb-lang-item")).map(
        (item) => (item as HTMLElement).textContent,
      );
      expect(labels.filter((label) => label === "mermaid")).toHaveLength(1);
      expect(labels[0]).toBe("text");
    } finally {
      view.destroy();
      el.remove();
    }
  });
});

const lockKey = new PluginKey<boolean>("plugin-render-locked");

function withEditable(editable: boolean): Plugin<boolean> {
  return new Plugin<boolean>({
    key: lockKey,
    state: {
      init: () => editable,
      apply: (tr, prev) => {
        const meta = tr.getMeta(lockKey);
        return meta !== undefined ? meta : prev;
      },
    },
    props: {
      editable: (state) => lockKey.getState(state) ?? true,
    },
  });
}

function mountLocked(md: string) {
  const doc = parse(md);
  const state = EditorState.create({
    schema,
    doc,
    plugins: [withEditable(false), ...defaultPlugins({ cursorWidget: false })],
  });
  const el = document.createElement("div");
  document.body.appendChild(el);
  const view = new EditorView(el, { state });
  return { view, el };
}

describe("plugin code block renderer (end-to-end)", () => {
  it("renders plugin output into the code block render container", async () => {
    setEditorExtensions([
      defineCodeBlockExtension({
        id: "test.fake-lang",
        languages: ["fake-lang"],
        createPreview: () => {
          const dom = document.createElement("div");
          return {
            dom,
            update: () => {
              dom.innerHTML = "<div id='plugin-out'>ok</div>";
            },
          };
        },
      }),
    ]);

    const { view, el } = mountLocked("```fake-lang\nsome code\n```");
    try {
      await vi.waitFor(() => {
        const container = el.querySelector(".cb-render-container");
        expect(container?.innerHTML).toContain("plugin-out");
      });
    } finally {
      view.destroy();
      el.remove();
    }
  });

  it("plugin renderer output wins over a built-in language", async () => {
    setEditorExtensions([
      defineCodeBlockExtension({
        id: "test.mermaid",
        languages: ["mermaid"],
        createPreview: () => {
          const dom = document.createElement("div");
          return {
            dom,
            update: () => {
              dom.innerHTML = "<div id='plugin-mermaid'>plugin wins</div>";
            },
          };
        },
      }),
    ]);

    const { view, el } = mountLocked("```mermaid\ngraph TD\nA-->B\n```");
    try {
      await vi.waitFor(() => {
        const container = el.querySelector(".cb-render-container");
        expect(container?.innerHTML).toContain("plugin-mermaid");
      });
    } finally {
      view.destroy();
      el.remove();
    }
  });
});
