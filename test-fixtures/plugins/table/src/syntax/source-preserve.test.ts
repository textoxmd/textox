import type { Node as PMNode } from "prosemirror-model";
import { Schema } from "prosemirror-model";
import type Token from "markdown-it/lib/token.mjs";
import { describe, expect, it } from "vitest";

import { tableFeature } from "./feature";
import { tableSourcePreserve } from "./source-preserve";

// Minimal schema: doc + paragraph/text so the table nodes have a place to
// live. `tableFeature.nodes` supplies table / table_row / table_cell.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
    ...(tableFeature.nodes ?? {}),
  },
});

function cell(text: string, header: boolean): PMNode {
  return schema.nodes.table_cell!.create(
    { header, align: null },
    text ? [schema.text(text)] : [],
  );
}

function row(...cells: PMNode[]): PMNode {
  return schema.nodes.table_row!.create(null, cells);
}

function makeTable(header: string[], body: string[][]): PMNode {
  return schema.nodes.table!.create(null, [
    row(...header.map((t) => cell(t, true))),
    ...body.map((r) => row(...r.map((t) => cell(t, false)))),
  ]);
}

// A minimal stand-in for the core-injected `renderBlockCanon`: emits a real
// multi-line GFM table (header + divider + body) so `tableCanonicalRows`
// yields one row per PM table_row.
function renderTableCanon(n: PMNode): string {
  const lines: string[] = [];
  n.forEach((r, _o, rowIdx) => {
    const cells: string[] = [];
    r.forEach((c) => cells.push(c.textContent.replace(/\|/g, "\\|")));
    lines.push("| " + cells.join(" | ") + " |");
    if (rowIdx === 0) {
      lines.push(
        "| " + Array.from({ length: r.childCount }, () => "---").join(" | ") + " |",
      );
    }
  });
  return lines.join("\n");
}

describe("tableSourcePreserve.collect", () => {
  it("collects tr_open line ranges per top-level table", () => {
    const tokens = [
      { type: "paragraph_open", nesting: 1, map: [10, 11] },
      { type: "paragraph_close", nesting: -1 },
      { type: "table_open", nesting: 1, map: [11, 14] },
      { type: "thead_open", nesting: 1 },
      { type: "tr_open", nesting: 1, map: [11, 12] },
      { type: "tr_close", nesting: -1 },
      { type: "thead_close", nesting: -1 },
      { type: "tbody_open", nesting: 1 },
      { type: "tr_open", nesting: 1, map: [13, 14] },
      { type: "tr_close", nesting: -1 },
      { type: "tbody_close", nesting: -1 },
      { type: "table_close", nesting: -1, map: [11, 14] },
    ] as unknown as Token[];

    const collected = tableSourcePreserve.collect(tokens, [], [3]);
    expect(collected).toEqual([
      { spans: [{ start: 11, end: 12 }, { start: 13, end: 14 }] },
    ]);
  });

  it("aligns results with matches and leaves unmatched slots null", () => {
    const tokens = [
      { type: "table_open", nesting: 1, map: [1, 3] },
      { type: "tr_open", nesting: 1, map: [1, 2] },
      { type: "tr_open", nesting: 1, map: [2, 3] },
      { type: "table_close", nesting: -1, map: [1, 3] },
    ] as unknown as Token[];

    const collected = tableSourcePreserve.collect(tokens, [], [0, 4]);
    expect(collected[0]).toEqual({
      spans: [{ start: 1, end: 2 }, { start: 2, end: 3 }],
    });
    expect(collected[1]).toBeNull();
  });

  it("ignores tables nested inside containers, collecting only top-level tables", () => {
    const tokens = [
      { type: "blockquote_open", nesting: 1, map: [0, 3] },
      { type: "table_open", nesting: 1, map: [0, 3] },
      { type: "tr_open", nesting: 1, map: [0, 1] },
      { type: "tr_close", nesting: -1 },
      { type: "tr_open", nesting: 1, map: [2, 3] },
      { type: "tr_close", nesting: -1 },
      { type: "table_close", nesting: -1 },
      { type: "blockquote_close", nesting: -1 },
      { type: "table_open", nesting: 1, map: [4, 7] },
      { type: "tr_open", nesting: 1, map: [4, 5] },
      { type: "tr_close", nesting: -1 },
      { type: "tr_open", nesting: 1, map: [6, 7] },
      { type: "tr_close", nesting: -1 },
      { type: "table_close", nesting: -1 },
    ] as unknown as Token[];

    const out = tableSourcePreserve.collect(tokens, [], [1]);
    expect(out[0]!.spans).toEqual([{ start: 4, end: 5 }, { start: 6, end: 7 }]);
  });
});

describe("tableSourcePreserve.canonicalUnits", () => {
  it("returns one canonical row per table_row (divider dropped)", () => {
    const table = makeTable(["a", "b"], [["1", "2"]]);
    expect(tableSourcePreserve.canonicalUnits(table, renderTableCanon)).toEqual([
      "| a | b |",
      "| 1 | 2 |",
    ]);
  });
});

describe("tableSourcePreserve.splice", () => {
  const src = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";

  it("replaces only the edited cell, preserving untouched rows and divider", () => {
    const oldTable = makeTable(["a", "b"], [["1", "2"]]);
    const newTable = makeTable(["a", "B"], [["1", "2"]]);
    const sigs = tableSourcePreserve.canonicalUnits(oldTable, renderTableCanon);

    const out = tableSourcePreserve.splice(
      src,
      "\n",
      { spans: [{ start: 0, end: 1 }, { start: 2, end: 3 }], sigs },
      newTable,
      renderTableCanon,
    );

    expect(out).not.toBeNull();
    expect(out!).toContain("| a | B |");
    expect(out!).toContain("| 1 | 2 |");
    expect(out!).toContain("| --- | --- |");
    // Exact output: edited header cell, original divider and untouched body row.
    expect(out).toBe("| a | B |\n| --- | --- |\n| 1 | 2 |\n");
  });

  it("keeps CRLF line endings when the source uses CRLF", () => {
    const crlfSrc = "| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n";
    const oldTable = makeTable(["a", "b"], [["1", "2"]]);
    const newTable = makeTable(["a", "B"], [["1", "2"]]);
    const sigs = tableSourcePreserve.canonicalUnits(oldTable, renderTableCanon);

    const out = tableSourcePreserve.splice(
      crlfSrc,
      "\r\n",
      { spans: [{ start: 0, end: 1 }, { start: 2, end: 3 }], sigs },
      newTable,
      renderTableCanon,
    );

    expect(out).toBe("| a | B |\r\n| --- | --- |\r\n| 1 | 2 |\r\n");
    // No bare LF: stripping CRLF must leave no remaining "\n".
    expect(out!.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("returns null when row counts are structurally inconsistent", () => {
    const oldTable = makeTable(["a", "b"], [["1", "2"]]);
    const newTable = makeTable(["a", "b"], [["1", "2"], ["3", "4"]]);
    const sigs = tableSourcePreserve.canonicalUnits(oldTable, renderTableCanon);

    const out = tableSourcePreserve.splice(
      src,
      "\n",
      { spans: [{ start: 0, end: 1 }, { start: 2, end: 3 }], sigs },
      newTable,
      renderTableCanon,
    );

    expect(out).toBeNull();
  });
});
