import type { FeatureSpecs } from "../_types.ts";

export const underlineSpecs: FeatureSpecs = {
  name: "underline",
  renderCases: {
    u: (children) => `<u>${children}</u>`,
  },
  cases: [
    {
      id: "html-u-tag",
      label: "underline via <u> tag",
      seed: "",
      events: ["<", "u", ">", "t", "<", "/", "u", ">", " "],
      checkpoints: [
        { at: 3, expect: "<u>|" },
        { at: 4, expect: "<u>t|" },
        { at: 7, expect: "<u>t</u|" },
        { at: 8, expect: "<g><u></g><u>t</u><g></u></g>|" },
      ],
    },
  ],
};
