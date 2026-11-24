import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerContributions } from "@texto/plugin-sdk";
import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from "@texto/markdown-editor-api";
import type { SyntaxFeature } from "@texto/markdown-editor-runtime";

import {
  collectDecorationWidgets,
  collectFormatToolbarSuppressedMarks,
  resetFeaturesForTests,
} from "../src/features/index.ts";

function stubFeature(): SyntaxFeature {
  return {
    name: "stub-inline",
    inline: {
      order: 9,
      derive: () => [],
      markNames: ["stub_mark"],
      extRanges: () => [],
      suppressFormatToolbar: true,
      decorationWidgets: { "stub-widget": () => document.createElement("i") },
    },
  };
}

const laterBuilder = () => document.createElement("b");

beforeAll(() => {
  registerContributions("stub-plugin", {
    [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [
      stubFeature(),
      {
        ...stubFeature(),
        name: "stub-inline-2",
        inline: {
          ...stubFeature().inline!,
          decorationWidgets: { "stub-widget": laterBuilder },
        },
      },
    ],
  });
});

beforeEach(() => resetFeaturesForTests());

describe("inline plugin contract projections", () => {
  it("merges plugin-contributed decoration widget builders", () => {
    expect(typeof collectDecorationWidgets()["stub-widget"]).toBe("function");
  });

  it("later plugin contribution wins for the same widget kind", () => {
    expect(collectDecorationWidgets()["stub-widget"]).toBe(laterBuilder);
  });

  it("collects format-toolbar suppressed marks", () => {
    expect(collectFormatToolbarSuppressedMarks()).toContain("stub_mark");
  });
});
