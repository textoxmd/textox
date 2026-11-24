import type { PluginLocale } from '@texto/plugin-sdk';

export const defaultLocale = 'en-US';

export const locales: Record<string, PluginLocale> = {
  'en-US': {
    pluginName: 'Underline',
    pluginDescription: 'Add underline to the selected text',
  },
  'zh-CN': {
    pluginName: '下划线',
    pluginDescription: '为选中文本添加下划线',
  },
  'zh-TW': {
    pluginName: '底線',
    pluginDescription: '為選取文字加上底線',
  },
  'ja-JP': {
    pluginName: '下線',
    pluginDescription: '選択したテキストに下線を追加します',
  },
  'ko-KR': {
    pluginName: '밑줄',
    pluginDescription: '선택한 텍스트에 밑줄을 추가합니다',
  },
  'fr-FR': {
    pluginName: 'Souligné',
    pluginDescription: 'Ajouter un soulignement au texte sélectionné',
  },
  'de-DE': {
    pluginName: 'Unterstrichen',
    pluginDescription: 'Ausgewählten Text unterstreichen',
  },
  'es-ES': {
    pluginName: 'Subrayado',
    pluginDescription: 'Añadir subrayado al texto seleccionado',
  },
  'it-IT': {
    pluginName: 'Sottolineato',
    pluginDescription: 'Aggiungi la sottolineatura al testo selezionato',
  },
  'pt-PT': {
    pluginName: 'Sublinhado',
    pluginDescription: 'Adicionar sublinhado ao texto selecionado',
  },
  'ru-RU': {
    pluginName: 'Подчёркнутый',
    pluginDescription: 'Добавить подчёркивание к выделенному тексту',
  },
  'ar-SA': {
    pluginName: 'تسطير',
    pluginDescription: 'إضافة تسطير إلى النص المحدد',
  },
  'hi-IN': {
    pluginName: 'रेखांकित',
    pluginDescription: 'चयनित टेक्स्ट में रेखांकन जोड़ें',
  },
  'th-TH': {
    pluginName: 'ขีดเส้นใต้',
    pluginDescription: 'เพิ่มขีดเส้นใต้ให้ข้อความที่เลือก',
  },
  'vi-VN': {
    pluginName: 'Gạch chân',
    pluginDescription: 'Thêm gạch chân cho văn bản đã chọn',
  },
};
