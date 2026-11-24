import type { PluginLocale } from '@texto/plugin-sdk';

export const defaultLocale = 'en-US';

export const locales: Record<string, PluginLocale> = {
  'en-US': {
    pluginName: 'Auto Pair',
    pluginDescription: 'Automatically pair brackets and parentheses while typing',
  },
  'zh-CN': {
    pluginName: '自动配对',
    pluginDescription: '输入时自动补全并配对括号',
  },
  'zh-TW': {
    pluginName: '自動配對',
    pluginDescription: '輸入時自動補全並配對括號',
  },
  'ja-JP': {
    pluginName: '自動ペア',
    pluginDescription: '入力時に括弧を自動で補完・対応付けます',
  },
  'ko-KR': {
    pluginName: '자동 괄호',
    pluginDescription: '입력할 때 괄호를 자동으로 짝지어 줍니다',
  },
  'fr-FR': {
    pluginName: 'Paires automatiques',
    pluginDescription: 'Apparier automatiquement les crochets et parenthèses',
  },
  'de-DE': {
    pluginName: 'Automatisches Paaren',
    pluginDescription: 'Klammern beim Tippen automatisch schließen',
  },
  'es-ES': {
    pluginName: 'Emparejado automático',
    pluginDescription: 'Emparejar automáticamente corchetes y paréntesis al escribir',
  },
  'it-IT': {
    pluginName: 'Accoppiamento automatico',
    pluginDescription: 'Accoppia automaticamente parentesi e quadre durante la digitazione',
  },
  'pt-PT': {
    pluginName: 'Emparelhamento automático',
    pluginDescription: 'Emparelhar automaticamente parênteses e colchetes ao digitar',
  },
  'ru-RU': {
    pluginName: 'Автопарность',
    pluginDescription: 'Автоматически закрывать скобки при вводе',
  },
  'ar-SA': {
    pluginName: 'إغلاق تلقائي',
    pluginDescription: 'إقران الأقواس تلقائيًا أثناء الكتابة',
  },
  'hi-IN': {
    pluginName: 'ऑटो पेयर',
    pluginDescription: 'टाइप करते समय कोष्ठक को स्वतः जोड़ें',
  },
  'th-TH': {
    pluginName: 'จับคู่อัตโนมัติ',
    pluginDescription: 'จับคู่วงเล็บให้อัตโนมัติขณะพิมพ์',
  },
  'vi-VN': {
    pluginName: 'Tự ghép cặp',
    pluginDescription: 'Tự động ghép cặp dấu ngoặc khi gõ',
  },
};
