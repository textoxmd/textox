/**
 * 「翻译」插件文案、任务句与设置项文案。公共角色 / 约束 / 定界标签来自
 * `@texto/ai-prompt`，目标语言由设置决定并注入 `{{language}}`。
 */
export type TranslateMessages = {
  pluginName: string;
  pluginDescription: string;
  translate: string;
  promptTask: string;
  sectionTitle: string;
  translateTarget: string;
  translateTargetDesc: string;
  followUiLanguage: string;
  modelProfile: string;
  modelProfileDesc: string;
};

const enUS: TranslateMessages = {
  pluginName: 'Translate',
  pluginDescription: 'Translate selected text into the target language.',
  translate: 'Translate',
  promptTask:
    'Task: translate the selected text into {{language}}. Preserve the original meaning and tone.',
  sectionTitle: 'Translation',
  translateTarget: 'Target language',
  translateTargetDesc: 'Target language for translation. Defaults to the UI language.',
  followUiLanguage: 'Follow UI language',
  modelProfile: 'Model profile',
  modelProfileDesc: 'Enable and pick a profile in Model settings.',
};

const zhCN: TranslateMessages = {
  pluginName: '翻译',
  pluginDescription: '把选中文本翻译成指定语言。',
  translate: '翻译',
  promptTask: '任务：把选中文字翻译成{{language}}。保持原意与语气。',
  sectionTitle: '翻译',
  translateTarget: '目标语言',
  translateTargetDesc: '翻译动作使用的目标语言，默认跟随界面语言。',
  followUiLanguage: '跟随界面语言',
  modelProfile: '模型配置',
  modelProfileDesc: '在「模型设置」里启用并选择一条配置。',
};

const zhTW: TranslateMessages = {
  pluginName: '翻譯',
  pluginDescription: '把選取文字翻譯成指定語言。',
  translate: '翻譯',
  promptTask: '任務：把選取文字翻譯成{{language}}。保持原意與語氣。',
  sectionTitle: '翻譯',
  translateTarget: '目標語言',
  translateTargetDesc: '翻譯動作使用的目標語言，預設跟隨介面語言。',
  followUiLanguage: '跟隨介面語言',
  modelProfile: '模型設定',
  modelProfileDesc: '在「模型設定」裡啟用並選擇一組設定。',
};

const jaJP: TranslateMessages = {
  pluginName: '翻訳',
  pluginDescription: '選択したテキストを指定した言語に翻訳します。',
  translate: '翻訳',
  promptTask:
    'タスク：選択したテキストを{{language}}に翻訳してください。元の意味と語調を保ってください。',
  sectionTitle: '翻訳',
  translateTarget: '翻訳先の言語',
  translateTargetDesc: '翻訳に使う目標言語です。既定では表示言語に合わせます。',
  followUiLanguage: '表示言語に合わせる',
  modelProfile: '使用するモデル構成',
  modelProfileDesc: '「モデル設定」で有効にして構成を選択してください。',
};

const koKR: TranslateMessages = {
  pluginName: '번역',
  pluginDescription: '선택한 텍스트를 지정한 언어로 번역합니다.',
  translate: '번역',
  promptTask:
    '작업: 선택한 텍스트를 {{language}}로 번역하세요. 원래 의미와 어조를 유지하세요.',
  sectionTitle: '번역',
  translateTarget: '대상 언어',
  translateTargetDesc: '번역에 사용할 대상 언어입니다. 기본값은 인터페이스 언어를 따릅니다.',
  followUiLanguage: '인터페이스 언어 따르기',
  modelProfile: '사용할 모델 구성',
  modelProfileDesc: '「모델 설정」에서 활성화하고 구성을 선택하세요.',
};

