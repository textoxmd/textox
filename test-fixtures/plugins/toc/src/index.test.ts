import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from "@texto/markdown-editor-api";
import { describe, expect, it } from "vitest";

import plugin from "./index";
import { tocSyntaxFeature } from "./syntax/feature";

describe("toc plugin manifest", () => {
  it("contributes the toc syntax feature and is enabled by default", () => {
    expect(plugin.id).toBe("toc");
    expect(plugin.defaultEnabled).toBe(true);
    expect(plugin.category).toBe("editor");
    expect(plugin.displayNameKey).toBe("toc.pluginName");
    expect(plugin.descriptionKey).toBe("toc.pluginDescription");
    expect(plugin.contributes?.[MARKDOWN_EDITOR_SYNTAX_FEATURE]?.[0]).toBe(
      tocSyntaxFeature,
    );
  });
});
