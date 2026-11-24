import { describe, expect, it } from 'vitest';
import type { SettingsSelectField } from '@texto/app-api';

import {
  createSettingsSection,
  DEFAULT_TRANSLATE_TARGET,
  FOLLOW_UI_LANGUAGE_OPTION,
  resolveTranslateTarget,
  TRANSLATE_TARGETS,
  targetLanguageName,
} from './settings';

describe('ai-translate settings', () => {
  it('puts the model profile first', () => {
    const section = createSettingsSection();
    expect(section.fields[0]).toMatchObject({
      type: 'modelProfile',
      key: 'modelProfile',
      labelKey: 'ai-translate.modelProfile',
      descriptionKey: 'ai-translate.modelProfileDesc',
      default: '',
    });
  });

  it('defaults to following the UI language', () => {
    const section = createSettingsSection();
    expect(section.id).toBe('ai-translate.settings');
    expect(section.titleKey).toBe('ai-translate.sectionTitle');
    expect(section.fields).toHaveLength(2);
    expect(section.fields[1]).toMatchObject({
      type: 'select',
      key: 'translateTarget',
      labelKey: 'ai-translate.translateTarget',
      descriptionKey: 'ai-translate.translateTargetDesc',
      default: DEFAULT_TRANSLATE_TARGET,
    });
    expect(DEFAULT_TRANSLATE_TARGET).toBe('auto');
  });

  it('offers follow-UI-language plus all supported target languages', () => {
    const field = createSettingsSection().fields[1] as SettingsSelectField;
    expect(field.options).toHaveLength(16);
    expect(field.options[0]).toEqual({ value: 'auto', labelKey: 'ai-translate.followUiLanguage' });
    expect(field.options[0]).toEqual(FOLLOW_UI_LANGUAGE_OPTION);
    expect(field.options.map((o) => o.value)).toContain('zh-CN');
    expect(field.options.find((o) => o.value === 'en-US')?.label).toBe('English');
    expect(field.options.find((o) => o.value === 'zh-CN')?.label).toBe('简体中文');
    const languageOptions = field.options.filter((o) => o.value !== 'auto') as Array<{
      label?: string;
    }>;
    expect(languageOptions.every((o) => typeof o.label === 'string' && o.label.length > 0)).toBe(
      true,
    );
    expect(field.options.slice(1).map((o) => o.value)).toEqual(TRANSLATE_TARGETS.map((t) => t.value));
  });

  it('resolves auto to the UI language and keeps explicit choices', () => {
    expect(resolveTranslateTarget('auto', 'zh-CN')).toBe('zh-CN');
    expect(resolveTranslateTarget(undefined, 'ja-JP')).toBe('ja-JP');
    expect(resolveTranslateTarget('en-US', 'zh-CN')).toBe('en-US');
  });

  it('resolves a label and falls back to English', () => {
    expect(targetLanguageName('ja-JP')).toBe('日本語');
    expect(targetLanguageName('zh-CN')).toBe('简体中文');
    expect(targetLanguageName(null)).toBe('English');
    expect(targetLanguageName(undefined)).toBe('English');
    expect(targetLanguageName('unknown')).toBe('English');
  });
});
