import type { FeatureSpecs } from "../_types.ts";

export const headingTypeIndicatorSpecs: FeatureSpecs = {
  name: "heading-type-indicator",
  cases: [
    {
      id: "indicator-shown-h1",
      label: "cursor in H1 seed shows H1 indicator",
      seed: "# Hello",
      events: [],
      checkpoints: [
        { at: 0, expect: "<h1><h-label>H1</h-label>Hello|</h1>" },
      ],
    },
    {
      id: "indicator-shown-h3",
      label: "cursor in H3 seed shows H3 indicator",
      seed: "### Hello",
      events: [],
      checkpoints: [
        { at: 0, expect: "<h3><h-label>H3</h-label>Hello|</h3>" },
      ],
    },
    {
      id: "indicator-hidden-after-enter",
      label: "indicator hides when cursor leaves heading via Enter",
      seed: "# Hello",
      events: ["<Enter>"],
      checkpoints: [
        { at: 0, expect: "<h1><h-label>H1</h-label>Hello|</h1>" },
        { at: 1, expect: "<h1>Hello</h1>\n|" },
      ],
    },
    {
      id: "no-indicator-on-paragraph",
      label: "no indicator when cursor is in a paragraph",
      seed: "Hello",
      events: [],
      checkpoints: [
        { at: 0, expect: "Hello|" },
      ],
    },
  ],
};
