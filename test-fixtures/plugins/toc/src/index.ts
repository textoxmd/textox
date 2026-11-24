import { MARKDOWN_EDITOR_SYNTAX_FEATURE } from "@texto/markdown-editor-api";
import { definePlugin, OFFICIAL_AUTHOR } from "@texto/plugin-sdk";

import { defaultLocale, locales } from "./locales";
import { tocSyntaxFeature } from "./syntax/feature";
import "./toc.css";

export default definePlugin({
  id: "toc",
  displayNameKey: "toc.pluginName",
  descriptionKey: "toc.pluginDescription",
  locales,
  defaultLocale,
  version: "1.0.0",
  author: OFFICIAL_AUTHOR,
  category: "editor",
  icon: 'list-tree',
  defaultEnabled: true,
  settingsApply: "immediate",
  contributes: {
    [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [tocSyntaxFeature],
  },
});
