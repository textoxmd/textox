/**
 * 「解释」插件文案与任务句。公共角色 / 约束 / 定界标签来自 `@texto/ai-prompt`，
 * 这里只保留插件自己的界面文案与 `promptTask`（`{{language}}` 由 actions 注入）。
 */
export type ExplainMessages = {
  pluginName: string;
  pluginDescription: string;
  explain: string;
  promptTask: string;
  sectionTitle: string;
  modelProfile: string;
  modelProfileDesc: string;
};

const enUS: ExplainMessages = {
  pluginName: 'Explain',
  pluginDescription: 'Explain selected text.',
  explain: 'Explain',
  promptTask:
    'Task: explain the meaning of the selected text, adding background or examples when helpful. Answer in {{language}}.',
  sectionTitle: 'Model',
  modelProfile: 'Model profile',
  modelProfileDesc: 'Enable and pick a profile in Model settings.',
};

const zhCN: ExplainMessages = {
  pluginName: '释义',
  pluginDescription: '对选中文本生成释义。',
  explain: '解释',
  promptTask: '任务：解释选中文字的含义，必要时补充背景或例子。用{{language}}回答。',
  sectionTitle: '模型配置',
  modelProfile: '使用的模型配置',
  modelProfileDesc: '在「模型设置」里启用并选择一条配置。',
};

const zhTW: ExplainMessages = {
  pluginName: '釋義',
  pluginDescription: '對選取文字生成釋義。',
  explain: '解釋',
  promptTask: '任務：解釋選取文字的含義，必要時補充背景或例子。用{{language}}回答。',
  sectionTitle: '模型設定',
  modelProfile: '使用的模型設定',
  modelProfileDesc: '在「模型設定」裡啟用並選擇一組設定。',
};

const jaJP: ExplainMessages = {
  pluginName: '解説',
  pluginDescription: '選択したテキストを解説します。',
  explain: '解説',
  promptTask:
    'タスク：選択したテキストの意味を解説し、必要に応じて背景や例を補足してください。{{language}}で回答してください。',
  sectionTitle: 'モデル',
  modelProfile: '使用するモデル構成',
  modelProfileDesc: '「モデル設定」で有効にして構成を選択してください。',
};

const koKR: ExplainMessages = {
  pluginName: '설명',
  pluginDescription: '선택한 텍스트를 설명합니다.',
  explain: '설명',
  promptTask:
    '작업: 선택한 텍스트의 의미를 설명하고 필요하면 배경이나 예시를 덧붙이세요. {{language}}로 답하세요.',
  sectionTitle: '모델',
  modelProfile: '사용할 모델 구성',
  modelProfileDesc: '「모델 설정」에서 활성화하고 구성을 선택하세요.',
};

const frFR: ExplainMessages = {
  pluginName: 'Expliquer',
  pluginDescription: 'Explique le texte sélectionné.',
  explain: 'Expliquer',
  promptTask:
    'Tâche : expliquez le sens du texte sélectionné, en ajoutant un contexte ou des exemples si utile. Répondez en {{language}}.',
  sectionTitle: 'Modèle',
  modelProfile: 'Profil de modèle',
  modelProfileDesc: 'Activez et choisissez un profil dans « Réglages du modèle ».',
};

const deDE: ExplainMessages = {
  pluginName: 'Erklären',
  pluginDescription: 'Erklärt markierten Text.',
  explain: 'Erklären',
  promptTask:
    'Aufgabe: Erkläre die Bedeutung des markierten Textes und ergänze bei Bedarf Hintergrund oder Beispiele. Antwortsprache: {{language}}.',
  sectionTitle: 'Modell',
  modelProfile: 'Modellprofil',
  modelProfileDesc: 'Aktiviere und wähle ein Profil in „Modelleinstellungen“.',
};

const esES: ExplainMessages = {
  pluginName: 'Explicar',
  pluginDescription: 'Explica el texto seleccionado.',
  explain: 'Explicar',
  promptTask:
    'Tarea: explica el significado del texto seleccionado y añade contexto o ejemplos cuando sea útil. Responde en {{language}}.',
  sectionTitle: 'Modelo',
  modelProfile: 'Perfil de modelo',
  modelProfileDesc: 'Activa y elige un perfil en «Ajustes del modelo».',
};

