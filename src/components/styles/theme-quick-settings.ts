import { invoke } from '@tauri-apps/api/core'

/**
 * 主题快速编辑配置（与 theme.css 解耦）。
 *
 * 所有字段均是可选的：为 null/undefined 时表示该值跟随主题 CSS，
 * 只有写入 JSON 的值会作为覆盖层，在主题 CSS 之后生效。
 */
export interface ThemeQuickSettings {
  /** 亮色模式下 --breathe-color */
  breatheLight?: string | null
  /** 暗色模式下 --breathe-color */
  breatheDark?: string | null
  /** #writer 内 --source-code-theme-light */
  sourceCodeThemeLight?: string | null
  /** #writer 内 --source-code-theme-dark */
  sourceCodeThemeDark?: string | null
}

type QuickKey = keyof ThemeQuickSettings

/** 每个配置项对应的 CSS 选择器与变量名 */
export const QUICK_SETTING_CSS_MAP: Record<QuickKey, { selector: string; variable: string }> = {
  breatheLight: { selector: ':root', variable: '--breathe-color' },
  breatheDark: { selector: '.dark', variable: '--breathe-color' },
  sourceCodeThemeLight: { selector: '#writer', variable: '--source-code-theme-light' },
  sourceCodeThemeDark: { selector: '#writer', variable: '--source-code-theme-dark' },
}

export function hasThemeQuickSettings(settings: ThemeQuickSettings | null | undefined): boolean {
  if (!settings) return false
  return (Object.keys(QUICK_SETTING_CSS_MAP) as QuickKey[]).some(
    key => settings[key] !== null && settings[key] !== undefined && settings[key] !== '',
  )
}

/**
 * 剔除 null/undefined 条目，只保留真正写过的覆盖项。
 * 旧版本 JSON 可能包含显式 null（Rust Option 序列化），
 * 这些 null 若不剔除会覆盖 UI 中从主题 CSS 读出的默认值。
 */
export function compactThemeQuickSettings(
  settings: ThemeQuickSettings | null | undefined,
): ThemeQuickSettings {
  const result: ThemeQuickSettings = {}
  if (!settings) return result
  for (const key of Object.keys(QUICK_SETTING_CSS_MAP) as QuickKey[]) {
    const value = settings[key]
    if (value !== null && value !== undefined) {
      result[key] = value
    }
  }
  return result
}

/**
 * 把 JSON 快速编辑配置转成一段覆盖 CSS。
 * 选择器按 :root / .dark / #writer 分组输出，应用时放在主题 CSS 之后即可覆盖同特异性声明。
 */
export function quickSettingsToCss(settings: ThemeQuickSettings): string {
  const groups = new Map<string, Array<{ variable: string; value: string }>>()

  for (const key of Object.keys(QUICK_SETTING_CSS_MAP) as QuickKey[]) {
    const value = settings[key]
    if (value === null || value === undefined || value === '') continue
    const { selector, variable } = QUICK_SETTING_CSS_MAP[key]
    const list = groups.get(selector) ?? []
    list.push({ variable, value })
    groups.set(selector, list)
  }

  if (groups.size === 0) return ''

  const blocks: string[] = []
  for (const selector of [':root', '.dark', '#writer']) {
    const list = groups.get(selector)
    if (!list || list.length === 0) continue
    blocks.push(
      `${selector} {\n${list.map(({ variable, value }) => `  ${variable}: ${value};`).join('\n')}\n}`,
    )
  }
  return blocks.join('\n')
}

const CACHE_TTL_MS = 1000;

type CacheEntry = { settings: ThemeQuickSettings | null; at: number };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ThemeQuickSettings | null>>();
/** 每个主题的失效代数：保存后递增，防止在飞的旧读取回写缓存。 */
const generations = new Map<string, number>();

function generationOf(themeId: string): number {
  return generations.get(themeId) ?? 0;
}

export async function loadThemeQuickSettings(themeId: string): Promise<ThemeQuickSettings | null> {
  const hit = cache.get(themeId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.settings;
  }

  const pending = inFlight.get(themeId);
  if (pending) return pending;

  const generation = generationOf(themeId);
  const request = invoke<ThemeQuickSettings | null>('get_theme_quick_settings', { themeId })
    .then((settings) => {
      const value = settings ?? null;
      // 读取期间保存过：不要把旧值写回缓存。
      if (generationOf(themeId) === generation) {
        cache.set(themeId, { settings: value, at: Date.now() });
      }
      return value;
    })
    .catch(() => null)
    .finally(() => {
      if (inFlight.get(themeId) === request) inFlight.delete(themeId);
    });

  inFlight.set(themeId, request);
  return request;
}

export async function saveThemeQuickSettings(
  themeId: string,
  settings: ThemeQuickSettings,
): Promise<void> {
  await invoke('set_theme_quick_settings', { themeId, settings });
  generations.set(themeId, generationOf(themeId) + 1);
  cache.delete(themeId);
  inFlight.delete(themeId);
}

/** 仅测试：清空缓存、in-flight 与失效代数。 */
export function resetThemeQuickSettingsCacheForTests(): void {
  cache.clear();
  inFlight.clear();
  generations.clear();
}
