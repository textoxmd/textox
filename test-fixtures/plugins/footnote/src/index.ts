import {
  MARKDOWN_EDITOR_EXTENSION,
  MARKDOWN_EDITOR_SYNTAX_FEATURE,
} from "@texto/markdown-editor-api";
import { definePlugin, OFFICIAL_AUTHOR } from "@texto/plugin-sdk";

import { footnoteInsert } from "./insert";
import { defaultLocale, locales } from "./locales";
import { footnoteFeature } from "./syntax/feature";
import "./syntax/footnote.css";

export default definePlugin({
  id: "footnote",
  displayNameKey: "footnote.pluginName",
  descriptionKey: "footnote.pluginDescription",
  locales,
  defaultLocale,
  version: "1.0.0",
  author: OFFICIAL_AUTHOR,
  category: "editor",
  icon: 'asterisk',
  defaultEnabled: true,
  settingsApply: "immediate",
  contributes: {
    [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [footnoteFeature],
    [MARKDOWN_EDITOR_EXTENSION]: [
      {
        id: "footnote.editor",
        insert: footnoteInsert,
        create() {
          return {};
        },
      },
    ],
  },
});
