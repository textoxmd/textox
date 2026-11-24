import type { PluginLocale } from '@texto/plugin-sdk';

export const defaultLocale = 'en-US';

export const locales: Record<string, PluginLocale> = {
  'en-US': {
    pluginName: 'Heading Badge',
    pluginDescription: 'Show the heading level (H1–H6) next to the active heading',
  },
  'zh-CN': {
    pluginName: '标题角标',
    pluginDescription: '在光标所在标题旁显示标题级别（H1–H6）',
  },
  'zh-TW': {
    pluginName: '標題角標',
    pluginDescription: '在游標所在標題旁顯示標題層級（H1–H6）',
  },
  'ja-JP': {
    pluginName: '見出しバッジ',
    pluginDescription: 'カーソル位置の見出しのレベル（H1〜H6）を表示します',
  },
  'ko-KR': {
    pluginName: '제목 배지',
    pluginDescription: '커서가 위치한 제목 옆에 제목 수준(H1–H6)을 표시합니다',
  },
  'fr-FR': {
    pluginName: 'Badge de titre',
    pluginDescription: 'Afficher le niveau du titre (H1–H6) à côté du titre actif',
  },
  'de-DE': {
    pluginName: 'Überschriften-Badge',
    pluginDescription: 'Überschriftenebene (H1–H6) neben der aktiven Überschrift anzeigen',
  },
  'es-ES': {
    pluginName: 'Insignia de encabezado',
    pluginDescription: 'Mostrar el nivel del encabezado (H1–H6) junto al encabezado activo',
  },
  'it-IT': {
    pluginName: 'Badge del titolo',
    pluginDescription: 'Mostra il livello del titolo (H1–H6) accanto al titolo attivo',
  },
  'pt-PT': {
    pluginName: 'Emblema de título',
    pluginDescription: 'Mostrar o nível do título (H1–H6) ao lado do título ativo',
  },
  'ru-RU': {
    pluginName: 'Значок заголовка',
    pluginDescription: 'Показывать уровень заголовка (H1–H6) рядом с активным заголовком',
  },
  'ar-SA': {
    pluginName: 'شارة العنوان',
    pluginDescription: 'إظهار مستوى العنوان (H1–H6) بجانب العنوان النشط',
  },
  'hi-IN': {
    pluginName: 'शीर्षक बैज',
    pluginDescription: 'सक्रिय शीर्षक के पास शीर्षक स्तर (H1–H6) दिखाएँ',
  },
  'th-TH': {
    pluginName: 'ป้ายหัวเรื่อง',
    pluginDescription: 'แสดงระดับหัวข้อ (H1–H6) ข้างหัวข้อที่ใช้งานอยู่',
  },
  'vi-VN': {
    pluginName: 'Huy hiệu tiêu đề',
    pluginDescription: 'Hiển thị cấp độ tiêu đề (H1–H6) bên cạnh tiêu đề đang hoạt động',
  },
};
