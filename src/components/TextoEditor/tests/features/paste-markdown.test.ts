import { beforeAll, describe, expect, test } from "vitest";
import { TextSelection } from "prosemirror-state";

import { createState } from "../../src/editor.ts";
import { parse } from "../../src/parser.ts";
import { getSchema } from "../../src/schema.ts";

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});
import { feedPaste } from "../../specs/events.ts";
import { fakeView } from "../../specs/sim.ts";
import { pretty } from "../utils.ts";

function setup(md = "") {
  const doc = md ? parse(md) : schema.nodes.doc.createAndFill()!;
  const state = createState(doc);
  const view = fakeView(state);
  return view;
}

describe("paste-markdown", () => {
  test("renders an ATX heading from pasted markdown", () => {
    const view = setup("");
    feedPaste(view, { text: "# Heading" });
    expect(pretty(view.state)).toBe("<h1><h-label>H1</h-label>Heading|</h1>");
  });

  test("renders a bullet list from pasted markdown", () => {
    const view = setup("");
    feedPaste(view, { text: "- item 1\n- item 2" });
    expect(pretty(view.state)).toBe("<ul><li>item 1</li><li>item 2|</li></ul>");
  });

  test("renders inline emphasis from pasted markdown", () => {
    const view = setup("");
    feedPaste(view, { text: "**bold**" });
    expect(pretty(view.state)).toBe("<g>**</g><b>bold</b><g>**</g>|");
  });

  test("renders a fenced code block from pasted markdown", () => {
    const view = setup("");
    feedPaste(view, { text: "```ts\nconst a = 1;\n```" });
    expect(pretty(view.state)).toBe("```ts\nconst a = 1;|\n```");
  });

  test("renders pasted markdown into the middle of existing content", () => {
    const view = setup("hello world");
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 7, 12)),
    );
    feedPaste(view, { text: "**bold**" });
    expect(pretty(view.state)).toBe("hello <g>**</g><b>bold</b><g>**</g>|");
  });

  test("leaves plain prose text to the default paste handler", () => {
    const view = setup("hello");
    const handled = feedPaste(view, { text: "just some plain words" });
    expect(handled).toBe(false);
    expect(view.state.doc.textContent).toBe("hello");
  });

  test("does not intercept rich text paste with html", () => {
    const view = setup("hello");
    const handled = feedPaste(view, { text: "# Heading", html: "<h1>Heading</h1>" });
    expect(handled).toBe(false);
    expect(view.state.doc.textContent).toBe("hello");
  });

  test("image paste is handled by the image path, not as markdown", () => {
    const view = setup("hello");
    const handled = feedPaste(view, {
      text: "# Heading",
      items: [{ kind: "file", type: "image/png", getAsFile: () => null } as unknown as DataTransferItem],
    });
    expect(handled).toBe(true);
    expect(view.state.doc.textContent).toBe("hello");
  });

  test("does not intercept empty clipboard", () => {
    const view = setup("hello");
    const handled = feedPaste(view, { text: "" });
    expect(handled).toBe(false);
    expect(view.state.doc.textContent).toBe("hello");
  });

  test("leaves prose with dollar amounts verbatim (no math corruption)", () => {
    const view = setup("hello");
    const handled = feedPaste(view, { text: "The price is $5 and $10 total." });
    expect(handled).toBe(false);
    expect(view.state.doc.textContent).toBe("hello");
  });

  test("leaves python dunder identifiers verbatim", () => {
    const view = setup("hello");
    const handled = feedPaste(view, { text: "the __init__ method" });
    expect(handled).toBe(false);
    expect(view.state.doc.textContent).toBe("hello");
  });

  test("still renders display math $$...$$", () => {
    const view = setup("");
    const handled = feedPaste(view, { text: "$$x^2$$" });
    expect(handled).toBe(true);
    expect(view.state.doc.textContent).toBe("x^2");
  });
});
