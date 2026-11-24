import {
  BUILTIN_THEMES,
  DEFAULT_COLOR_THEME,
  getThemeConfig,
  isValidColorTheme,
  getColorThemeTranslationKey,
  initThemeRegistry,
  loadUserThemeCss,
  type ColorThemeConfig,
  type ThemeMeta,
} from './theme-registry';

import builtinDefaultCss from './themes/default.css?raw';
import builtinPastelCss from './themes/pastel.css?raw';
import builtinSpringCss from './themes/spring.css?raw';
import {
  loadThemeQuickSettings,
  quickSettingsToCss,
  type ThemeQuickSettings,
} from './theme-quick-settings';

export type { ColorThemeConfig, ThemeMeta };
export type { ThemeQuickSettings };
export { BUILTIN_THEMES, getColorThemeTranslationKey, isValidColorTheme, getThemeConfig, initThemeRegistry, loadUserThemeCss };

export type ColorTheme = string;

export type Appearance = 'light' | 'dark' | 'system';

export type PresetFontFamily = 'system';
export type PresetEditorFontFamily = 'system' | 'mono';

export type FontFamily = PresetFontFamily | string;

export type EditorFontFamily = PresetEditorFontFamily | string;

export interface FontConfig {
  id: FontFamily;
  label: string;
  value: string;
}

export interface EditorFontConfig {
  id: EditorFontFamily;
  label: string;
  value: string;
}

export const PRESET_FONTS: FontConfig[] = [
  {
    id: 'system',
    label: '系统默认',
    value: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
  },
];

export const PRESET_EDITOR_FONTS: EditorFontConfig[] = [
  {
    id: 'system',
    label: '系统默认',
    value: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
  },
  {
    id: 'mono',
    label: '等宽字体',
    value: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, "Courier New", monospace'
  },
];

export const REGISTERED_FONTS = PRESET_FONTS;
export const REGISTERED_EDITOR_FONTS = PRESET_EDITOR_FONTS;

async function importFont(_font: FontFamily): Promise<void> {
}

async function waitForFont(font: FontFamily): Promise<void> {
  if (font === 'system') return;
}

export const DEFAULT_FONT: FontFamily = 'system';

const COLOR_THEME_STORAGE_KEY = 'texto-color-theme';
const APPEARANCE_STORAGE_KEY = 'texto-appearance';
const FONT_FAMILY_STORAGE_KEY = 'texto-font-family';
const EDITOR_FONT_FAMILY_STORAGE_KEY = 'texto-editor-font-family';

export const DEFAULT_EDITOR_FONT: EditorFontFamily = 'system';

// Windows WebView2 白色光标 bug 修复：标记平台，供 updateIBeamCursor 与编辑器光标样式使用
if (navigator.platform.toUpperCase().indexOf('WIN') >= 0) {
  document.documentElement.classList.add('win32');
}

export function getCurrentColorTheme(): ColorTheme {
  const stored = localStorage.getItem(COLOR_THEME_STORAGE_KEY);
  if (stored && isValidColorTheme(stored)) {
    return stored;
  }
  return DEFAULT_COLOR_THEME.id;
}

export function getCurrentAppearance(): Appearance {
  const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY) as Appearance | null;
  return stored || 'system';
}

export function isPresetFontFamily(font: string): font is PresetFontFamily {
  return PRESET_FONTS.some(f => f.id === font);
}

export function isPresetEditorFontFamily(font: string): font is PresetEditorFontFamily {
  return PRESET_EDITOR_FONTS.some(f => f.id === font);
}

export function getCurrentFontFamily(): FontFamily {
  const stored = localStorage.getItem(FONT_FAMILY_STORAGE_KEY);
  if (stored) return stored;
  return DEFAULT_FONT;
}

export function getFontFamilyLabel(font: FontFamily): string {
  const config = PRESET_FONTS.find(f => f.id === font);
  return config?.label || font;
}

export function getFontFamilyValue(font: FontFamily): string {
  const config = PRESET_FONTS.find(f => f.id === font);
  if (config) return config.value;
  return `"${font}", -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", Roboto, sans-serif`;
}

