import i18next, { type i18n as I18n } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import {
  APP_LANGUAGES,
  PLUGIN_NAMESPACE,
  injectPluginMessages,
} from '@/i18n/plugin-messages';

// 语言清单守卫：以磁盘上的 locale 文件名为准，避免 APP_LANGUAGES 与资源漂移。
const LOCALE_LANGUAGES = Object.keys(
  import.meta.glob('/src/i18n/locales/*.json'),
)
  .map((file) => file.slice(file.lastIndexOf('/') + 1).replace(/\.json$/, ''))
  .sort();

async function createInstance(): Promise<I18n> {
  const inst = i18next.createInstance();
  await inst.init({
    // i18next v25 leaves `language` undefined when `lng` is omitted, so keys
    // cannot resolve until `changeLanguage`. Pin a language for determinism.
    lng: 'en-US',
    ns: ['translation', PLUGIN_NAMESPACE],
    defaultNS: 'translation',
    fallbackNS: PLUGIN_NAMESPACE,
    resources: {},
    interpolation: { escapeValue: false },
  });
  return inst;
}

describe('APP_LANGUAGES', () => {
  it('lists the 15 supported app languages', () => {
    expect([...APP_LANGUAGES]).toEqual([
      'ar-SA', 'de-DE', 'en-US', 'es-ES', 'fr-FR', 'hi-IN', 'it-IT', 'ja-JP',
      'ko-KR', 'pt-PT', 'ru-RU', 'th-TH', 'vi-VN', 'zh-CN', 'zh-TW',
    ]);
  });

  it('matches the locale JSON files on disk exactly', () => {
    expect([...APP_LANGUAGES].sort()).toEqual(LOCALE_LANGUAGES);
  });
});

describe('injectPluginMessages', () => {
  it('resolves full keys through fallbackNS', async () => {
    const inst = await createInstance();
    injectPluginMessages(inst, 'picgo', { 'en-US': { serverUrl: 'Server URL' } }, 'en-US');
    expect(inst.t('picgo.serverUrl')).toBe('Server URL');
  });

  it('fills undeclared languages with the default locale', async () => {
    const inst = await createInstance();
    injectPluginMessages(inst, 'picgo', { 'en-US': { serverUrl: 'Server URL' } }, 'en-US');
    await inst.changeLanguage('zh-CN');
    expect(inst.t('picgo.serverUrl')).toBe('Server URL');
  });

  it('does not overwrite the translation namespace', async () => {
    const inst = await createInstance();
    inst.addResourceBundle('en-US', 'translation', { common: { save: 'Save' } }, true, true);
    injectPluginMessages(inst, 'picgo', { 'en-US': { serverUrl: 'Server URL' } }, 'en-US');
    expect(inst.t('common.save')).toBe('Save');
    expect(inst.t('picgo.serverUrl')).toBe('Server URL');
  });

  it('injects nested message trees via deep merge', async () => {
    const inst = await createInstance();
    injectPluginMessages(inst, 'p', { 'en-US': { setting: { color: 'C' } } }, 'en-US');
    expect(inst.t('p.setting.color')).toBe('C');
  });

  it('prefers an explicitly declared language over the default', async () => {
    const inst = await createInstance();
    injectPluginMessages(
      inst,
      'p',
      { 'en-US': { x: 'EN' }, 'zh-CN': { x: '中文' } },
      'en-US',
    );
    await inst.changeLanguage('zh-CN');
    expect(inst.t('p.x')).toBe('中文');
  });

  it('is a no-op for empty locales', async () => {
    const inst = await createInstance();
    expect(() => injectPluginMessages(inst, 'p', {}, undefined)).not.toThrow();
    expect(inst.t('p.x')).toBe('p.x');
  });
});

describe('injectPluginMessages diagnostics (DEV)', () => {
  it('warns and skips when locales is empty', async () => {
    const inst = await createInstance();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    injectPluginMessages(inst, 'p', {}, 'en-US');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('locales 为空'));
    warn.mockRestore();
  });

  it('warns and falls back to the first locale when defaultLocale is unavailable', async () => {
    const inst = await createInstance();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    injectPluginMessages(inst, 'p', { 'zh-CN': { x: '中' } }, 'en-US');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('defaultLocale'));
    warn.mockRestore();
    await inst.changeLanguage('zh-CN');
    expect(inst.t('p.x')).toBe('中');
  });

  it('warns and skips a language whose messages are not an object', async () => {
    const inst = await createInstance();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    injectPluginMessages(inst, 'p', { 'en-US': 'not-an-object' as never }, 'en-US');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('非法'));
    warn.mockRestore();
  });
});
