import type { SettingsSection } from '@texto/app-api';
import { CODE_HIGHLIGHT_THEMES } from '@texto/markdown-editor-api';

export const CONFIG_LIGHT = 'lightTheme';
export const CONFIG_DARK = 'darkTheme';
export const DEFAULT_LIGHT = 'githubLight';
export const DEFAULT_DARK = 'githubDark';

export const settingsSection: SettingsSection = {
  id: 'syntax-highlight',
  titleKey: 'syntax-highlight.settingsTitle',
  fields: [
    {
      type: 'select',
      key: CONFIG_LIGHT,
      labelKey: 'syntax-highlight.lightTheme',
      descriptionKey: 'syntax-highlight.lightThemeDesc',
      default: DEFAULT_LIGHT,
      options: CODE_HIGHLIGHT_THEMES.filter((t) => !t.isDark).map((t) => ({
        value: t.value,
        label: t.label,
      })),
    },
    {
      type: 'select',
      key: CONFIG_DARK,
      labelKey: 'syntax-highlight.darkTheme',
      descriptionKey: 'syntax-highlight.darkThemeDesc',
      default: DEFAULT_DARK,
      options: CODE_HIGHLIGHT_THEMES.filter((t) => t.isDark).map((t) => ({
        value: t.value,
        label: t.label,
      })),
    },
  ],
};