const frFR: TranslateMessages = {
  pluginName: 'Traduire',
  pluginDescription: 'Traduit le texte sélectionné dans la langue cible.',
  translate: 'Traduire',
  promptTask:
    "Tâche : traduisez le texte sélectionné en {{language}}. Conservez le sens et le ton d'origine.",
  sectionTitle: 'Traduction',
  translateTarget: 'Langue cible',
  translateTargetDesc: "Langue cible de la traduction. Par défaut, la langue de l'interface.",
  followUiLanguage: "Suivre la langue de l'interface",
  modelProfile: 'Profil de modèle',
  modelProfileDesc: 'Activez et choisissez un profil dans « Réglages du modèle ».',
};

const deDE: TranslateMessages = {
  pluginName: 'Übersetzen',
  pluginDescription: 'Übersetzt den markierten Text in die Zielsprache.',
  translate: 'Übersetzen',
  promptTask:
    'Aufgabe: Übersetze den ausgewählten Text. Zielsprache: {{language}}. Bewahre die ursprüngliche Bedeutung und den Ton.',
  sectionTitle: 'Übersetzung',
  translateTarget: 'Zielsprache',
  translateTargetDesc: 'Zielsprache der Übersetzung. Standardmäßig die Oberflächensprache.',
  followUiLanguage: 'Oberflächensprache folgen',
  modelProfile: 'Modellprofil',
  modelProfileDesc: 'Aktiviere und wähle ein Profil in „Modelleinstellungen“.',
};

const esES: TranslateMessages = {
  pluginName: 'Traducir',
  pluginDescription: 'Traduce el texto seleccionado al idioma de destino.',
  translate: 'Traducir',
  promptTask:
    'Tarea: traduce el texto seleccionado al {{language}}. Conserva el significado y el tono originales.',
  sectionTitle: 'Traducción',
  translateTarget: 'Idioma de destino',
  translateTargetDesc: 'Idioma de destino de la traducción. Por defecto, el idioma de la interfaz.',
  followUiLanguage: 'Seguir el idioma de la interfaz',
  modelProfile: 'Perfil de modelo',
  modelProfileDesc: 'Activa y elige un perfil en «Ajustes del modelo».',
};

const ptPT: TranslateMessages = {
  pluginName: 'Traduzir',
  pluginDescription: 'Traduz o texto selecionado para o idioma de destino.',
  translate: 'Traduzir',
  promptTask:
    'Tarefa: traduz o texto selecionado para {{language}}. Mantém o significado e o tom originais.',
  sectionTitle: 'Tradução',
  translateTarget: 'Idioma de destino',
  translateTargetDesc: 'Idioma de destino da tradução. Por predefinição, o idioma da interface.',
  followUiLanguage: 'Seguir o idioma da interface',
  modelProfile: 'Perfil de modelo',
  modelProfileDesc: 'Ative e escolha um perfil em «Definições do modelo».',
};

const itIT: TranslateMessages = {
  pluginName: 'Traduci',
  pluginDescription: 'Traduce il testo selezionato nella lingua di destinazione.',
  translate: 'Traduci',
  promptTask:
    'Attività: traduci il testo selezionato in {{language}}. Mantieni il significato e il tono originali.',
  sectionTitle: 'Traduzione',
  translateTarget: 'Lingua di destinazione',
  translateTargetDesc: "Lingua di destinazione della traduzione. Per impostazione predefinita, la lingua dell'interfaccia.",
  followUiLanguage: "Segui la lingua dell'interfaccia",
  modelProfile: 'Profilo del modello',
  modelProfileDesc: 'Attiva e scegli un profilo in «Impostazioni modello».',
};

const ruRU: TranslateMessages = {
  pluginName: 'Перевести',
  pluginDescription: 'Переводит выделенный текст на целевой язык.',
  translate: 'Перевести',
  promptTask:
    'Задача: переведите выделенный текст на {{language}}. Сохраните исходный смысл и тон.',
  sectionTitle: 'Перевод',
  translateTarget: 'Целевой язык',
  translateTargetDesc: 'Целевой язык перевода. По умолчанию совпадает с языком интерфейса.',
  followUiLanguage: 'Как язык интерфейса',
  modelProfile: 'Профиль модели',
  modelProfileDesc: 'Включите и выберите профиль в разделе «Настройки модели».',
};

