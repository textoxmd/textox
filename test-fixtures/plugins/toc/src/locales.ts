import type { PluginLocale } from '@texto/plugin-sdk';

export const defaultLocale = 'en-US';

export const locales: Record<string, PluginLocale> = {
  'en-US': {
    pluginName: 'Table of Contents',
    pluginDescription: 'A block that lists the document headings, generated from [toc]',
  },
  'zh-CN': {
    pluginName: '目录',
    pluginDescription: '自动生成文档标题的目录块，输入 [toc] 生成',
  },
  'zh-TW': {
    pluginName: '目錄',
    pluginDescription: '自動產生文件標題的目錄區塊，輸入 [toc] 產生',
  },
  'ja-JP': {
    pluginName: '目次',
    pluginDescription: '文書の見出し一覧を自動生成するブロック（[toc] で挿入）',
  },
  'ko-KR': {
    pluginName: '목차',
    pluginDescription: '문서 제목 목록을 자동 생성하는 블록, [toc]로 삽입',
  },
  'fr-FR': {
    pluginName: 'Table des matières',
    pluginDescription: 'Un bloc listant les titres du document, généré depuis [toc]',
  },
  'de-DE': {
    pluginName: 'Inhaltsverzeichnis',
    pluginDescription: 'Ein Block, der die Überschriften des Dokuments auflistet, erzeugt aus [toc]',
  },
  'es-ES': {
    pluginName: 'Tabla de contenidos',
    pluginDescription: 'Un bloque que lista los títulos del documento, generado con [toc]',
  },
  'it-IT': {
    pluginName: 'Indice',
    pluginDescription: 'Un blocco che elenca i titoli del documento, generato da [toc]',
  },
  'pt-PT': {
    pluginName: 'Índice',
    pluginDescription: 'Um bloco que lista os títulos do documento, gerado a partir de [toc]',
  },
  'ru-RU': {
    pluginName: 'Оглавление',
    pluginDescription: 'Блок со списком заголовков документа, создаётся из [toc]',
  },
  'ar-SA': {
    pluginName: 'جدول المحتويات',
    pluginDescription: 'كتلة تسرد عناوين المستند، تُنشأ من [toc]',
  },
  'hi-IN': {
    pluginName: 'विषय-सूची',
    pluginDescription: 'दस्तावेज़ के शीर्षकों की सूची वाला ब्लॉक, [toc] से बनाया जाता है',
  },
  'th-TH': {
    pluginName: 'สารบัญ',
    pluginDescription: 'บล็อกที่แสดงรายการหัวเรื่องของเอกสาร สร้างจาก [toc]',
  },
  'vi-VN': {
    pluginName: 'Mục lục',
    pluginDescription: 'Khối liệt kê các tiêu đề của tài liệu, tạo từ [toc]',
  },
};
