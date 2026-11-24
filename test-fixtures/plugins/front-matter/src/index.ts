import { APP_SETTINGS_SECTION } from "@texto/app-api";
import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from "@texto/markdown-editor-api";
import { definePlugin, OFFICIAL_AUTHOR } from "@texto/plugin-sdk";

import { activate } from "./activate";
import { defaultLocale, locales } from "./locales";
import { settingsSection } from "./settings";
import { frontMatterSyntaxFeature } from "./syntax/feature";
import "./front-matter.css";

export default definePlugin({
  id: "front-matter",
  displayNameKey: "front-matter.pluginName",
  descriptionKey: "front-matter.pluginDescription",
  locales,
  defaultLocale,
  version: "1.0.0",
  author: OFFICIAL_AUTHOR,
  category: "editor",
  icon: 'file-code',
  defaultEnabled: true,
  settingsApply: "immediate",
  activate,
  contributes: {
    [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [frontMatterSyntaxFeature],
    [APP_SETTINGS_SECTION]: [settingsSection],
  },
});