export function getCurrentEditorFontFamily(): EditorFontFamily {
  const stored = localStorage.getItem(EDITOR_FONT_FAMILY_STORAGE_KEY);
  if (stored) return stored;
  return DEFAULT_EDITOR_FONT;
}

export function getEditorFontFamilyLabel(font: EditorFontFamily): string {
  const config = PRESET_EDITOR_FONTS.find(f => f.id === font);
  return config?.label || font;
}

export function getEditorFontFamilyValue(font: EditorFontFamily): string {
  const config = PRESET_EDITOR_FONTS.find(f => f.id === font);
  if (config) return config.value;
  return `"${font}", -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", Roboto, sans-serif`;
}

export function isBuiltinTheme(id: string): boolean {
  return BUILTIN_THEMES.some(t => t.id === id);
}

const THEME_STYLE_ID = 'texto-theme-style';

const BUILTIN_CSS_MAP: Record<string, string> = {
  'default': builtinDefaultCss,
  'pastel': builtinPastelCss,
  'spring': builtinSpringCss,
};

export function getBuiltinThemeCss(id: string): string | null {
  return BUILTIN_CSS_MAP[id] || null;
}

async function injectThemeCss(css: string): Promise<void> {
  let styleEl = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = THEME_STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}

function removeInjectedThemeCss(): void {
  const styleEl = document.getElementById(THEME_STYLE_ID);
  if (styleEl) {
    styleEl.remove();
  }
}

async function loadBaseThemeCss(id: string): Promise<string | null> {
  let css: string | null = null;

  if (isBuiltinTheme(id)) {
    css = BUILTIN_CSS_MAP[id] || null;
  } else {
    css = await loadUserThemeCss(id);
  }
  return css;
}

/**
 * 合成某主题实际生效的 CSS：主题文件本身 + JSON 快速编辑覆盖层。
 * 覆盖层追加在后面，同特异性下后声明优先，即快速编辑优先级高于 CSS 文件。
 */
export async function composeThemeCss(id: string): Promise<string | null> {
  const baseCss = await loadBaseThemeCss(id);
  if (!baseCss) return null;

  let quickCss = '';
  try {
    const quickSettings = await loadThemeQuickSettings(id);
    quickCss = quickSettings ? quickSettingsToCss(quickSettings) : '';
  } catch (e) {
    console.warn('[Theme] Failed to load theme quick settings:', e);
  }
  return quickCss ? `${baseCss}\n${quickCss}` : baseCss;
}

export async function loadAndApplyTheme(id: string): Promise<void> {
  removeInjectedThemeCss();

  const css = await composeThemeCss(id);
  if (css) {
    await injectThemeCss(css);
    // 先同步源码主题到 localStorage，再派发 codethemeschanged，
    // 保证同窗口内的监听器能读到新值而不是上一主题的旧值。
    syncSourceCodeThemeStorage(css);
    applyCodeThemeFromCss(css);
  }
}

export function getInjectedThemeCss(): string | null {
  const el = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null
  return el?.textContent ?? null
}

function getScopeVarValue(css: string, varName: string): string | null {
  // 同一变量可能同时出现在主题文件与快速编辑覆盖层中；
  // 取最后一次声明（覆盖层在末尾，等价于最终生效值）。
  const varRegex = new RegExp(`${varName}\\s*:\\s*([^;\\s]+)`, 'g')
  const matches = Array.from(css.matchAll(varRegex))
  const last = matches[matches.length - 1]
  return last ? last[1].trim() : null
}

/**
 * 从实际生效的 CSS 中解析源码模式主题并同步到 localStorage。
 * SourceCodeEditor 用这两把 key 做跨窗口同步与初始值读取。
 */
export function syncSourceCodeThemeStorage(css: string): void {
  const light = getScopeVarValue(css, '--source-code-theme-light')
  const dark = getScopeVarValue(css, '--source-code-theme-dark')
  try {
    if (light) localStorage.setItem('texto-source-code-theme-light', light)
    if (dark) localStorage.setItem('texto-source-code-theme-dark', dark)
  } catch (e) {
    // localStorage 不可用（隐私模式/配额等）时仅跳过同步，不影响主题应用
    console.warn('[Theme] Failed to sync source code theme storage:', e)
  }
}

