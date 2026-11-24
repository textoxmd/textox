import { describe, expect, test, beforeAll } from "vitest";
import { EditorView } from "prosemirror-view";
import { EditorState, TextSelection } from "prosemirror-state";

import { parse } from "../src/parser.ts";
import { getSchema } from "../src/schema.ts";

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});
import { defaultPlugins } from "../src/editor.ts";
import { serialize } from "../src/serializer.ts";

beforeAll(() => {
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: () => Promise.resolve({}),
  };
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function emptyHeadingView() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const doc = parse("# 你好");
  let view: EditorView;
  const st = EditorState.create({
    schema,
    doc,
    plugins: defaultPlugins({ cursorWidget: false }),
  });
  view = new EditorView(host, {
    state: st,
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr));
    },
  });
  const heading = doc.child(0);
  view.dispatch(
    view.state.tr
      .setSelection(
        TextSelection.create(view.state.doc, 1, 1 + heading.content.size),
      )
      .deleteSelection(),
  );
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
  return { view, host, h1: host.querySelector("h1") as HTMLElement };
}

function emptyCodeBlockView() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const doc = parse("```js\n```");
  let view: EditorView;
  const st = EditorState.create({
    schema,
    doc,
    plugins: defaultPlugins({ cursorWidget: false }),
  });
  view = new EditorView(host, {
    state: st,
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr));
    },
  });
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
  const code = host.querySelector("pre > code") as HTMLElement;
  return { view, host, code };
}

describe("composition zero-width anchor (empty-block IME)", () => {
  test("injects a ZWSP into an empty heading at compositionstart", async () => {
    const { view, h1 } = emptyHeadingView();
    try {
      expect(view.state.doc.textContent).toBe("");
      h1.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      await sleep(20);
      expect(view.state.doc.textContent).toBe("\u200b");
      // The block now holds real inline text, so PM renders no <br> placeholder.
      expect(h1.querySelector("br")).toBeNull();
    } finally {
      view.destroy();
    }
  });

  test("removes the ZWSP after compositionend, leaving committed text", async () => {
    const { view, h1 } = emptyHeadingView();
    try {
      h1.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      await sleep(20);
      const br = h1.querySelector("br");
      if (br) br.remove();
      const tn = Array.from(h1.childNodes).find((n) => n.nodeType === 3) as Text;
      if (tn) tn.data = "\u200b你";
      else h1.appendChild(document.createTextNode("\u200b你"));
      await sleep(30);
      h1.dispatchEvent(new Event("compositionend", { bubbles: true }));
      await sleep(60); // wait for the setTimeout(0) cleanup
      expect(view.state.doc.textContent).toBe("你");
      expect(view.state.doc.textContent.includes("\u200b")).toBe(false);
      expect(serialize(view.state.doc)).toBe("# 你");
    } finally {
      view.destroy();
    }
  });

  test("empty heading with no typing collapses back to empty", async () => {
    const { view, h1 } = emptyHeadingView();
    try {
      h1.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      await sleep(20);
      h1.dispatchEvent(new Event("compositionend", { bubbles: true }));
      await sleep(60);
      expect(view.state.doc.textContent).toBe("");
    } finally {
      view.destroy();
    }
  });

  test("injects a ZWSP into an empty code block at compositionstart", async () => {
    const { view, code } = emptyCodeBlockView();
    try {
      expect(view.state.doc.textContent).toBe("");
      // Same precondition as the empty heading: only a trailing <br>.
      expect(code.querySelector("br.ProseMirror-trailingBreak")).not.toBeNull();
      code.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      await sleep(20);
      expect(view.state.doc.textContent).toBe("\u200b");
      expect(code.querySelector("br.ProseMirror-trailingBreak")).toBeNull();
    } finally {
      view.destroy();
    }
  });

  test("removes the ZWSP from an empty code block after commit", async () => {
    const { view, code } = emptyCodeBlockView();
    try {
      code.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      await sleep(20);
      const tn = Array.from(code.childNodes).find((n) => n.nodeType === 3) as Text | undefined;
      if (tn) tn.data = "\u200b你";
      else code.appendChild(document.createTextNode("\u200b你"));
      await sleep(30);
      code.dispatchEvent(new Event("compositionend", { bubbles: true }));
      await sleep(60);
      expect(view.state.doc.textContent).toBe("你");
      expect(serialize(view.state.doc)).toBe("```js\n你\n```");
    } finally {
      view.destroy();
    }
  });

  test("composition in the lang input does not inject an anchor into the code body", async () => {
    const { view, host } = emptyCodeBlockView();
    try {
      const input = host.querySelector(".cb-lang-input") as HTMLInputElement;
      input.focus();
      input.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      await sleep(20);
      expect(view.state.doc.textContent).toBe("");
      input.dispatchEvent(new Event("compositionend", { bubbles: true }));
      await sleep(60);
      expect(view.state.doc.textContent).toBe("");
    } finally {
      view.destroy();
    }
  });
});