const ptPT: ExplainMessages = {
  pluginName: 'Explicar',
  pluginDescription: 'Explica o texto selecionado.',
  explain: 'Explicar',
  promptTask:
    'Tarefa: explica o significado do texto selecionado e acrescenta contexto ou exemplos quando for útil. Responde em {{language}}.',
  sectionTitle: 'Modelo',
  modelProfile: 'Perfil de modelo',
  modelProfileDesc: 'Ative e escolha um perfil em «Definições do modelo».',
};

const itIT: ExplainMessages = {
  pluginName: 'Spiega',
  pluginDescription: 'Spiega il testo selezionato.',
  explain: 'Spiega',
  promptTask:
    'Attività: spiega il significato del testo selezionato, aggiungendo contesto o esempi quando utile. Rispondi in {{language}}.',
  sectionTitle: 'Modello',
  modelProfile: 'Profilo del modello',
  modelProfileDesc: 'Attiva e scegli un profilo in «Impostazioni modello».',
};

const ruRU: ExplainMessages = {
  pluginName: 'Объяснить',
  pluginDescription: 'Объясняет выделенный текст.',
  explain: 'Объяснить',
  promptTask:
    'Задача: объясните смысл выделенного текста, при необходимости добавив контекст или примеры. Язык ответа: {{language}}.',
  sectionTitle: 'Модель',
  modelProfile: 'Профиль модели',
  modelProfileDesc: 'Включите и выберите профиль в разделе «Настройки модели».',
};

const arSA: ExplainMessages = {
  pluginName: 'شرح',
  pluginDescription: 'يشرح النص المحدد.',
  explain: 'شرح',
  promptTask:
    'المهمة: اشرح معنى النص المحدد، وأضف خلفية أو أمثلة عند الحاجة. أجب باللغة {{language}}.',
  sectionTitle: 'النموذج',
  modelProfile: 'إعداد النموذج',
  modelProfileDesc: 'فعّل واختر إعدادًا في «إعدادات النموذج».',
};

const hiIN: ExplainMessages = {
  pluginName: 'समझाएँ',
  pluginDescription: 'चयनित टेक्स्ट की व्याख्या करता है।',
  explain: 'समझाएँ',
  promptTask:
    'कार्य: चयनित टेक्स्ट का अर्थ समझाएँ और आवश्यकता होने पर पृष्ठभूमि या उदाहरण जोड़ें। {{language}} में उत्तर दें।',
  sectionTitle: 'मॉडल',
  modelProfile: 'मॉडल प्रोफ़ाइल',
  modelProfileDesc: '«मॉडल सेटिंग्स» में सक्षम करें और एक प्रोफ़ाइल चुनें।',
};

const thTH: ExplainMessages = {
  pluginName: 'อธิบาย',
  pluginDescription: 'อธิบายข้อความที่เลือก',
  explain: 'อธิบาย',
  promptTask:
    'งาน: อธิบายความหมายของข้อความที่เลือก และเพิ่มบริบทหรือตัวอย่างเมื่อเป็นประโยชน์ ตอบเป็น{{language}}',
  sectionTitle: 'โมเดล',
  modelProfile: 'โปรไฟล์โมเดล',
  modelProfileDesc: 'เปิดใช้งานและเลือกโปรไฟล์ในการตั้งค่าโมเดล',
};

const viVN: ExplainMessages = {
  pluginName: 'Giải thích',
  pluginDescription: 'Giải thích văn bản đã chọn.',
  explain: 'Giải thích',
  promptTask:
    'Nhiệm vụ: giải thích ý nghĩa của đoạn văn bản đã chọn, bổ sung bối cảnh hoặc ví dụ khi hữu ích. Trả lời bằng {{language}}.',
  sectionTitle: 'Mô hình',
  modelProfile: 'Cấu hình mô hình',
  modelProfileDesc: 'Bật và chọn một cấu hình trong «Cài đặt mô hình».',
};

// 覆盖 src/i18n/plugin-messages.ts 的 APP_LANGUAGES，15 种语言各一套完整文案。
export const locales: Record<string, ExplainMessages> = {
  'ar-SA': arSA,
  'de-DE': deDE,
  'en-US': enUS,
  'es-ES': esES,
  'fr-FR': frFR,
  'hi-IN': hiIN,
  'it-IT': itIT,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'pt-PT': ptPT,
  'ru-RU': ruRU,
  'th-TH': thTH,
  'vi-VN': viVN,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
};

export const defaultLocale = 'en-US';
