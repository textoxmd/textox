import type { SettingsSection } from '@texto/app-api';

export const AUTO_TRANSLATE_TARGET = 'auto';
export const DEFAULT_TRANSLATE_TARGET = AUTO_TRANSLATE_TARGET;

/** 目标语言：值为 locale code，标签用该语言自己的名称（不随界面语言变化）。 */
export const TRANSLATE_TARGETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'fr-FR', label: 'français' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'es-ES', label: 'español' },
  { value: 'pt-PT', label: 'português' },
  { value: 'it-IT', label: 'italiano' },
  { value: 'ru-RU', label: 'русский' },
  { value: 'ar-SA', label: 'العربية' },
  { value: 'hi-IN', label: 'हिन्दी' },
  { value: 'th-TH', label: 'ไทย' },
  { value: 'vi-VN', label: 'tiếng Việt' },
];

const FALLBACK_TARGET = TRANSLATE_TARGETS.find((t) => t.value === 'en-US')!;

/** 目标语言提示名；未知值回退 English。 */
export function targetLanguageName(value: string | null | undefined): string {
  return TRANSLATE_TARGETS.find((t) => t.value === value)?.label ?? FALLBACK_TARGET.label;
}

/** 设置项首项：跟随界面语言。 */
export const FOLLOW_UI_LANGUAGE_OPTION = {
  value: AUTO_TRANSLATE_TARGET,
  labelKey: 'ai-translate.followUiLanguage',
} as const;

/** `auto`（或未配置）时跟随界面语言，显式选择时以选择为准。 */
export function resolveTranslateTarget(
  value: string | null | undefined,
  uiLanguage: string,
): string {
  if (!value || value === AUTO_TRANSLATE_TARGET) return uiLanguage;
  return value;
}

export function createSettingsSection(): SettingsSection {
  return {
    id: 'ai-translate.settings',
    titleKey: 'ai-translate.sectionTitle',
    fields: [
      {
        type: 'modelProfile',
        key: 'modelProfile',
        labelKey: 'ai-translate.modelProfile',
        descriptionKey: 'ai-translate.modelProfileDesc',
        default: '',
      },
      {
        type: 'select',
        key: 'translateTarget',
        labelKey: 'ai-translate.translateTarget',
        descriptionKey: 'ai-translate.translateTargetDesc',
        default: DEFAULT_TRANSLATE_TARGET,
        options: [
          FOLLOW_UI_LANGUAGE_OPTION,
          ...TRANSLATE_TARGETS.map(({ value, label }) => ({ value, label })),
        ],
      },
    ],
  };
}