/** 用 canvas 把任意 CSS 颜色（含 oklch）解析为 sRGB。解析失败返回 null。 */
function resolveCssColor(color: string): { r: number; g: number; b: number } | null {
  if (!color) return null;
  try {
    // 先用 CSSOM 校验颜色合法性：赋值非法颜色时属性被忽略、读回为空。
    // 不用哨兵色像素比较，避免误伤恰好等于哨兵值的合法颜色（如 #123456）。
    const probe = document.createElement('div');
    probe.style.color = color;
    if (!probe.style.color) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b };
  } catch {
    return null;
  }
}

/**
 * 把当前主题的亮/暗背景色保存到后端配置，供 Rust 建窗时设置原生窗口底色。
 * 第三方主题 Rust 无法预知背景色，只能由前端解析主题 CSS 后写入。
 */
async function captureThemeBg(): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) return;
  try {
    const css = getInjectedThemeCss();
    if (!css) return;
    const [{ parseThemeCss }, { invoke }] = await Promise.all([
      import('./theme-css-parser'),
      import('@tauri-apps/api/core'),
    ]);
    const data = parseThemeCss(css);
    const light = resolveCssColor(data.light?.['--background'] ?? '');
    let dark = resolveCssColor(data.dark?.['--background'] ?? '');
    // 主题没有暗色定义时，暗色模式下页面背景仍是亮色变量，取同一个值
    if (!dark && light) dark = light;
    if (!light && !dark) return;
    await invoke('set_theme_bg', {
      light: light ? `${light.r},${light.g},${light.b}` : '',
      dark: dark ? `${dark.r},${dark.g},${dark.b}` : '',
    });
  } catch (e) {
    console.warn('[Theme] Failed to capture native bg:', e);
  }
}

export function applyCodeThemeFromCss(css: string): void {
  // 代码块高亮主题现由 official-plugins/syntax-highlight 经
  // host.theme.applyCodeHighlightTheme 应用；此处只广播源码视图（CodeMirror）主题。
  window.dispatchEvent(new CustomEvent('codethemeschanged', {
    detail: {
      sourceCodeThemeLight: getScopeVarValue(css, '--source-code-theme-light'),
      sourceCodeThemeDark: getScopeVarValue(css, '--source-code-theme-dark'),
    }
  }))
}

export function setColorTheme(colorTheme: ColorTheme): Promise<void> {
  localStorage.setItem(COLOR_THEME_STORAGE_KEY, colorTheme);
  const promise = applyColorTheme(colorTheme);
  window.dispatchEvent(new CustomEvent('colorthemechange', { detail: colorTheme }));
  return promise;
}

export function setAppearance(appearance: Appearance): void {
  localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance);
  applyAppearance(appearance);
  window.dispatchEvent(new CustomEvent('appearancechange', { detail: appearance }));
}

export async function setFontFamily(font: FontFamily): Promise<void> {
  localStorage.setItem(FONT_FAMILY_STORAGE_KEY, font);
  await applyFontFamily(font);
  window.dispatchEvent(new CustomEvent('fontfamilychange', { detail: font }));
}

export async function setEditorFontFamily(font: EditorFontFamily): Promise<void> {
  localStorage.setItem(EDITOR_FONT_FAMILY_STORAGE_KEY, font);
  await applyEditorFontFamily(font);
  window.dispatchEvent(new CustomEvent('editorfontfamilychange', { detail: font }));
}

export async function applyFontFamily(font: FontFamily): Promise<void> {
  const root = document.documentElement;
  const fontValue = getFontFamilyValue(font);
  await importFont(font);
  await waitForFont(font);
  root.style.setProperty('--font-sans', fontValue);
  root.style.setProperty('--font-family-base', fontValue);
  if (document.body) {
    document.body.style.fontFamily = fontValue;
  }
  console.log('[Font] Applied UI font:', font, 'value:', fontValue);
}

