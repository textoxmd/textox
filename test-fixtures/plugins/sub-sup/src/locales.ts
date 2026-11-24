import type { PluginLocale } from '@texto/plugin-sdk';

export const defaultLocale = 'en-US';

export const locales: Record<string, PluginLocale> = {
  'en-US': {
    pluginName: 'Subscript & Superscript',
    pluginDescription: 'Add subscript and superscript to the selected text',
  },
  'zh-CN': {
    pluginName: '下标与上标',
    pluginDescription: '用 ~x~ 与 ^x^ 为文本添加下标与上标',
  },
  'zh-TW': {
    pluginName: '下標與上標',
    pluginDescription: '用 ~x~ 與 ^x^ 為文字加入下標與上標',
  },
  'ja-JP': {
    pluginName: '下付き・上付き文字',
    pluginDescription: '選択したテキストに下付き文字と上付き文字を追加します',
  },
  'ko-KR': {
    pluginName: '아래 첨자 및 위 첨자',
    pluginDescription: '선택한 텍스트에 아래 첨자와 위 첨자를 추가합니다',
  },
  'fr-FR': {
    pluginName: 'Indice et exposant',
    pluginDescription: 'Ajouter un indice et un exposant au texte sélectionné',
  },
  'de-DE': {
    pluginName: 'Tief- und Hochstellung',
    pluginDescription: 'Tief- und hochgestellten Text zum ausgewählten Text hinzufügen',
  },
  'es-ES': {
    pluginName: 'Subíndice y superíndice',
    pluginDescription: 'Añadir subíndice y superíndice al texto seleccionado',
  },
  'it-IT': {
    pluginName: 'Pedice e apice',
    pluginDescription: 'Aggiungi pedice e apice al testo selezionato',
  },
  'pt-PT': {
    pluginName: 'Subscrito e sobrescrito',
    pluginDescription: 'Adicionar subscrito e sobrescrito ao texto selecionado',
  },
  'ru-RU': {
    pluginName: 'Нижний и верхний индекс',
    pluginDescription: 'Добавить нижний и верхний индекс к выделенному тексту',
  },
  'ar-SA': {
    pluginName: 'نص سفلي وعلوي',
    pluginDescription: 'إضافة نص سفلي وعلوي إلى النص المحدد',
  },
  'hi-IN': {
    pluginName: 'अधोलेख और उर्ध्वलेख',
    pluginDescription: 'चयनित पाठ में अधोलेख और उर्ध्वलेख जोड़ें',
  },
  'th-TH': {
    pluginName: 'ตัวห้อยและตัวยก',
    pluginDescription: 'เพิ่มตัวห้อยและตัวยกให้กับข้อความที่เลือก',
  },
  'vi-VN': {
    pluginName: 'Chỉ số dưới và trên',
    pluginDescription: 'Thêm chỉ số dưới và trên vào văn bản đã chọn',
  },
};
