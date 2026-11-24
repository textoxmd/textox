import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from "@texto/markdown-editor-api";
import { definePlugin, OFFICIAL_AUTHOR } from "@texto/plugin-sdk";

import { defaultLocale, locales } from "./locales";
import { alertSyntaxFeature } from "./syntax/feature";
import "./alert.css";

export default definePlugin({
  id: "alert",
  displayNameKey: "alert.pluginName",
  descriptionKey: "alert.pluginDescription",
  locales,
  defaultLocale,
  version: "1.0.0",
  author: OFFICIAL_AUTHOR,
  category: "editor",
  icon: 'message-square-warning',
  defaultEnabled: true,
  settingsApply: "immediate",
  contributes: {
    [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [alertSyntaxFeature],
  },
});
