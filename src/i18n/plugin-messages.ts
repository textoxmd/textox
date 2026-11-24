import type { PluginLocale } from '@texto/plugin-sdk';

/** 插件文案注入使用的 i18next 命名空间，供骨架与插件共用，避免字面量漂移。 */
export const PLUGIN_NAMESPACE = 'plugins';

/** 应用支持的全部语言；插件缺失的语言用它 + defaultLocale 补齐。 */
export const APP_LANGUAGES = [
  'ar-SA', 'de-DE', 'en-US', 'es-ES', 'fr-FR', 'hi-IN', 'it-IT', 'ja-JP',
  'ko-KR', 'pt-PT', 'ru-RU', 'th-TH', 'vi-VN', 'zh-CN', 'zh-TW',
] as const;

/** 只依赖 i18next 实例的最小结构，便于在测试里用 createInstance() 注入。 */
interface ResourceStore {
  addResourceBundle(
    lng: string,
    ns: string,
    resources: Record<string, unknown>,
    deep?: boolean,
    overwrite?: boolean,
  ): unknown;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const DEV = import.meta.env.DEV;

/**
 * 把插件自带的语言资源注入 `plugins` 命名空间，顶层键为插件 id。
 * 对每个 APP_LANGUAGES：取 `locales[lng] ?? locales[defaultLocale]`；
 * deep-merge、不覆盖（与 `translation` 命名空间互不干扰）。
 *
 * DEV 下对可恢复的异常输入告警（不阻断）：`locales` 为空、`defaultLocale`
 * 缺失或不在 `locales` 中、某语言的 messages 非对象。
 */
export function injectPluginMessages(
  instance: ResourceStore,
  pluginId: string,
  locales: Record<string, PluginLocale>,
  defaultLocale?: string,
): void {
  const langs = Object.keys(locales);
  if (langs.length === 0) {
    if (DEV) console.warn(`[plugins] ${pluginId}: locales 为空，跳过注入`);
    return;
  }

  let base: string;
  if (defaultLocale && locales[defaultLocale]) {
    base = defaultLocale;
  } else {
    base = langs[0]!;
    if (DEV) {
      const why = defaultLocale
        ? `defaultLocale "${defaultLocale}" 不在 locales 中`
        : '未声明 defaultLocale';
      console.warn(`[plugins] ${pluginId}: ${why}，回退到 "${base}"`);
    }
  }
  const baseMessages = locales[base]!;

  for (const lng of APP_LANGUAGES) {
    const messages = locales[lng] ?? baseMessages;
    if (!messages || typeof messages !== 'object' || Array.isArray(messages)) {
      if (DEV) console.warn(`[plugins] ${pluginId}: 语言 "${lng}" 的 messages 非法，跳过`);
      continue;
    }
    instance.addResourceBundle(lng, PLUGIN_NAMESPACE, { [pluginId]: clone(messages) }, true, false);
  }
}
