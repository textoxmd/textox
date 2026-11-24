import type { PluginLocale } from '@texto/plugin-sdk';

export const defaultLocale = 'en-US';

export const locales: Record<string, PluginLocale> = {
  'en-US': {
    pluginName: 'Mermaid',
    mermaidDesc: 'Insert Mermaid diagram',
    copySource: 'Copy Mermaid Source',
    settingsTitle: 'Mermaid Settings',
    renderer: 'Renderer',
    rendererDesc:
      'Choose the engine used to render Mermaid diagrams. Pele is lighter and faster, but its visual style and syntax coverage may differ from the standard renderer.',
    rendererMermaid: 'Mermaid (Standard)',
    rendererPele: 'Pele',
  },
  'zh-CN': {
    pluginName: 'Mermaid',
    mermaidDesc: '插入 Mermaid 图表',
    copySource: '复制 Mermaid 源码',
    settingsTitle: 'Mermaid 设置',
    renderer: '渲染器',
    rendererDesc:
      '选择绘制 Mermaid 图表使用的引擎。Pele 更轻量、渲染更快，但视觉样式与语法覆盖可能与标准渲染器存在差异。',
    rendererMermaid: 'Mermaid（标准）',
    rendererPele: 'Pele',
  },
  'zh-TW': {
    pluginName: 'Mermaid',
    mermaidDesc: '插入 Mermaid 圖表',
    copySource: '複製 Mermaid 原始碼',
    settingsTitle: 'Mermaid 設定',
    renderer: '渲染器',
    rendererDesc:
      '選擇繪製 Mermaid 圖表使用的引擎。Pele 更輕量、渲染更快，但視覺樣式與語法支援可能與標準渲染器有所差異。',
    rendererMermaid: 'Mermaid（標準）',
    rendererPele: 'Pele',
  },
  'ja-JP': {
    pluginName: 'Mermaid',
    mermaidDesc: 'Mermaid ダイアグラムを挿入',
    copySource: 'Mermaid ソースをコピー',
    settingsTitle: 'Mermaid 設定',
    renderer: 'レンダラー',
    rendererDesc:
      'Mermaid 図の描画に使用するエンジンを選択します。Pele はより軽量で高速ですが、見た目や対応構文が標準レンダラーと異なる場合があります。',
    rendererMermaid: 'Mermaid（標準）',
    rendererPele: 'Pele',
  },
  'ko-KR': {
    pluginName: 'Mermaid',
    mermaidDesc: 'Mermaid 다이어그램 삽입',
    copySource: 'Mermaid 소스 복사',
    settingsTitle: 'Mermaid 설정',
    renderer: '렌더러',
    rendererDesc:
      'Mermaid 다이어그램을 그리는 데 사용할 엔진을 선택합니다. Pele는 더 가볍고 빠르지만 시각 스타일과 문법 지원이 표준 렌더러와 다를 수 있습니다.',
    rendererMermaid: 'Mermaid（표준）',
    rendererPele: 'Pele',
  },
  'fr-FR': {
    pluginName: 'Mermaid',
    mermaidDesc: 'Insérer un diagramme Mermaid',
    copySource: 'Copier la source Mermaid',
    settingsTitle: 'Paramètres Mermaid',
    renderer: 'Moteur de rendu',
    rendererDesc:
      'Choisissez le moteur utilisé pour dessiner les diagrammes Mermaid. Pele est plus léger et plus rapide, mais son style visuel et sa couverture syntaxique peuvent différer du moteur standard.',
    rendererMermaid: 'Mermaid (standard)',
    rendererPele: 'Pele',
  },
  'de-DE': {
    pluginName: 'Mermaid',
    mermaidDesc: 'Mermaid-Diagramm einfügen',
    copySource: 'Mermaid-Quelltext kopieren',
    settingsTitle: 'Mermaid-Einstellungen',
    renderer: 'Renderer',
    rendererDesc:
      'Wählen Sie die Engine zum Zeichnen von Mermaid-Diagrammen. Pele ist leichter und schneller, kann sich aber in Darstellung und Syntaxabdeckung vom Standard-Renderer unterscheiden.',
    rendererMermaid: 'Mermaid (Standard)',
    rendererPele: 'Pele',
  },
  'es-ES': {
    pluginName: 'Mermaid',
    mermaidDesc: 'Insertar diagrama Mermaid',
    copySource: 'Copiar código Mermaid',
    settingsTitle: 'Ajustes de Mermaid',
    renderer: 'Renderizador',
    rendererDesc:
      'Elige el motor para dibujar diagramas Mermaid. Pele es más ligero y rápido, pero su estilo visual y cobertura de sintaxis pueden diferir del renderizador estándar.',
    rendererMermaid: 'Mermaid (estándar)',
    rendererPele: 'Pele',
  },
  'it-IT': {
    pluginName: 'Mermaid',
    mermaidDesc: 'Inserisci diagramma Mermaid',
    copySource: 'Copia sorgente Mermaid',
    settingsTitle: 'Impostazioni Mermaid',
    renderer: 'Renderer',
    rendererDesc:
      'Scegli il motore per disegnare i diagrammi Mermaid. Pele è più leggero e veloce, ma lo stile visivo e la copertura sintattica possono differire dal renderer standard.',
    rendererMermaid: 'Mermaid (standard)',
    rendererPele: 'Pele',
  },
  'pt-PT': {
    pluginName: 'Mermaid',
    mermaidDesc: 'Inserir diagrama Mermaid',
    copySource: 'Copiar código Mermaid',
    settingsTitle: 'Definições do Mermaid',
    renderer: 'Motor de renderização',
    rendererDesc:
      'Escolha o motor usado para desenhar diagramas Mermaid. O Pele é mais leve e rápido, mas o estilo visual e a cobertura de sintaxe podem diferir do motor padrão.',
    rendererMermaid: 'Mermaid (padrão)',
    rendererPele: 'Pele',
  },
  'ru-RU': {
    pluginName: 'Mermaid',
    mermaidDesc: 'Вставить диаграмму Mermaid',
    copySource: 'Скопировать исходник Mermaid',
    settingsTitle: 'Настройки Mermaid',
    renderer: 'Рендерер',
    rendererDesc:
      'Выберите движок для отрисовки диаграмм Mermaid. Pele легче и быстрее, но его оформление и поддержка синтаксиса могут отличаться от стандартного рендерера.',
    rendererMermaid: 'Mermaid (стандартный)',
    rendererPele: 'Pele',
  },
  'ar-SA': {
    pluginName: 'Mermaid',
    mermaidDesc: 'إدراج مخطط Mermaid',
    copySource: 'نسخ مصدر Mermaid',
    settingsTitle: 'إعدادات Mermaid',
    renderer: 'محرك العرض',
    rendererDesc:
      'اختر المحرك المستخدم لرسم مخططات Mermaid. محرك Pele أخف وأسرع، لكن نمطه البصري وتغطيته للصياغة قد يختلفان عن المحرك القياسي.',
    rendererMermaid: 'Mermaid (القياسي)',
    rendererPele: 'Pele',
  },
  'hi-IN': {
    pluginName: 'Mermaid',
    mermaidDesc: 'Mermaid आरेख सम्मिलित करें',
    copySource: 'Mermaid स्रोत कॉपी करें',
    settingsTitle: 'Mermaid सेटिंग्स',
    renderer: 'रेंडरर',
    rendererDesc:
      'Mermaid आरेख बनाने के लिए उपयोग होने वाला इंजन चुनें। Pele हल्का और तेज़ है, लेकिन इसकी दृश्य शैली और सिंटैक्स समर्थन मानक रेंडरर से भिन्न हो सकता है।',
    rendererMermaid: 'Mermaid (मानक)',
    rendererPele: 'Pele',
  },
  'th-TH': {
    pluginName: 'Mermaid',
    mermaidDesc: 'แทรกแผนภาพ Mermaid',
    copySource: 'คัดลอกซอร์ส Mermaid',
    settingsTitle: 'การตั้งค่า Mermaid',
    renderer: 'ตัวเรนเดอร์',
    rendererDesc:
      'เลือกเอนจินที่ใช้วาดไดอะแกรม Mermaid ส่วน Pele เบากว่าและเร็วกว่า แต่สไตล์ภาพและการรองรับไวยากรณ์อาจแตกต่างจากตัวเรนเดอร์มาตรฐาน',
    rendererMermaid: 'Mermaid (มาตรฐาน)',
    rendererPele: 'Pele',
  },
  'vi-VN': {
    pluginName: 'Mermaid',
    mermaidDesc: 'Chèn sơ đồ Mermaid',
    copySource: 'Sao chép mã nguồn Mermaid',
    settingsTitle: 'Cài đặt Mermaid',
    renderer: 'Trình kết xuất',
    rendererDesc:
      'Chọn công cụ dùng để vẽ sơ đồ Mermaid. Pele nhẹ hơn và nhanh hơn, nhưng kiểu hiển thị và phạm vi cú pháp có thể khác trình kết xuất tiêu chuẩn.',
    rendererMermaid: 'Mermaid (Tiêu chuẩn)',
    rendererPele: 'Pele',
  },
};
