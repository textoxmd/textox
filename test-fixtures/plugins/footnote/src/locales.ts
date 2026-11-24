import type { PluginLocale } from '@texto/plugin-sdk';

export const defaultLocale = 'en-US';

export const locales: Record<string, PluginLocale> = {
  'en-US': {
    pluginName: 'Footnote',
    pluginDescription: 'Insert footnotes with references and definitions',
    footnoteDesc: 'Insert footnote',
  },
  'zh-CN': {
    pluginName: '脚注',
    pluginDescription: '插入带引用与定义的脚注',
    footnoteDesc: '插入脚注',
  },
  'zh-TW': {
    pluginName: '註腳',
    pluginDescription: '插入帶引用與定義的腳註',
    footnoteDesc: '插入註腳',
  },
  'ja-JP': {
    pluginName: '脚注',
    pluginDescription: '参照と定義付きの脚注を挿入',
    footnoteDesc: '脚注を挿入',
  },
  'ko-KR': {
    pluginName: '각주',
    pluginDescription: '참조와 정의가 있는 각주 삽입',
    footnoteDesc: '각주 삽입',
  },
  'fr-FR': {
    pluginName: 'Note de bas de page',
    pluginDescription: 'Insérer des notes de bas de page avec références et définitions',
    footnoteDesc: 'Insérer une note de bas de page',
  },
  'de-DE': {
    pluginName: 'Fußnote',
    pluginDescription: 'Fußnoten mit Verweisen und Definitionen einfügen',
    footnoteDesc: 'Fußnote einfügen',
  },
  'es-ES': {
    pluginName: 'Nota al pie',
    pluginDescription: 'Insertar notas al pie con referencias y definiciones',
    footnoteDesc: 'Insertar nota al pie',
  },
  'it-IT': {
    pluginName: 'Nota a piè di pagina',
    pluginDescription: 'Inserisci note a piè di pagina con riferimenti e definizioni',
    footnoteDesc: 'Inserisci nota a piè di pagina',
  },
  'pt-PT': {
    pluginName: 'Nota de rodapé',
    pluginDescription: 'Inserir notas de rodapé com referências e definições',
    footnoteDesc: 'Inserir nota de rodapé',
  },
  'ru-RU': {
    pluginName: 'Сноска',
    pluginDescription: 'Вставка сносок со ссылками и определениями',
    footnoteDesc: 'Вставить сноску',
  },
  'ar-SA': {
    pluginName: 'حاشية',
    pluginDescription: 'إدراج الحواشي مع المراجع والتعريفات',
    footnoteDesc: 'إدراج هامش',
  },
  'hi-IN': {
    pluginName: 'फुटनोट',
    pluginDescription: 'संदर्भों और परिभाषाओं के साथ फ़ुटनोट डालें',
    footnoteDesc: 'फुटनोट सम्मिलित करें',
  },
  'th-TH': {
    pluginName: 'อ้างอิง',
    pluginDescription: 'แทรกเชิงอรรถพร้อมการอ้างอิงและคำนิยาม',
    footnoteDesc: 'แทรกอ้างอิงท้ายเรื่อง',
  },
  'vi-VN': {
    pluginName: 'Chú thích',
    pluginDescription: 'Chèn chú thích với tham chiếu và định nghĩa',
    footnoteDesc: 'Chèn chú thích cuối trang',
  },
};