export async function applyEditorFontFamily(font: EditorFontFamily): Promise<void> {
  const root = document.documentElement;
  const fontValue = getEditorFontFamilyValue(font);
  if (font !== 'system' && font !== 'mono') {
    await importFont(font as FontFamily);
    await waitForFont(font as FontFamily);
  }
  root.style.setProperty('--editor-font-family-base', fontValue);
  updateEditorFont(fontValue);
  console.log('[Font] Applied editor font:', font, 'value:', fontValue);
}

function updateEditorFont(fontValue: string): void {
  const root = document.documentElement;
  root.style.setProperty('--editor-font-family-base', fontValue);
}

function updateIBeamCursor(): void {
  if (!document.documentElement.classList.contains('win32')) return;
  const fg = getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim();
  if (!fg) return;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='6' height='18' viewBox='0 0 6 18'><path d='M3 0.5 L3 17.5' stroke='${fg}' stroke-width='1.2'/><path d='M0.5 0.5 L5.5 0.5' stroke='${fg}' stroke-width='1.2' stroke-linecap='square'/><path d='M0.5 17.5 L5.5 17.5' stroke='${fg}' stroke-width='1.2' stroke-linecap='square'/></svg>`;
  document.documentElement.style.setProperty('--cursor-ibeam', `url("data:image/svg+xml,${encodeURIComponent(svg)}") 3 9, text`);
}

export function applyColorTheme(colorTheme: ColorTheme): Promise<void> {
  const root = document.documentElement;
  root.removeAttribute('data-theme');

  if (colorTheme !== DEFAULT_COLOR_THEME.id) {
    root.setAttribute('data-theme', colorTheme);
  }

  const promise = loadAndApplyTheme(colorTheme);
  // 清掉 index.html 浏览器环境的临时内联背景，交回给主题 CSS 管理
  root.style.backgroundColor = '';
  root.style.colorScheme = '';
  promise
    .then(() => captureThemeBg())
    .catch(() => {});
  updateIBeamCursor();
  return promise;
}

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  root.classList.remove('dark');

  if (appearance === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      root.classList.add('dark');
    }
  } else if (appearance === 'dark') {
    root.classList.add('dark');
  }
  updateIBeamCursor();
}

export function toggleAppearance(): Appearance {
  const current = getCurrentAppearance();
  const appearances: Appearance[] = ['light', 'dark', 'system'];
  const currentIndex = appearances.indexOf(current);
  const nextIndex = (currentIndex + 1) % appearances.length;
  const nextAppearance = appearances[nextIndex];
  setAppearance(nextAppearance);
  return nextAppearance;
}

export function getAppearanceLabel(appearance: Appearance): string {
  const labels: Record<Appearance, string> = {
    light: '浅色',
    dark: '深色',
    system: '跟随系统'
  };
  return labels[appearance];
}

/** @deprecated Use ColorTheme and Appearance instead */
export type Theme = 'light' | 'dark' | 'pastel' | 'system';

/** @deprecated Use getCurrentColorTheme and getCurrentAppearance instead */
export function getCurrentTheme(): Theme {
  const appearance = getCurrentAppearance();
  const colorTheme = getCurrentColorTheme();
  if (colorTheme === 'pastel') return 'pastel';
  return appearance;
}

/** @deprecated Use setColorTheme and setAppearance instead */
export function setTheme(theme: Theme): void {
  if (theme === 'pastel') {
    setColorTheme('pastel');
    setAppearance('light');
  } else {
    setColorTheme('default');
    setAppearance(theme as Appearance);
  }
}

/** @deprecated Use applyColorTheme and applyAppearance instead */
export function applyTheme(theme: Theme): void {
  if (theme === 'pastel') {
    applyColorTheme('pastel');
    applyAppearance('light');
  } else {
    applyColorTheme('default');
    applyAppearance(theme as Appearance);
  }
}

/** @deprecated Use toggleAppearance instead */
export function toggleTheme(): Theme {
  const appearance = toggleAppearance();
  return appearance as Theme;
}

/** @deprecated Use getAppearanceLabel instead */
export function getThemeLabel(theme: Theme): string {
  const labels: Record<Theme, string> = {
    light: '浅色',
    dark: '深色',
    pastel: '粉彩',
    system: '跟随系统'
  };
  return labels[theme];
}
