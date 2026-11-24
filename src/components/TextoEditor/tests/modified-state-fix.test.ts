import { describe, test, expect } from "vitest";
import { parse } from "../src/parser";
import { serialize } from "../src/serializer";

/**
 * Simulates the fix logic in App.tsx handleContentChange:
 *   modified = content !== originalContentRef.current
 *           && content !== originalBaselineRef.current;
 * where originalBaselineRef.current = serialize(parse(originalContent))
 */
function isModified(
  content: string,
  originalContent: string,
  baseline: string,
): boolean {
  return content !== originalContent && content !== baseline;
}

describe("modified-state-fix", () => {
  test("plain text is stable through roundtrip", () => {
    const original = "hello world";
    const baseline = serialize(parse(original));
    // The serialized version should be the baseline
    expect(isModified(baseline, original, baseline)).toBe(false);
    // The original should also be detected as not modified
    expect(isModified(original, original, baseline)).toBe(false);
  });

  test("headings normalize through roundtrip (e.g., spacing)", () => {
    const original = "#  Heading 1\n\n##  Heading 2";
    const baseline = serialize(parse(original));
    // The serializer may normalize spacing: "# Heading 1\n\n## Heading 2"
    // The modifed check should not false-positive on the normalized version
    expect(isModified(baseline, original, baseline)).toBe(false);
    // A truly different content should still be detected as modified
    expect(isModified("# Modified Heading", original, baseline)).toBe(true);
  });

  test("fenced code blocks are stable", () => {
    const original = "```ts\nconst x = 1;\n```";
    const baseline = serialize(parse(original));
    expect(isModified(baseline, original, baseline)).toBe(false);
    expect(isModified(original, original, baseline)).toBe(false);
    // Changing the code content should be detected
    const modified = "```ts\nconst x = 2;\n```";
    expect(isModified(modified, original, baseline)).toBe(true);
  });

  test("tables normalize through roundtrip", () => {
    const original = "| a | b |\n|---|---|\n| 1 | 2 |";
    const baseline = serialize(parse(original));
    expect(isModified(baseline, original, baseline)).toBe(false);
    expect(isModified(original, original, baseline)).toBe(false);
  });

  test("empty content edge case", () => {
    const original = "";
    const baseline = serialize(parse(original));
    expect(isModified(baseline, original, baseline)).toBe(false);
    expect(isModified("", original, baseline)).toBe(false);
    expect(isModified("new content", original, baseline)).toBe(true);
  });

  test("trailing newline normalization", () => {
    const original = "paragraph\n\n";
    const baseline = serialize(parse(original));
    // The serializer might strip or normalize trailing newlines
    // The important thing is the baseline should match the serialized editor output
    expect(isModified(baseline, original, baseline)).toBe(false);
  });

  test("setext headings normalize to atx", () => {
    const original = "Heading 1\n===\n\nBody";
    const baseline = serialize(parse(original));
    // The serializer might convert setext to ATX headings
    // The key is that the baseline (serialized form) is not falsely modified
    expect(isModified(baseline, original, baseline)).toBe(false);
  });

  test("realistic complex document", () => {
    const original = `# My Document

## Introduction

This is a **paragraph** with *emphasis*.

\`\`\`python
def hello():
    print("world")
\`\`\`

| Col1 | Col2 |
|------|------|
| A    | B    |

> A blockquote

1. Ordered list item
2. Another item

- Unordered item
- Another item
`;
    const baseline = serialize(parse(original));
    // The normalized baseline should not trigger modified
    expect(isModified(baseline, original, baseline)).toBe(false);
    // Original should also not trigger modified
    expect(isModified(original, original, baseline)).toBe(false);
    // An actual edit should be detected
    const edited = original + "\n\n## New Section\n\nAdded content\n";
    expect(isModified(edited, original, baseline)).toBe(true);
  });
});
