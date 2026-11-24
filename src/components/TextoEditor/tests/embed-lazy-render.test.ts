import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { defineEmbedExtension } from "@texto/markdown-editor-api";
import type { PreviewRegion } from "@texto/markdown-editor-api";
import { resetExtensionPointsForTests } from "@texto/plugin-sdk";

import { parse } from "../src/parser.ts";
import { getSchema } from "../src/schema.ts";

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});
import { defaultPlugins } from "../src/editor.ts";
import { setEditorExtensions } from "./helpers/editor-extensions.ts";

function mountDoc(md: string) {
  const doc = parse(md);
  const state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 1),
    plugins: defaultPlugins({ cursorWidget: false, documentPath: "/Users/u/notes/note.md" }),
  });
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const view = new EditorView(mount, { state });
  return { view, mount };
}

const fakeEmbed = defineEmbedExtension({
  id: "fake.embed",
  extensions: [".excalidraw"],
  insertLabelKey: "fake.insert",
  matches: (src) => src.toLowerCase().endsWith(".excalidraw"),
  createPreview(): PreviewRegion {
    const dom = document.createElement("div");
    return {
      dom,
      update(node, ctx) {
        if (node.textContent.includes("broken")) {
          ctx.onError("boom");
          return;
        }
        dom.innerHTML = "";
        const el = document.createElement("div");
        el.className = "fake-embed";
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("data-test", "scene");
        el.appendChild(svg);
        dom.appendChild(el);
      },
    };
  },
});

afterEach(() => {
  resetExtensionPointsForTests();
});

describe("embed render via editor extension", () => {
  it("renders a visible whiteboard embed", async () => {
    setEditorExtensions([fakeEmbed]);
    const { view, mount } = mountDoc("前文\n\n![](drawings/flow.excalidraw)\n\n后文");
    try {
      await new Promise((r) => setTimeout(r, 50));
      expect(mount.querySelector('[data-test="scene"]')).toBeTruthy();
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  it("shows an error placeholder for a broken embed", async () => {
    setEditorExtensions([fakeEmbed]);
    const { view, mount } = mountDoc("前文\n\n![](broken/flow.excalidraw)\n\n后文");
    try {
      await new Promise((r) => setTimeout(r, 50));
      expect(mount.querySelector(".image-ref-error")).toBeTruthy();
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});
