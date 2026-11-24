import { describe, expect, it } from "vitest";
import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from "@texto/markdown-editor-api";

import plugin from "./index";
import { alertSyntaxFeature } from "./syntax/feature";

describe("alert plugin manifest", () => {
  it("contributes the alert syntax feature and is enabled by default", () => {
    expect(plugin.id).toBe("alert");
    expect(plugin.defaultEnabled).toBe(true);
    expect(plugin.displayNameKey).toBe("alert.pluginName");
    expect(plugin.descriptionKey).toBe("alert.pluginDescription");
    expect(plugin.contributes?.[MARKDOWN_EDITOR_SYNTAX_FEATURE]?.[0]).toBe(
      alertSyntaxFeature,
    );
  });
});
