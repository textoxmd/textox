import { useEffect, useState } from 'react';
import { getBuiltinThemeCss } from '@/components/styles/theme';
import { BUILTIN_THEMES, loadUserThemeCss } from '@/components/styles/theme-registry';
import { parseThemeCss } from '@/components/styles/theme-css-parser';
import type { ThemeData } from '@/components/styles/theme-data';

/**
 * 主题 CSS 与解析结果缓存
 * 避免在多个卡片间重复加载和解析同一份 CSS
 */
const cssCache = new Map<string, string>();
const dataCache = new Map<string, ThemeData>();

/**
 * 加载主题原始 CSS（内置主题直接取字符串，用户主题走 Tauri 命令）
 */
async function loadThemeCss(id: string): Promise<string | null> {
  if (cssCache.has(id)) {
    return cssCache.get(id)!;
  }

  const isBuiltin = BUILTIN_THEMES.some(t => t.id === id);
  let css: string | null = null;
  if (isBuiltin) {
    css = getBuiltinThemeCss(id);
  } else {
    css = await loadUserThemeCss(id);
  }

  if (css) {
    cssCache.set(id, css);
  }
  return css;
}

/**
 * 解析并缓存主题数据
 */
function parseCached(css: string): ThemeData {
  if (dataCache.has(css)) {
    return dataCache.get(css)!;
  }
  const data = parseThemeCss(css);
  dataCache.set(css, data);
  return data;
}

/**
 * 从主题数据中提取用于预览的关键颜色
 */
export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  sidebar: string;
  primary: string;
  accent: string;
  muted: string;
  border: string;
  destructive: string;
}

function resolveColor(
  data: ThemeData,
  mode: 'light' | 'dark',
  key: keyof ThemeColors
): string {
  const value = data[mode]?.[`--${key}`];
  if (value) return value;
  const fallback = data[mode === 'dark' ? 'light' : 'dark']?.[`--${key}`];
  if (fallback) return fallback;
  return mode === 'dark' ? '#000000' : '#ffffff';
}

function extractColors(data: ThemeData, mode: 'light' | 'dark'): ThemeColors {
  return {
    background: resolveColor(data, mode, 'background'),
    foreground: resolveColor(data, mode, 'foreground'),
    card: resolveColor(data, mode, 'card'),
    sidebar: resolveColor(data, mode, 'sidebar'),
    primary: resolveColor(data, mode, 'primary'),
    accent: resolveColor(data, mode, 'accent'),
    muted: resolveColor(data, mode, 'muted'),
    border: resolveColor(data, mode, 'border'),
    destructive: resolveColor(data, mode, 'destructive'),
  };
}

export interface ThemeColorPair {
  light: ThemeColors;
  dark: ThemeColors;
}

/**
 * Hook：获取指定主题在亮/暗两种模式下的预览颜色
 */
export function useThemeColors(themeId: string): { loading: boolean; colors: ThemeColorPair | null } {
  const [loading, setLoading] = useState(true);
  const [colors, setColors] = useState<ThemeColorPair | null>(null);

  useEffect(() => {
    let cancelled = false;
    setColors(null);
    setLoading(true);

    loadThemeCss(themeId)
      .then(css => {
        if (cancelled) return;
        if (!css) {
          setColors(null);
          return;
        }
        const data = parseCached(css);
        setColors({
          light: extractColors(data, 'light'),
          dark: extractColors(data, 'dark'),
        });
      })
      .catch(err => {
        console.error('[useThemeColors] failed to load theme colors:', err);
        setColors(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [themeId]);

  return { loading, colors };
}
