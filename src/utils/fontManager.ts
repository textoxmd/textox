/**
 * 字体管理工具
 * 提供系统字体获取和管理功能
 */

import { invoke } from '@tauri-apps/api/core';

// 系统字体信息接口
export interface SystemFontInfo {
  family: string;
  name: string;
  postscript_name: string;
}

// 缓存的系统字体列表
let cachedSystemFonts: SystemFontInfo[] | null = null;

/**
 * 获取系统字体列表
 * 使用 Tauri 命令调用 Rust 后端获取 macOS 系统字体
 */
export async function getSystemFonts(): Promise<SystemFontInfo[]> {
  if (cachedSystemFonts) {
    return cachedSystemFonts;
  }

  try {
    const fonts = await invoke<SystemFontInfo[]>('get_system_fonts_command');
    cachedSystemFonts = fonts;
    return fonts;
  } catch (error) {
    console.error('Failed to get system fonts:', error);
    return [];
  }
}

/**
 * 清除字体缓存
 * 在需要重新加载字体列表时调用
 */
export function clearFontCache(): void {
  cachedSystemFonts = null;
}

/**
 * 根据字体族名称获取字体信息
 */
export function getFontByFamily(family: string, fonts: SystemFontInfo[]): SystemFontInfo | undefined {
  return fonts.find(f => f.family === family);
}

/**
 * 获取字体 CSS 值
 * 用于应用到 CSS font-family 属性
 */
export function getFontCSSValue(family: string): string {
  return `"${family}", -apple-system, BlinkMacSystemFont, sans-serif`;
}
