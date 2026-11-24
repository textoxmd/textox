import { MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT } from "@texto/markdown-editor-api";
import { describe, expect, it } from "vitest";

import plugin from "./index";
import { syntaxHighlightLanguages } from "./languages";

describe("syntax-highlight plugin manifest", () => {
  it("contributes the highlight languages and is enabled by default", () => {
    expect(plugin.id).toBe("syntax-highlight");
    expect(plugin.defaultEnabled).toBe(true);
    expect(plugin.settingsApply).toBe("immediate");
    expect(plugin.category).toBe("editor");
    expect(plugin.displayNameKey).toBe("syntax-highlight.pluginName");
    expect(plugin.descriptionKey).toBe("syntax-highlight.pluginDescription");
    expect(plugin.contributes?.[MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT]?.[0]?.languages).toBe(
      syntaxHighlightLanguages,
    );
  });
});
