import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from "@texto/markdown-editor-api";
import { describe, expect, it } from "vitest";

import plugin from "./index";
import { frontMatterSyntaxFeature } from "./syntax/feature";

describe("front-matter plugin manifest", () => {
  it("contributes the front matter syntax feature and is enabled by default", () => {
    expect(plugin.id).toBe("front-matter");
    expect(plugin.defaultEnabled).toBe(true);
    expect(plugin.displayNameKey).toBe("front-matter.pluginName");
    expect(plugin.descriptionKey).toBe("front-matter.pluginDescription");
    expect(plugin.contributes?.[MARKDOWN_EDITOR_SYNTAX_FEATURE]?.[0]).toBe(
      frontMatterSyntaxFeature,
    );
  });
});