const arSA: TranslateMessages = {
  pluginName: 'ترجمة',
  pluginDescription: 'يترجم النص المحدد إلى اللغة الهدف.',
  translate: 'ترجمة',
  promptTask:
    'المهمة: ترجم النص المحدد إلى {{language}}. حافظ على المعنى والنبرة الأصليين.',
  sectionTitle: 'الترجمة',
  translateTarget: 'اللغة الهدف',
  translateTargetDesc: 'اللغة الهدف للترجمة. افتراضيًا تتبع لغة الواجهة.',
  followUiLanguage: 'اتبع لغة الواجهة',
  modelProfile: 'إعداد النموذج',
  modelProfileDesc: 'فعّل واختر إعدادًا في «إعدادات النموذج».',
};

const hiIN: TranslateMessages = {
  pluginName: 'अनुवाद करें',
  pluginDescription: 'चयनित टेक्स्ट को लक्ष्य भाषा में अनुवाद करता है।',
  translate: 'अनुवाद करें',
  promptTask:
    'कार्य: चयनित टेक्स्ट का अनुवाद {{language}} में करें। मूल अर्थ और लहजा बनाए रखें।',
  sectionTitle: 'अनुवाद',
  translateTarget: 'लक्ष्य भाषा',
  translateTargetDesc: 'अनुवाद के लिए लक्ष्य भाषा। डिफ़ॉल्ट रूप से इंटरफ़ेस भाषा।',
  followUiLanguage: 'इंटरफ़ेस भाषा का पालन करें',
  modelProfile: 'मॉडल प्रोफ़ाइल',
  modelProfileDesc: '«मॉडल सेटिंग्स» में सक्षम करें और एक प्रोफ़ाइल चुनें।',
};

const thTH: TranslateMessages = {
  pluginName: 'แปล',
  pluginDescription: 'แปลข้อความที่เลือกเป็นภาษาที่กำหนด',
  translate: 'แปล',
  promptTask: 'งาน: แปลข้อความที่เลือกเป็น{{language}} รักษาความหมายและโทนเดิมไว้',
  sectionTitle: 'การแปล',
  translateTarget: 'ภาษาปลายทาง',
  translateTargetDesc: 'ภาษาปลายทางสำหรับการแปล โดยค่าเริ่มต้นจะตามภาษาอินเทอร์เฟซ',
  followUiLanguage: 'ตามภาษาของอินเทอร์เฟซ',
  modelProfile: 'โปรไฟล์โมเดล',
  modelProfileDesc: 'เปิดใช้งานและเลือกโปรไฟล์ในการตั้งค่าโมเดล',
};

const viVN: TranslateMessages = {
  pluginName: 'Dịch',
  pluginDescription: 'Dịch văn bản đã chọn sang ngôn ngữ đích.',
  translate: 'Dịch',
  promptTask:
    'Nhiệm vụ: dịch đoạn văn bản đã chọn sang {{language}}. Giữ nguyên ý nghĩa và giọng điệu.',
  sectionTitle: 'Bản dịch',
  translateTarget: 'Ngôn ngữ đích',
  translateTargetDesc: 'Ngôn ngữ đích cho bản dịch. Mặc định theo ngôn ngữ giao diện.',
  followUiLanguage: 'Theo ngôn ngữ giao diện',
  modelProfile: 'Cấu hình mô hình',
  modelProfileDesc: 'Bật và chọn một cấu hình trong «Cài đặt mô hình».',
};

// 覆盖 src/i18n/plugin-messages.ts 的 APP_LANGUAGES，15 种语言各一套完整文案。
export const locales: Record<string, TranslateMessages> = {
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
