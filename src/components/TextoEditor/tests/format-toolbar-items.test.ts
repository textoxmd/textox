import { describe, expect, test } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { registerContributions } from "@texto/plugin-sdk";
import { MARKDOWN_EDITOR_FORMAT_TOOLBAR } from "@texto/markdown-editor-api";

import { parse } from "../src/parser.ts";
import { createState } from "../src/editor.ts";
import { getSchema } from "../src/schema.ts";
import { fakeView } from "../specs/sim.ts";
import { mergeFormatItems } from "../src/features/inline-format-toolbar/index.ts";
import {
  CORE_FORMAT_ITEMS,
  runFormatToolbarItem,
  selectionFullyInMark,
  selectionHasMark,
} from "../src/features/inline-format-toolbar/items.ts";

describe("CORE_FORMAT_ITEMS", () => {
  test("内置项的 id / markName / order", () => {
    expect(CORE_FORMAT_ITEMS.map((i) => [i.id, i.markName, i.order])).toEqual([
      ["bold", "strong", 0],
      ["italic", "em", 1],
      ["strikethrough", "strike", 2],
      ["inlineCode", "code", 5],
    ]);
  });

  test("runFormatToolbarItem 默认按 delim+markName 包裹", () => {
    const doc = parse("hello");
    let state = createState(doc);
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, 1, 6)));
    const view = fakeView(state);
    runFormatToolbarItem(view as unknown as EditorView, CORE_FORMAT_ITEMS[0]!);
    expect(view.state.doc.textContent).toBe("**hello**");
  });

  test("selectionHasMark 并集 vs selectionFullyInMark 全部", () => {
    const schema = getSchema();
    const mark = schema.marks.highlight.create();
    const paragraph = schema.node("paragraph", null, [
      schema.text("a", [mark]),
      schema.text("b"),
      schema.text("c", [mark]),
    ]);
    const doc = schema.node("doc", null, [paragraph]);
    let state = EditorState.create({ schema, doc });
    // 选 "ab"（1..3）：部分带 mark
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, 1, 3)));
    expect(selectionHasMark(state, "highlight")).toBe(true);
    expect(selectionFullyInMark(state, "highlight")).toBe(false);
    // 选 "a"（1..2）：全部带 mark
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, 1, 2)));
    expect(selectionFullyInMark(state, "highlight")).toBe(true);
    // 选 "b"（2..3）：无 mark
    state = state.apply(state.tr.setSelection(TextSelection.create(doc, 2, 3)));
    expect(selectionHasMark(state, "highlight")).toBe(false);
    expect(selectionFullyInMark(state, "highlight")).toBe(false);
  });
});

test("mergeFormatItems 过滤 surfaces、按 id last-wins、按 order 排序", () => {
  registerContributions("fmt-test", {
    [MARKDOWN_EDITOR_FORMAT_TOOLBAR]: [
      {
        id: "x-float", markName: "m", delim: "**", labelKey: "x.float",
        icon: [["path", "M0 0h1v1H0z"]], order: 99, surfaces: ["floating"],
      },
      {
        id: "x-toolbar", markName: "m", delim: "**", labelKey: "x.toolbar",
        icon: [["path", "M0 0h1v1H0z"]], surfaces: ["toolbar"],
      },
      {
        id: "bold", markName: "strong", delim: "**", labelKey: "plugin.bold",
        icon: [["path", "M0 0h1v1H0z"]], order: 0,
      },
    ],
  });

  const items = mergeFormatItems();
  const ids = items.map((i) => i.id);
  // surfaces 过滤：仅 toolbar 的不出现，floating 的出现
  expect(ids).toContain("x-float");
  expect(ids).not.toContain("x-toolbar");
  // last-wins：同 id（bold）插件项覆盖核心项
  expect(items.find((i) => i.id === "bold")!.labelKey).toBe("plugin.bold");
  // order 升序：order 99 的项排在核心 order 5（inlineCode）之后
  expect(ids.indexOf("x-float")).toBeGreaterThan(ids.indexOf("inlineCode"));
});
