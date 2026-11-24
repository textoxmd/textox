import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { invoke } from '@tauri-apps/api/core';
import { readAppConfig } from '@/utils/appConfig';
import { isTauriRuntime } from '@/utils/platform';
import { listen } from '@tauri-apps/api/event';
import { APP_LANGUAGES, injectPluginMessages } from './plugin-messages';
import type { PluginLocale } from '@texto/plugin-sdk';

export { APP_LANGUAGES };

const RTL_LANGUAGES = ['ar-SA'];

function unwrapLocale(data: any): any {
  return data?.translations ?? data;
}

type CustomTranslationFile = {
  version: number;
  lang: string;
  name: string;
  translations: Record<string, Record<string, string>>;
};

// changeLanguage 的原始实现
let origChangeLanguage: typeof i18n.changeLanguage;

// 只加载内置翻译（替换整个 bundle）
function loadBuiltin(lng: string) {
  return import(`./locales/${lng}.json`).then((data) => {
    i18n.addResourceBundle(lng, 'translation', unwrapLocale(data), false, true);
  }).catch(() => {});
}

// fallbackLng 只有在对应语言的资源已装入时才会生效；否则 i18next 直接回显 key。
// 因此每次加载某语言时，都把 zh-CN 兜底资源一并装入。
const FALLBACK_LNG = 'zh-CN';

async function loadBuiltinWithFallback(lng: string): Promise<void> {
  await loadBuiltin(FALLBACK_LNG);
  if (lng !== FALLBACK_LNG) await loadBuiltin(lng);
}

// 加载自定义翻译（叠加到内置之上）
export async function applyCustomTranslation(lng: string) {
  await loadBuiltinWithFallback(lng);
  try {
    const data = await invoke('read_custom_translation', { lang: lng }) as CustomTranslationFile;
    i18n.addResourceBundle(lng, 'translation', data.translations, true, true);
  } catch {}
  await origChangeLanguage(lng);
}

const initPromise = i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    ns: ['translation', 'plugins'],
    defaultNS: 'translation',
    fallbackNS: 'plugins',
    resources: {},
    fallbackLng: 'zh-CN',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

/** i18n 初始化完成；注入插件资源前必须 await。 */
export const i18nReady: Promise<void> = initPromise.then(() => undefined);

/** 注册一个插件自带的语言资源到 `plugins` 命名空间（等 i18n 就绪后写入）。 */
export function registerPluginMessages(
  pluginId: string,
  locales: Record<string, PluginLocale>,
  defaultLocale?: string,
): Promise<void> {
  return i18nReady.then(() => {
    // 插件 id 若与骨架 translation 命名空间顶层键同名，会 shadow 插件资源。
    if (import.meta.env.DEV && i18n.exists(pluginId, { ns: 'translation' })) {
      console.warn(
        `[plugins] 插件 id "${pluginId}" 与骨架 translation 命名空间顶层键同名，插件文案可能被骨架覆盖`,
      );
    }
    injectPluginMessages(i18n, pluginId, locales, defaultLocale);
  });
}

// init 完成后设置 origChangeLanguage 并劫持
initPromise.then(async () => {
  origChangeLanguage = i18n.changeLanguage.bind(i18n);

  // 劫持：changeLanguage 永远只加载内置翻译
  i18n.changeLanguage = ((lng: any, callback?: any) => {
    if (!lng) return origChangeLanguage(lng, callback);
    return loadBuiltinWithFallback(lng).then(() => origChangeLanguage(lng, callback));
  }) as typeof i18n.changeLanguage;

  // 启动时加载当前语言
  const current = i18n.language;
  if (!current) return;

  // 检查是否有自定义翻译配置
  try {
    const config = await readAppConfig<any>();
    if (config.custom_lang_hash) {
      await applyCustomTranslation(current);
      return;
    }
  } catch {}
  // 没有自定义配置，只加载内置
  await loadBuiltinWithFallback(current);
  await origChangeLanguage(current);
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  document.documentElement.dir = RTL_LANGUAGES.includes(lng) ? 'rtl' : 'ltr';
});

// 导入事件（仅 Tauri 容器内可用；浏览器/单测环境没有 __TAURI_INTERNALS__）
if (isTauriRuntime()) {
  listen<string>('custom-translation-imported', (event) => {
    applyCustomTranslation(event.payload);
  }).catch((error) => {
    console.warn('Failed to listen for translation import', error);
  });
}

export function isRTLLanguage(lng: string): boolean {
  return RTL_LANGUAGES.includes(lng);
}

export function getTextDirection(): 'rtl' | 'ltr' {
  return isRTLLanguage(i18n.language) ? 'rtl' : 'ltr';
}

export function applyTextDirection(lng?: string): void {
  document.documentElement.lang = lng || i18n.language;
}

applyTextDirection();

export default i18n;
