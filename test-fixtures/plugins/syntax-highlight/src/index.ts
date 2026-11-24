import { APP_SETTINGS_SECTION } from "@texto/app-api";
import { MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT } from "@texto/markdown-editor-api";
import { definePlugin, OFFICIAL_AUTHOR } from "@texto/plugin-sdk";

import { activate } from "./activate";
import { syntaxHighlightLanguages } from "./languages";
import { defaultLocale, locales } from "./locales";
import { settingsSection } from "./settings";

export default definePlugin({
  id: "syntax-highlight",
  displayNameKey: "syntax-highlight.pluginName",
  descriptionKey: "syntax-highlight.pluginDescription",
  version: "1.0.0",
  author: OFFICIAL_AUTHOR,
  category: "editor",
  locales,
  defaultLocale,
  icon: 'palette',
  defaultEnabled: true,
  settingsApply: "immediate",
  activate,
  contributes: {
    [MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT]: [{ languages: syntaxHighlightLanguages }],
    [APP_SETTINGS_SECTION]: [settingsSection],
  },
});
