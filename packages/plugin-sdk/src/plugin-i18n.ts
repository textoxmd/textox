import type { TextoPlugin } from './types';

/**
 * 收集插件清单里声明的全部 i18n key：通用深走，收集**属性名以 `Key` 结尾**的字符串值。
 * 覆盖 `displayNameKey` / `descriptionKey` / `labelKey` / `titleKey` / `placeholderKey` /
 * `messageKey` / `insertLabelKey` / `defaultFileNameKey` 等；不收集设置字段的配置键 `key`。
 * `locales` 的内容（多语言文案）不是 key，跳过。
 */
export function collectDeclaredI18nKeys(plugin: TextoPlugin): string[] {
  const out = new Set<string>();
  const seen = new WeakSet<object>();

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);

    for (const [key, child] of Object.entries(value)) {
      if (key === 'locales') continue;
      if (key.endsWith('Key') && typeof child === 'string') {
        out.add(child);
      } else if (child && typeof child === 'object') {
        walk(child);
      }
    }
  };

  walk(plugin);
  return [...out];
}
