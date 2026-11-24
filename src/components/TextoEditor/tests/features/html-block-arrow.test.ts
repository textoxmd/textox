import { beforeAll, describe, it, expect, vi } from "vitest";
import { TextSelection } from "prosemirror-state";
import { parse } from "../../src/parser.ts";
import { createState } from "../../src/editor.ts";
import { allFeatures } from "../../src/features/index.ts";
import { getSchema } from "../../src/schema.ts";

// HTML 语法现由 official-plugins/html 经 `markdown-editor:syntaxFeature` 贡献
// （见 tests/plugins-setup.ts）；从合并后的功能表取回 html-block 功能本身。
function htmlBlockFeature() {
  const feature = allFeatures().find((f) => f.name === "html-block");
  if (!feature) throw new Error("html-block feature not registered");
  return feature;
}

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  length: 0,
  key: () => null,
});

describe("html-block: arrow navigation via keymap command", () => {
  it("ArrowDown from a paragraph above enters a render-mode html_block", () => {
    const doc = parse("para1\n\n<div>\niframe\n</div>");
    const base = createState(doc);
    const state = base.apply(base.tr.setSelection(TextSelection.create(doc, 5)));
    let dispatched: ReturnType<typeof state.tr.setSelection> | null = null;
    const km = htmlBlockFeature().keymap!(schema);
    const handled = km.ArrowDown!(state, (tr) => {
      dispatched = tr;
    });
    expect(handled).toBe(true);
    expect(dispatched).not.toBeNull();
    const sel = dispatched!.selection as TextSelection;
    expect(sel.$from.parent.type.name).toBe("html_block");
  });

  it("ArrowUp from a paragraph below enters a render-mode html_block", () => {
    const doc = parse("<div>\niframe\n</div>\n\npara1");
    const base = createState(doc);
    // cursor at start of the paragraph below the block
    const belowStart = doc.content.size - doc.lastChild!.nodeSize + 1;
    const state = base.apply(base.tr.setSelection(TextSelection.create(doc, belowStart)));
    let dispatched: ReturnType<typeof state.tr.setSelection> | null = null;
    const km = htmlBlockFeature().keymap!(schema);
    const handled = km.ArrowUp!(state, (tr) => {
      dispatched = tr;
    });
    expect(handled).toBe(true);
    expect(dispatched).not.toBeNull();
    const sel = dispatched!.selection as TextSelection;
    expect(sel.$from.parent.type.name).toBe("html_block");
  });
});
