import { describe, expect, it } from 'vitest';

import { locales } from './locales';

const LANGS = [
  'zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE', 'es-ES',
  'pt-PT', 'it-IT', 'ru-RU', 'ar-SA', 'hi-IN', 'th-TH', 'vi-VN',
] as const;

const KEYS = [
  'pluginName', 'pluginDescription', 'translate', 'promptTask',
  'sectionTitle', 'translateTarget', 'translateTargetDesc', 'followUiLanguage',
  'modelProfile', 'modelProfileDesc',
] as const;

describe('ai-translate locales', () => {
  it('covers exactly the supported languages', () => {
    expect(Object.keys(locales).sort()).toEqual([...LANGS].sort());
  });

  it('every locale has every key and language placeholder', () => {
    for (const lang of LANGS) {
      const messages = locales[lang];
      expect(messages, lang).toBeTruthy();
      for (const key of KEYS) expect(typeof messages[key], `${lang}.${key}`).toBe('string');
      expect(messages.promptTask, `${lang}.promptTask placeholder`).toContain('{{language}}');
    }
  });
});
