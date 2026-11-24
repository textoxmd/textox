import { describe, it, expect, vi } from "vitest";
import { parse, parseTokens } from "../src/parser.ts";

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  length: 0,
  key: () => null,
});

// alert 插件由 tests/plugins-setup.ts 经 glob 自动注册，这里验证编辑器管线行为。
describe("alert parser integration", () => {
  it("splits the marker from continuation content", () => {
    const tokens = parseTokens("> [!WARNING]\n> Be careful\n");
    expect(tokens.filter((t) => t.type === "inline")).toHaveLength(2);
  });
});

describe("alert decoration", () => {
  it("blockquote with [NOTE] stays as blockquote", () => {
    const doc = parse("> [!NOTE]\n> Hello");
    expect(doc.firstChild!.type.name).toBe("blockquote");
  });

  it("preserves marker text in document", () => {
    const doc = parse("> [!NOTE]\n> Hello\n");
    const bq = doc.firstChild!;
    expect(bq.type.name).toBe("blockquote");
    expect(bq.firstChild!.textContent).toMatch(/^\[!NOTE\]/);
  });

  it("keeps regular blockquote as blockquote", () => {
    const doc = parse("> Just a quote");
    expect(doc.firstChild!.type.name).toBe("blockquote");
  });

  it("splits continuation lines into separate paragraphs", () => {
    const doc = parse("> [!WARNING]\n> Be careful\n");
    const bq = doc.firstChild!;
    expect(bq.childCount).toBe(2);
    expect(bq.child(0).textContent).toBe("[!WARNING]");
    expect(bq.child(1).textContent).toBe("Be careful");
  });

  it("does not split without newline", () => {
    const doc = parse("> [!NOTE]");
    const bq = doc.firstChild!;
    expect(bq.childCount).toBe(1);
  });
});
