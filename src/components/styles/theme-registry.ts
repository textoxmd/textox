import { invoke } from '@tauri-apps/api/core';

export interface ColorThemeConfig {
  id: string;
  name: string;
  label?: string;
  labelEn?: string;
  isDefault?: boolean;
  isBuiltin?: boolean;
  author?: string;
  description?: string;
  version?: string;
  themeType?: string;
  importedFrom?: string;
  importedAt?: string;
}

export interface ThemeMeta {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  themeType: string;
  isBuiltin: boolean;
  isDefault: boolean;
  importedFrom?: string;
  importedAt?: string;
  conversionNotes?: string[];
}

export const BUILTIN_THEMES: ColorThemeConfig[] = [
  {
    id: 'default',
    name: 'Default',
    label: '默认',
    labelEn: 'Default',
    isDefault: true,
    isBuiltin: true,
  },
  {
    id: 'pastel',
    name: 'Pastel',
    label: '樱染',
    labelEn: 'Cherry',
    isBuiltin: true,
  },
  {
    id: 'spring',
    name: 'Spring',
    label: '惊蛰',
    labelEn: 'Spring',
    isBuiltin: true,
  },
];

const DEFAULT_BUILTIN = BUILTIN_THEMES.find(t => t.isDefault) || BUILTIN_THEMES[0];

export const DEFAULT_COLOR_THEME: ColorThemeConfig = DEFAULT_BUILTIN;

export type ColorTheme = string;

let themeRegistry: ColorThemeConfig[] = [...BUILTIN_THEMES];

function themeMetaToConfig(meta: ThemeMeta): ColorThemeConfig {
  return {
    id: meta.id,
    name: meta.isBuiltin ? meta.name : `t_${meta.id.replace(/-/g, '').slice(0, 8)}`,
    label: meta.name,
    labelEn: meta.name,
    isDefault: meta.isDefault,
    isBuiltin: meta.isBuiltin,
    author: meta.author,
    description: meta.description,
    version: meta.version,
    themeType: meta.themeType,
    importedFrom: meta.importedFrom,
    importedAt: meta.importedAt,
  };
}

function mergeUserThemes(builtin: ColorThemeConfig[], user: ThemeMeta[]): ColorThemeConfig[] {
  const result = [...builtin];
  const userConfigs = user.map(themeMetaToConfig);
  for (const ut of userConfigs) {
    const idx = result.findIndex(t => t.id === ut.id);
    if (idx >= 0) {
      result[idx] = ut;
    } else {
      result.push(ut);
    }
  }
  return result;
}

export async function initThemeRegistry(): Promise<ColorThemeConfig[]> {
  try {
    const userThemes = await invoke<ThemeMeta[]>('list_themes');
    const user = userThemes.filter(t => !t.isBuiltin);
    themeRegistry = mergeUserThemes(BUILTIN_THEMES, user);
  } catch (e) {
    console.warn('[ThemeRegistry] Failed to load user themes, using built-in only:', e);
    themeRegistry = [...BUILTIN_THEMES];
  }
  window.dispatchEvent(new CustomEvent('themeregistryready', { detail: themeRegistry }));
  return themeRegistry;
}

export function getThemeConfig(id: string): ColorThemeConfig {
  return themeRegistry.find(t => t.id === id) || DEFAULT_COLOR_THEME;
}

export function isValidColorTheme(id: string): boolean {
  return themeRegistry.some(t => t.id === id);
}

export function getAvailableThemes(): ColorThemeConfig[] {
  return themeRegistry;
}

export function getColorThemeTranslationKey(id: string): string {
  const keyMap: Record<string, string> = {
    'default': 'settings.colorThemeDefault',
    'pastel': 'settings.colorThemePastel',
    'spring': 'settings.colorThemeSpring',
  };
  if (keyMap[id]) return keyMap[id];
  const theme = themeRegistry.find(t => t.id === id);
  if (theme?.isBuiltin) return 'settings.colorThemeDefault';
  return 'settings.colorThemeDefault';
}

/** @deprecated Use BUILTIN_THEMES and getAvailableThemes() instead */
export const REGISTERED_COLOR_THEMES: ColorThemeConfig[] = BUILTIN_THEMES;

export async function loadUserThemeCss(id: string): Promise<string | null> {
  try {
    return await invoke<string>('load_user_theme_css', { id });
  } catch {
    return null;
  }
}

export async function deleteUserTheme(id: string): Promise<void> {
  await invoke('delete_theme', { id });
  themeRegistry = themeRegistry.filter(t => t.id !== id);
}
