import { describe, expect, it } from "vitest";

import { syntaxHighlightLanguages } from "./languages";

const EXPECTED_IDS = [
  "javascript",
  "typescript",
  "python",
  "html",
  "css",
  "json",
  "markdown",
  "bash",
  "rust",
  "go",
  "sql",
  "yaml",
  "diff",
  "java",
  "cpp",
  "php",
  "scss",
  "csharp",
  "ruby",
  "swift",
  "kotlin",
  "lua",
  "toml",
];

describe("syntaxHighlightLanguages", () => {
  it("contains exactly the expected language ids, each unique", () => {
    const ids = syntaxHighlightLanguages.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("provides a lazy grammar loader for every language", async () => {
    for (const lang of syntaxHighlightLanguages) {
      expect(lang.grammar, `${lang.id} should not carry a static grammar`).toBeUndefined();
      expect(typeof lang.loadGrammar, `${lang.id} missing loadGrammar`).toBe("function");
    }
    // 抽查一个语言：loader 返回真正的 highlight.js 语法函数。
    const js = syntaxHighlightLanguages.find((l) => l.id === "javascript")!;
    const grammar = await js.loadGrammar!();
    expect(typeof grammar).toBe("function");
  });

  it("exposes the backwards-compatible aliases without collisions", () => {
    const byAlias = new Map<string, string>();
    for (const lang of syntaxHighlightLanguages) {
      for (const alias of lang.aliases ?? []) {
        expect(byAlias.has(alias), `alias ${alias} duplicated`).toBe(false);
        byAlias.set(alias, lang.id);
      }
    }
    expect(byAlias.get("shell")).toBe("bash");
    expect(byAlias.get("sass")).toBe("scss");
    expect(byAlias.get("xml")).toBe("html");
  });
});
