import type { PluginLocale } from '@texto/plugin-sdk';

export const defaultLocale = 'en-US';

export const locales: Record<string, PluginLocale> = {
  'en-US': {
    pluginName: 'Text Highlight',
    pluginDescription: 'Wrap text in == to add a highlight background',
    setting: {
      color: 'Highlight color',
      colorDesc: 'Background color for highlighted text',
    },
    label: 'Highlight',
  },
  'zh-CN': {
    pluginName: '文本高亮',
    pluginDescription: '用 == 括选文本添加高亮背景',
    setting: {
      color: '高亮颜色',
      colorDesc: '选中文本的高亮背景颜色',
    },
    label: '高亮',
  },
  'zh-TW': {
    pluginName: '文字高亮',
    pluginDescription: '用 == 括選文字加上高亮背景',
    setting: {
      color: '高亮顏色',
      colorDesc: '選取文字的高亮背景顏色',
    },
    label: '高亮',
  },
  'ja-JP': {
    pluginName: 'テキストハイライト',
    pluginDescription: 'テキストを == で囲むとハイライト背景を追加します',
    setting: {
      color: 'ハイライト色',
      colorDesc: 'ハイライトするテキストの背景色',
    },
    label: 'ハイライト',
  },
  'ko-KR': {
    pluginName: '텍스트 강조',
    pluginDescription: '텍스트를 ==로 감싸 하이라이트 배경을 추가합니다',
    setting: {
      color: '강조 표시 색상',
      colorDesc: '강조 표시할 텍스트의 배경 색상',
    },
    label: '강조 표시',
  },
  'fr-FR': {
    pluginName: 'Surlignage de texte',
    pluginDescription: 'Entourez le texte de == pour ajouter un fond surligné',
    setting: {
      color: 'Couleur de surlignage',
      colorDesc: "Couleur d'arrière-plan du texte surligné",
    },
    label: 'Surligner',
  },
  'de-DE': {
    pluginName: 'Texthervorhebung',
    pluginDescription:
      'Text mit == umschließen, um einen hervorgehobenen Hintergrund hinzuzufügen',
    setting: {
      color: 'Hervorhebungsfarbe',
      colorDesc: 'Hintergrundfarbe für hervorgehobenen Text',
    },
    label: 'Hervorheben',
  },
  'es-ES': {
    pluginName: 'Resaltado de texto',
    pluginDescription: 'Rodea el texto con == para añadir un fondo resaltado',
    setting: {
      color: 'Color de resaltado',
      colorDesc: 'Color de fondo del texto resaltado',
    },
    label: 'Resaltar',
  },
  'it-IT': {
    pluginName: 'Evidenziazione del testo',
    pluginDescription: 'Racchiudi il testo tra == per aggiungere uno sfondo evidenziato',
    setting: {
      color: 'Colore evidenziazione',
      colorDesc: 'Colore di sfondo del testo evidenziato',
    },
    label: 'Evidenzia',
  },
  'pt-PT': {
    pluginName: 'Realce de texto',
    pluginDescription: 'Cerque o texto com == para adicionar um fundo realçado',
    setting: {
      color: 'Cor de realce',
      colorDesc: 'Cor de fundo do texto realçado',
    },
    label: 'Destacar',
  },
  'ru-RU': {
    pluginName: 'Выделение текста',
    pluginDescription: 'Заключите текст в ==, чтобы добавить подсветку',
    setting: {
      color: 'Цвет подсветки',
      colorDesc: 'Цвет фона выделенного текста',
    },
    label: 'Выделить',
  },
  'ar-SA': {
    pluginName: 'تمييز النص',
    pluginDescription: 'ضع النص بين == لإضافة خلفية تمييز',
    setting: {
      color: 'لون التمييز',
      colorDesc: 'لون خلفية النص المميز',
    },
    label: 'تمييز',
  },
  'hi-IN': {
    pluginName: 'टेक्स्ट हाइलाइट',
    pluginDescription: 'हाइलाइट पृष्ठभूमि जोड़ने के लिए टेक्स्ट को == में लपेटें',
    setting: {
      color: 'हाइलाइट रंग',
      colorDesc: 'हाइलाइट किए गए पाठ का पृष्ठभूमि रंग',
    },
    label: 'हाइलाइट',
  },
  'th-TH': {
    pluginName: 'ไฮไลต์ข้อความ',
    pluginDescription: 'ครอบข้อความด้วย == เพื่อเพิ่มพื้นหลังไฮไลต์',
    setting: {
      color: 'สีไฮไลต์',
      colorDesc: 'สีพื้นหลังของข้อความที่ไฮไลต์',
    },
    label: 'ไฮไลต์',
  },
  'vi-VN': {
    pluginName: 'Đánh dấu văn bản',
    pluginDescription: 'Bao văn bản trong == để thêm nền đánh dấu',
    setting: {
      color: 'Màu đánh dấu',
      colorDesc: 'Màu nền cho văn bản được đánh dấu',
    },
    label: 'Đánh dấu',
  },
};
