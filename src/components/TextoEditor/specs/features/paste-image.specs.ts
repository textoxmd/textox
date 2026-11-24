import type { FeatureSpecs } from "../_types.ts";

export const pasteImageSpecs: FeatureSpecs = {
  name: "paste-image",
  cases: [
    {
      id: "plugin-exists",
      label: "paste-image plugin is loaded",
      seed: "",
      events: [],
      checkpoints: [
        { at: 0, expect: "|" },
      ],
    },
  ],
};
