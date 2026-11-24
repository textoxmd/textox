import { beforeEach, describe, expect, it } from "vitest";
import { registerContributions, resetExtensionPointsForTests } from "@texto/plugin-sdk";
import {
  MARKDOWN_EDITOR_EXTENSION,
  MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT,
} from "@texto/markdown-editor-api";
import type { HighlightLanguage } from "@texto/markdown-editor-api";

import { declareMarkdownEditorExtensionPoint } from "../src/extension/registry";
import { languageOptions } from "../src/features/fenced-code";

const grammar = (() => ({})) as unknown as HighlightLanguage["grammar"];

beforeEach(() => {
  resetExtensionPointsForTests();
});

describe("languageOptions", () => {
  it("only exposes text when no language is contributed", () => {
    declareMarkdownEditorExtensionPoint();
    expect(languageOptions()).toEqual([{ value: "", label: "text" }]);
  });

  it("merges contributed highlight languages and custom view languages, deduped", () => {
    declareMarkdownEditorExtensionPoint();
    registerContributions("t", {
      [MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT]: [
        {
          languages: [
            { id: "javascript", label: "JavaScript", aliases: ["js"], grammar },
            { id: "python", grammar },
          ],
        },
      ],
      [MARKDOWN_EDITOR_EXTENSION]: [{ id: "view", languages: ["mermaid"], create: () => ({}) }],
    });

    const options = languageOptions();
    expect(options.map((o) => o.value)).toEqual(["", "javascript", "python", "mermaid"]);
    expect(options[1]).toMatchObject({ label: "JavaScript", aliases: ["js"] });
    expect(options[2]!.label).toBe("python");
  });
});
