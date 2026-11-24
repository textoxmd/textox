/**
 * 样式入口文件
 * 导出主题管理相关功能
 */

// 主题注册表（添加新主题只需修改此文件）
export {
  REGISTERED_COLOR_THEMES,
  BUILTIN_THEMES,
  DEFAULT_COLOR_THEME,
  getThemeConfig,
  isValidColorTheme,
  getAvailableThemes,
  initThemeRegistry,
  loadUserThemeCss,
  deleteUserTheme,
  type ColorThemeConfig,
  type ThemeMeta
} from './theme-registry';

// 新主题 API
export {
  setColorTheme,
  setAppearance,
  setFontFamily,
  setEditorFontFamily,
  getCurrentColorTheme,
  getCurrentAppearance,
  getCurrentFontFamily,
  getCurrentEditorFontFamily,
  applyColorTheme,
  applyAppearance,
  applyFontFamily,
  applyEditorFontFamily,
  toggleAppearance,
  getColorThemeTranslationKey,
  getAppearanceLabel,
  getFontFamilyLabel,
  getEditorFontFamilyLabel,
  getFontFamilyValue,
  getEditorFontFamilyValue,
  // 预设字体相关
  PRESET_FONTS,
  PRESET_EDITOR_FONTS,
  isPresetFontFamily,
  isPresetEditorFontFamily,
  // 保留旧名称以兼容现有代码
  REGISTERED_FONTS,
  REGISTERED_EDITOR_FONTS,
  DEFAULT_FONT,
  DEFAULT_EDITOR_FONT,
  applyCodeThemeFromCss,
  getInjectedThemeCss,
  composeThemeCss,
  syncSourceCodeThemeStorage,
  // 旧 API（兼容性导出）
  setTheme,
  getCurrentTheme,
  toggleTheme,
  getThemeLabel,
  type ThemeQuickSettings
} from './theme';

export type {
  ColorTheme,
  Appearance,
  FontFamily,
  EditorFontFamily,
  PresetFontFamily,
  PresetEditorFontFamily,
  FontConfig,
  EditorFontConfig,
  // 旧类型（兼容性导出）
  Theme
} from './theme';

// 导入统一样式文件
import './index.css';
