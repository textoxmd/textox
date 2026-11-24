import { describe, test, expect } from "vitest";
import { runFeatureCases } from "../utils.ts";
import { htmlInlineSpecs } from "../../specs/features/html-inline.specs.ts";
import { parse } from "../../src/parser.ts";
import { serialize } from "../../src/serializer.ts";

runFeatureCases(htmlInlineSpecs);

describe("html-inline serialization", () => {
  function roundTripStable(md: string): void {
    const doc1 = parse(md);
    const md2 = serialize(doc1);
    const doc2 = parse(md2);
    if (!doc1.eq(doc2)) {
      throw new Error(
        `round-trip mismatch\n--- input md ---\n${md}\n--- serialized md ---\n${md2}\n--- doc1 ---\n${JSON.stringify(doc1.toJSON(), null, 2)}\n--- doc2 ---\n${JSON.stringify(doc2.toJSON(), null, 2)}`,
      );
    }
  }

  test("span with style round-trips", () => {
    roundTripStable(`<span style="color:red">红色文字</span>`);
  });

  test("kbd round-trips", () => {
    roundTripStable(`<kbd>Ctrl</kbd>`);
  });

  test("serialize does not duplicate tags", () => {
    const md = `<span style="color:red">红色文字</span>`;
    const doc = parse(md);
    const out = serialize(doc);
    // Count occurrences — should be exactly one open and one close tag
    const openCount = (out.match(/<span/g) || []).length;
    const closeCount = (out.match(/<\/span>/g) || []).length;
    expect(openCount).toBe(1);
    expect(closeCount).toBe(1);
    expect(out).toBe(md);
  });
});
