import type { PluginLocale } from '@texto/plugin-sdk';

export const defaultLocale = 'en-US';

export const locales: Record<string, PluginLocale> = {
  'en-US': {
    pluginName: 'Alerts',
    pluginDescription: 'GitHub-style callout boxes using blockquote syntax like > [!NOTE]',
  },
  'zh-CN': {
    pluginName: '提醒框',
    pluginDescription: 'GitHub 风格的提示框，使用引用语法，如 > [!NOTE]',
  },
  'zh-TW': {
    pluginName: '提醒框',
    pluginDescription: 'GitHub 風格的提示框，使用引用語法，如 > [!NOTE]',
  },
  'ja-JP': {
    pluginName: 'アラート',
    pluginDescription: 'blockquote構文の拡張、NOTE, TIP, IMPORTANT, WARNING, CAUTIONの5種類をサポート',
  },
  'ko-KR': {
    pluginName: '알림',
    pluginDescription: 'blockquote 구문 확장, NOTE, TIP, IMPORTANT, WARNING, CAUTION 5종 지원',
  },
  'fr-FR': {
    pluginName: 'Alertse',
    pluginDescription: 'Extension de la syntaxe blockquote prenant en charge NOTE, TIP, IMPORTANT, WARNING, CAUTION',
  },
  'de-DE': {
    pluginName: 'Hinweis',
    pluginDescription: 'Blockquote-Syntax-Erweiterung mit Unterstützung für NOTE, TIP, IMPORTANT, WARNING, CAUTION',
  },
  'es-ES': {
    pluginName: 'Alertsa',
    pluginDescription: 'Extensión de sintaxis blockquote compatible con NOTE, TIP, IMPORTANT, WARNING, CAUTION',
  },
  'it-IT': {
    pluginName: 'Avviso',
    pluginDescription: 'Estensione della sintassi blockquote che supporta NOTE, TIP, IMPORTANT, WARNING, CAUTION',
  },
  'pt-PT': {
    pluginName: 'Alertsa',
    pluginDescription: 'Extensão de sintaxe blockquote com suporte para NOTE, TIP, IMPORTANT, WARNING, CAUTION',
  },
  'ru-RU': {
    pluginName: 'Уведомление',
    pluginDescription: 'Расширение синтаксиса blockquote с поддержкой NOTE, TIP, IMPORTANT, WARNING, CAUTION',
  },
  'ar-SA': {
    pluginName: 'تنبيه',
    pluginDescription: 'امتداد بناء جملة blockquote يدعم NOTE, TIP, IMPORTANT, WARNING, CAUTION',
  },
  'hi-IN': {
    pluginName: 'अलर्ट',
    pluginDescription: 'blockquote सिंटैक्स एक्सटेंशन जो NOTE, TIP, IMPORTANT, WARNING, CAUTION का समर्थन करता है',
  },
  'th-TH': {
    pluginName: 'การแจ้งเตือน',
    pluginDescription: 'ส่วนขยายไวยากรณ์ blockquote ที่รองรับ NOTE, TIP, IMPORTANT, WARNING, CAUTION',
  },
  'vi-VN': {
    pluginName: 'Cảnh báo',
    pluginDescription: 'Mở rộng cú pháp blockquote hỗ trợ NOTE, TIP, IMPORTANT, WARNING, CAUTION',
  },
};
