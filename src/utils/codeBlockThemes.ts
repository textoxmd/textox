import { CODE_HIGHLIGHT_THEMES } from '@texto/markdown-editor-api';
import type { CodeHighlightTheme } from '@texto/markdown-editor-api';
import { getAllLanguageOptions } from '@/utils/codeLanguageMeta';

export interface CodeBlockPluginState {
  theme: string;
}

export type CodeBlockTheme = CodeHighlightTheme;

/**
 * 代码块主题列表（单一真源：契约目录 `CODE_HIGHLIGHT_THEMES`）
 * 注意：现在主题通过 CSS 类名管理，不再需要导入 CodeMirror 主题扩展
 */
export const CODE_BLOCK_THEMES: CodeBlockTheme[] = [...CODE_HIGHLIGHT_THEMES];

export function isDarkTheme(themeValue: string): boolean {
  const theme = CODE_BLOCK_THEMES.find(t => t.value === themeValue);
  return theme?.isDark ?? true;
}

export function getDefaultTheme(): string {
  return 'oneDark';
}

/**
 * 亮色主题列表
 */
export const LIGHT_THEMES: CodeBlockTheme[] = CODE_BLOCK_THEMES.filter(t => !t.isDark);

/**
 * 暗色主题列表
 */
export const DARK_THEMES: CodeBlockTheme[] = CODE_BLOCK_THEMES.filter(t => t.isDark);

/**
 * 根据应用外观模式获取对应的默认主题
 * @param isDarkMode 是否为暗色模式
 * @returns 主题值字符串
 */
export function getDefaultThemeByAppearance(isDarkMode: boolean): string {
  return isDarkMode ? 'vscodeDark' : 'githubLight';
}

/**
 * 获取指定外观模式下的主题列表
 * @param isDarkMode 是否为暗色模式
 * @returns 主题列表
 */
export function getThemesByAppearance(isDarkMode: boolean): CodeBlockTheme[] {
  return isDarkMode ? DARK_THEMES : LIGHT_THEMES;
}

/**
 * 获取主题对应的 CSS 类名
 * @param themeValue 主题值
 * @returns CSS 类名
 */
export function getThemeClassName(themeValue: string): string {
  return `code-theme-${themeValue}`;
}

/**
 * @deprecated 现在样式通过 CSS 变量管理，不再需要此方法
 */
export function getLanguageSelectStyles(_themeValue: string): { background: string; color: string; border: string } {
  // 返回空值，样式现在通过 CSS 变量控制
  return {
    background: '',
    color: '',
    border: '',
  };
}

/**
 * 支持的语言列表
 * 从共享模块获取，避免重复定义
 */
export const SUPPORTED_LANGUAGES = getAllLanguageOptions();

export const MERMAID_DIAGRAM_TYPES = [
  'graph',
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'mindmap',
  'timeline',
  'requirementDiagram',
  'gitgraph',
  'C4Context',
  'quadrantChart',
  'xychart',
  'block-beta',
  'sankey',
  'packet-beta',
  'kanban',
];
