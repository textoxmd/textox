import { type EditorView } from "prosemirror-view";
import type { EditorSavePoint } from "./src/history/session";

/** 文本位置：行 1 起，列 1 起（列是行内第几个字符，行尾为「行长 + 1」）。 */
export interface EditorTextPoint {
  line: number;
  column: number;
}

/** 光标 / 选区快照，行列口径同 EditorTextPoint。 */
export interface EditorSelectionInfo {
  start: EditorTextPoint;
  end: EditorTextPoint;
  empty: boolean;
  /** 选中的文本（跨块时以换行连接） */
  text: string;
}

export interface TextoEditorRef {
  toggleHeading: (level: number) => void;
  toggleBulletList: () => void;
  toggleOrderedList: () => void;
  toggleTaskList: () => void;
  insertCodeBlock: () => void;
  insertBlockquote: () => void;
  insertHorizontalRule: () => void;
  /** 执行插件贡献的插入命令（工具栏 / 斜杠 / 快捷键共用）。 */
  runEditorInsert: (id: string) => void;
  /** 在当前光标处插入纯文本（外部桥接 / MCP 用，不自动保存）；给了 at 就先移动到该位置再插入。 */
  insertText: (text: string, at?: EditorTextPoint) => void;
  /**
   * 逐字插入（Agent / MCP 用，不自动保存）：按断续节奏把文本打进文档，
   * 期间锁定人工输入；`stream: false` 或源码视图下退化为整段插入。
   */
  insertTextStreamed: (
    text: string,
    at?: EditorTextPoint,
    options?: { stream?: boolean },
  ) => void;
  /** 立即终止正在进行的逐字插入（已插入内容保留）。 */
  cancelStreamedInsert: () => void;
  /** 是否有一段逐字插入正在播放（外部桥接据此拒绝并发写入）。 */
  isStreamingInsert: () => boolean;
  /** 读取当前选区（没有编辑器时返回 null） */
  getSelection: () => EditorSelectionInfo | null;
  /** 把光标移到 start（或选中 start–end），返回实际落点；行列口径见 EditorTextPoint */
  setSelection: (start: EditorTextPoint, end?: EditorTextPoint) => EditorSelectionInfo | null;
  /** 整篇替换 Markdown：按普通编辑事务处理（会上报变更、可撤销，不自动保存） */
  replaceDocument: (markdown: string) => void;
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleStrikethrough: () => void;
  toggleInlineCode: () => void;
  insertInlineMath: () => void;
  insertLink: () => void;
  insertImage: () => void;
  /** 在当前光标处插入 `![alt](src)`（独占空段落时提交为 image_ref 块；否则行内插入） */
  insertImageRef: (src: string, alt: string) => void;
  /** Replace image src in-place (e.g. after upload completes) */
  replaceImageSrc: (oldSrc: string, newSrc: string) => void;
  /** Mark an image as uploading (enables blur overlay) */
  setImageUploading: (src: string) => void;
  /** Mark an image as done uploading (removes blur overlay) */
  clearImageUploading: (src: string) => void;
  /** Replace entire editor content without triggering onChange */
  setMarkdown: (md: string) => void;
  /** IR：滚动到文本匹配的标题；IR pane 隐藏时（双模式源码激活）为 no-op */
  scrollToHeadingText: (text: string) => void;
  /** 撤销（双模式走统一历史会话，纯 IR 走 ProseMirror 原生历史） */
  undo: () => void;
  /** 重做（双模式走统一历史会话，纯 IR 走 ProseMirror 原生历史） */
  redo: () => void;
  /** 焦点是否在编辑器根节点内（含 IR/SV 两个 pane） */
  isFocused: () => boolean;
  /** 结算当前编辑组并返回保存点；无编辑器时返回 null */
  beginSavePoint(): EditorSavePoint | null;
  confirmSavePoint(stateId: number, sessionId?: number, saveSeq?: number): void;
  /** 原地重载等场景：把保存点重置到当前状态 */
  markSaved(): void;
  /** 当前是否偏离保存点（双模式取会话状态；纯 IR 无会话，恒为 false） */
  isDirty(): boolean;
  editorView: EditorView | null;
  setEditable: (editable: boolean) => void;
  toggleTypewriterMode: () => void;
  setTypewriterMode: (enabled: boolean) => void;
}
