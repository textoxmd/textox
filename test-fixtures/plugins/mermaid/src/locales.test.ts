import { describe, expect, it } from 'vitest';

import { defaultLocale, locales } from './locales';

const REQUIRED_KEYS = [
  'pluginName',
  'mermaidDesc',
  'copySource',
  'settingsTitle',
  'renderer',
  'rendererDesc',
  'rendererMermaid',
  'rendererPele',
] as const;

const LANGUAGES = [
  'en-US',
  'zh-CN',
  'zh-TW',
  'ja-JP',
  'ko-KR',
  'fr-FR',
  'de-DE',
  'es-ES',
  'it-IT',
  'pt-PT',
  'ru-RU',
  'ar-SA',
  'hi-IN',
  'th-TH',
  'vi-VN',
];

describe('mermaid locales', () => {
  it('默认语言为 en-US', () => {
    expect(defaultLocale).toBe('en-US');
  });

  it('恰好覆盖 app 支持的 15 种语言', () => {
    expect(Object.keys(locales).sort()).toEqual([...LANGUAGES].sort());
  });

  it('每种语言的键集合与默认语言一致', () => {
    const baseKeys = Object.keys(locales[defaultLocale]!).sort();
    for (const [language, messages] of Object.entries(locales)) {
      expect(Object.keys(messages).sort(), language).toEqual(baseKeys);
    }
  });

  it('每种语言都包含全部设置文案', () => {
    for (const [language, messages] of Object.entries(locales)) {
      for (const key of REQUIRED_KEYS) {
        const value = messages[key];
        expect(typeof value, `${language}.${key}`).toBe('string');
        expect(String(value).trim().length, `${language}.${key}`).toBeGreaterThan(0);
      }
    }
  });
});
