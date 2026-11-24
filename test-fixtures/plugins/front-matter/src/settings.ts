import type { SettingsSection } from "@texto/app-api";

import { VIEW_MODE_KEY } from "./view/mode";

export const settingsSection: SettingsSection = {
  id: "front-matter.properties",
  titleKey: "front-matter.settingsTitle",
  fields: [
    {
      type: "select",
      key: VIEW_MODE_KEY,
      labelKey: "front-matter.defaultView",
      descriptionKey: "front-matter.defaultViewDesc",
      default: "panel",
      options: [
        { value: "panel", labelKey: "front-matter.viewPanel" },
        { value: "source", labelKey: "front-matter.viewSource" },
      ],
    },
  ],
};
