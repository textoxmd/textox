import type { PluginLocale } from '@texto/plugin-sdk';

export const defaultLocale = 'en-US';

export const locales: Record<string, PluginLocale> = {
  'en-US': {
    pluginName: 'Emoji',
    pluginDescription: 'Insert emoji shortcodes like :smile:',
  },
  'zh-CN': {
    pluginName: '表情符号',
    pluginDescription: '输入 :smile: 等表情短代码',
  },
  'zh-TW': {
    pluginName: '表情符號',
    pluginDescription: '輸入 :smile: 等表情短代碼',
  },
  'ja-JP': {
    pluginName: '絵文字',
    pluginDescription: ':smile: などの絵文字ショートコードを入力',
  },
  'ko-KR': {
    pluginName: '이모지',
    pluginDescription: ':smile: 같은 이모지 단축 코드를 입력합니다',
  },
  'fr-FR': {
    pluginName: 'Émoji',
    pluginDescription: 'Insérer des codes emoji comme :smile:',
  },
  'de-DE': {
    pluginName: 'Emoji',
    pluginDescription: 'Emoji-Kurzwörter wie :smile: einfügen',
  },
  'es-ES': {
    pluginName: 'Emoji',
    pluginDescription: 'Insertar códigos emoji como :smile:',
  },
  'it-IT': {
    pluginName: 'Emoji',
    pluginDescription: 'Inserisci codici emoji come :smile:',
  },
  'pt-PT': {
    pluginName: 'Emoji',
    pluginDescription: 'Inserir códigos de emoji como :smile:',
  },
  'ru-RU': {
    pluginName: 'Эмодзи',
    pluginDescription: 'Вставлять короткие коды эмодзи, например :smile:',
  },
  'ar-SA': {
    pluginName: 'الرموز التعبيرية',
    pluginDescription: 'إدراج رموز تعبيرية مثل :smile:',
  },
  'hi-IN': {
    pluginName: 'इमोजी',
    pluginDescription: ':smile: जैसे इमोजी शॉर्टकोड डालें',
  },
  'th-TH': {
    pluginName: 'อีโมจิ',
    pluginDescription: 'แทรกโค้ดอีโมจิเช่น :smile:',
  },
  'vi-VN': {
    pluginName: 'Biểu cảm',
    pluginDescription: 'Chèn mã biểu cảm như :smile:',
  },
};
