import { useEffect, useRef, useState, useCallback } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { searchHighlightExtension } from './searchHighlights';
import { foldGutter, foldKeymap, foldService, syntaxTree } from '@codemirror/language';
import {
  selectAll,
  deleteLine,
  moveLineUp,
  moveLineDown,
  copyLineUp,
  copyLineDown,
  selectLine,
  insertNewlineAndIndent,
} from '@codemirror/commands';
import type { Language } from '@codemirror/language';

import { getEditorHost } from '../host';
import { SearchPanel } from './SearchPanel';
import { getThemeExtension } from './themes';
import { sliceExcerpts } from '../outline';
import type { CursorRange, ScrollAlign } from '../history/types';
import { offsetRangeToCursor, rangeToOffsets } from '../history/cursor';
import { modeSwitchAnchorY } from '../scroll-anchor';

/** 源码视图的命令式 API：统一历史会话经适配器驱动它。 */
export interface SourceViewApi {
  getMarkdown(): string;
  getSelection(): CursorRange;
  applyMarkdown(
    md: string,
    selection: CursorRange | null,
    align?: ScrollAlign,
  ): void;
  focus(): void;
}

/**
 * 模式切换的居中滚动目标：**窗口**坐标下的视觉锚点（`modeSwitchAnchorY()`），
 * 而不是滚动容器中线。
 *
 * 主窗口在 macOS 用 `TitleBarStyle::Overlay` + 32px 自绘标题栏（Windows 为
 * `decorations(false)` 的自绘栏），可视区中线比编辑区中线高半个标题栏高；
 * 按容器中线（CodeMirror 的 `y: 'center'`）对齐看起来会偏下。
 *
 * CodeMirror 的 `y: 'start'` 会把行顶放到距滚动容器顶 `yMargin` 处，
 * 因此换算为「锚点 y − 行高/2 − 容器顶」。
 */
function modeSwitchScrollTarget(view: EditorView, pos: number) {
  const block = view.lineBlockAt(pos);
  const scrollerTop = view.scrollDOM.getBoundingClientRect().top;
  const targetTop = modeSwitchAnchorY() - block.height / 2;
  return EditorView.scrollIntoView(pos, {
    y: 'start',
    yMargin: targetTop - scrollerTop,
  });
}

interface SourceCodeEditorProps {
  content: string;
  onChange: (
    content: string,
    selection: CursorRange,
    selectionBefore?: CursorRange | (() => CursorRange),
  ) => void;
  onSave?: () => void;
  appearance?: 'light' | 'dark' | 'system';
  showLineNumbers?: boolean;
  codeBlockWordWrap?: boolean;
  scrollToLine?: number;
  scrollTrigger?: number;
  scrollToHeading?: string;
  onOutlineChange?: (outline: { level: number; text: string; line: number; pos?: number; excerpt?: string }[]) => void;
  autoCapitalize?: boolean;
  editable?: boolean;
  /** 是否处于激活（可见）模式；常驻双编辑器时用显隐切换，非激活时不同步内容/大纲 */
  active?: boolean;
  /**
   * 撤销/重做由统一历史会话接管。缺省时快捷键只被消费、不产生动作：
   * SV 已无 CodeMirror 原生 history，回退它会让撤销被 onChange 记成新编辑。
   */
  onUndo?: () => boolean;
  onRedo?: () => boolean;
  /** 视图创建后注册命令式 API，销毁前以 null 注销 */
  onViewReady?: (api: SourceViewApi | null) => void;
  /** 为 false 时不跟随 content prop（由外部经 applyMarkdown 驱动） */
  syncContent?: boolean;
}

// 检测当前是否为暗黑模式
function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark');
}

// CodeMirror 内部把 CRLF 归一化为 LF；外部 markdown 可能带 CRLF，
// 进入视图前先统一成 LF，避免长度/偏移按 CRLF 计算（位置越界、文本永不相等）。
function toLf(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

// 从文档内容中提取大纲
function extractOutlineFromDoc(doc: string): { level: number; text: string; line: number; excerpt?: string }[] {
  const outline: { level: number; text: string; line: number; excerpt?: string }[] = [];
  const lines = doc.split('\n');

  lines.forEach((line, index) => {
    // 匹配 Markdown 标题格式
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      outline.push({ level, text, line: index + 1, excerpt: '' });
    }
  });

  // 计算每个标题下方的内容摘要（markdown，保留行内语法供预览渲染，最多 100 字）
  const excerpts = sliceExcerpts(doc, outline.map((item) => item.line));
  outline.forEach((item, index) => {
    item.excerpt = excerpts[index];
  });

  return outline;
}

// 大纲只在「可能影响标题」的编辑后重算：长文档里每按键都整篇 split + 逐行正则
// 是源码视图输入延迟的主要成分。判据（都很廉价，只看被改到的行）：
//  - 行数变化 ⇒ 所有标题的行号都要平移，必须重算；
//  - 改动跨行 ⇒ 保守重算；
//  - 否则检查受影响行在新/旧文档里是否像标题（`^#{1,6}\s`）。
const HEADING_LINE_RE = /^#{1,6}\s/;

function changeMayAffectOutline(update: ViewUpdate): boolean {
  if (update.startState.doc.lines !== update.state.doc.lines) return true;
  let affected = false;
  update.changes.iterChanges((fromA, toA, fromB, toB) => {
    if (affected) return;
    const newStart = update.state.doc.lineAt(fromB);
    const newEnd = update.state.doc.lineAt(toB);
    const oldStart = update.startState.doc.lineAt(fromA);
    const oldEnd = update.startState.doc.lineAt(toA);
    if (newStart.number !== newEnd.number || oldStart.number !== oldEnd.number) {
      affected = true;
      return;
    }
    affected =
      HEADING_LINE_RE.test(newStart.text) ||
      HEADING_LINE_RE.test(oldStart.text);
  });
  return affected;
}

export function SourceCodeEditor({
  content,
  onChange,
  onSave,
  appearance = 'system',
  showLineNumbers = true,
  codeBlockWordWrap = true,
  scrollToLine,
  scrollTrigger,
  scrollToHeading,
  onOutlineChange,
  autoCapitalize,
  editable = true,
  active = true,
  onUndo,
  onRedo,
  onViewReady,
  syncContent = true,
}: SourceCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onOutlineChangeRef = useRef(onOutlineChange);
  const onUndoRef = useRef(onUndo);
  const onRedoRef = useRef(onRedo);
  const onViewReadyRef = useRef(onViewReady);
  onUndoRef.current = onUndo;
  onRedoRef.current = onRedo;
  onViewReadyRef.current = onViewReady;
  const activeRef = useRef(active);
  activeRef.current = active;
  const applyingContentRef = useRef(false);
  // 每个编辑器实例独立的主题配置容器
  const themeCompartmentRef = useRef(new Compartment());
  const lineNumbersCompartmentRef = useRef(new Compartment());
  const lineWrappingCompartmentRef = useRef(new Compartment());
  const editableCompartmentRef = useRef(new Compartment());
  // 代码块语言高亮：宿主异步提供语言表，就绪后经该 Compartment 重配
  const languageCompartmentRef = useRef(new Compartment());
  const languageResolverRef = useRef<((lang: string) => Language | null) | null>(null);
  // 当前生效的 CM 主题名（用于 handleThemeChange 读取最新值）
  const currentThemeRef = useRef('githubLight');
  const lightThemeRef = useRef('githubLight');
  const darkThemeRef = useRef('vscodeDark');
  
  // VS Code 风格查找替换面板状态
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<'find' | 'replace'>('find');
  // 文档版本号：内容变化时递增，用于让搜索面板实时刷新匹配项
  const [docVersion, setDocVersion] = useState(0);
  // 递增以请求搜索面板重新聚焦输入框（即使面板已打开）
  const [searchFocusVersion, setSearchFocusVersion] = useState(0);
  // 搜索面板是否打开（更新监听里按需决定是否推送 docVersion，避免关闭时也重渲染）
  const searchOpenRef = useRef(false);
  searchOpenRef.current = isSearchOpen;
  // 最近一次由本视图自身编辑产生的内容：用于让「content 变化」的兜底大纲 effect
  // 跳过自己刚发出去的那一份，避免每次按键都整篇重提取一次。
  const lastSelfContentRef = useRef<string | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    onOutlineChangeRef.current = onOutlineChange;
  }, [onOutlineChange]);

  const [sourceCodeThemeLightState, setSourceCodeThemeLight] = useState(() => localStorage.getItem('texto-source-code-theme-light') || 'githubLight')
  const [sourceCodeThemeDarkState, setSourceCodeThemeDark] = useState(() => localStorage.getItem('texto-source-code-theme-dark') || 'vscodeDark')

  useEffect(() => {
    const container = containerRef.current
    if (container) {
      // --source-code-theme-* 由主题 CSS 声明在 #writer 上，SV 在其子树内继承
      const styles = getComputedStyle(container)
      const lightVal = styles.getPropertyValue('--source-code-theme-light').trim()
      const darkVal = styles.getPropertyValue('--source-code-theme-dark').trim()
      // localStorage 优先于主题 CSS（settings 窗口的实时预览）
      if (!localStorage.getItem('texto-source-code-theme-light') && lightVal) {
        setSourceCodeThemeLight(lightVal)
      }
      if (!localStorage.getItem('texto-source-code-theme-dark') && darkVal) {
        setSourceCodeThemeDark(darkVal)
      }
    }
    // 事件监听无条件注册（否则容器缺失时预览同步会整块失效）
    // 同窗口 codethemeschanged 事件
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { sourceCodeThemeLight?: string; sourceCodeThemeDark?: string }
      // localStorage 优先：预览时已写入，覆盖事件中可能携带的旧值
      const light = localStorage.getItem('texto-source-code-theme-light') || detail.sourceCodeThemeLight
      const dark = localStorage.getItem('texto-source-code-theme-dark') || detail.sourceCodeThemeDark
      if (light) setSourceCodeThemeLight(light)
      if (dark) setSourceCodeThemeDark(dark)
    }
    window.addEventListener('codethemeschanged', handler)
    // 跨窗口 storage 事件（settings 窗口的实时预览）
    const storageHandler = (e: StorageEvent) => {
      if (e.key === 'texto-source-code-theme-light' && e.newValue) setSourceCodeThemeLight(e.newValue)
      if (e.key === 'texto-source-code-theme-dark' && e.newValue) setSourceCodeThemeDark(e.newValue)
    }
    window.addEventListener('storage', storageHandler)
    return () => {
      window.removeEventListener('codethemeschanged', handler)
      window.removeEventListener('storage', storageHandler)
    }
  }, [])

  // 应用主题类名到编辑器容器
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 应用主题的函数
    const applyTheme = () => {
      // 移除旧的主题类名
      const oldThemeClasses = Array.from(container.classList).filter(cls => cls.startsWith('code-theme-'));
      oldThemeClasses.forEach(cls => container.classList.remove(cls));

      // 根据当前外观模式决定应用哪个主题
      const isDarkMode = appearance === 'dark' ||
        (appearance === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const theme = isDarkMode
        ? (sourceCodeThemeDarkState || 'vscodeDark')
        : (sourceCodeThemeLightState || 'githubLight');
      const themePrefix = isDarkMode ? 'code-theme-dark' : 'code-theme-light';
      const themeClassName = `${themePrefix}-${theme}`;
      container.classList.add(themeClassName);
    };

    // 立即应用主题
    applyTheme();

    // 如果外观模式是跟随系统，监听系统主题变化
    if (appearance === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', applyTheme);
      return () => {
        mediaQuery.removeEventListener('change', applyTheme);
      };
    }
  }, [sourceCodeThemeLightState, sourceCodeThemeDarkState, appearance]);

  // 当源码主题选择变化时，同步 CM 主题
  useEffect(() => {
    lightThemeRef.current = sourceCodeThemeLightState
    darkThemeRef.current = sourceCodeThemeDarkState
    const isDark = isDarkMode()
    const themeName = isDark ? sourceCodeThemeDarkState : sourceCodeThemeLightState
    currentThemeRef.current = themeName
    const view = viewRef.current
    if (view) {
      view.dispatch({
        effects: themeCompartmentRef.current.reconfigure(getThemeExtension(themeName)),
      })
    }
  }, [sourceCodeThemeLightState, sourceCodeThemeDarkState])

  useEffect(() => {
    const editorEl = viewRef.current?.dom;
    if (autoCapitalize) {
      // 只放开自动大写：spellcheck / autocomplete 与自动大写无关，必须保持关闭。
      // 浏览器拼写检查在大文档下会随每次按键重扫全文（Chromium 76+ / macOS
      // AppleSpell），此前这里把 spellcheck 一并移除，导致开启自动大写后
      // 拼写检查被静默打开。autocorrect 仍不设置（避免干扰 Windows IME）。
      containerRef.current?.removeAttribute('autocapitalize');
      containerRef.current?.removeAttribute('autocorrect');
      containerRef.current?.setAttribute('autocomplete', 'off');
      containerRef.current?.setAttribute('spellcheck', 'false');
      editorEl?.removeAttribute('autocapitalize');
      editorEl?.removeAttribute('autocorrect');
      editorEl?.setAttribute('autocomplete', 'off');
      editorEl?.setAttribute('spellcheck', 'false');
    } else {
      containerRef.current?.setAttribute('autocapitalize', 'off');
      containerRef.current?.setAttribute('autocorrect', 'off');
      containerRef.current?.setAttribute('autocomplete', 'off');
      containerRef.current?.setAttribute('spellcheck', 'false');
      editorEl?.setAttribute('autocapitalize', 'off');
      // 不在编辑器 contenteditable 元素上设置 autocorrect，避免干扰 Windows IME
      editorEl?.setAttribute('autocomplete', 'off');
      editorEl?.setAttribute('spellcheck', 'false');
    }
  }, [autoCapitalize]);

  // 打开查找面板
  const openFind = useCallback(() => {
    setSearchMode('find');
    setIsSearchOpen(true);
    setSearchFocusVersion((v) => v + 1);
  }, []);
  
  // 打开替换面板
  const openReplace = useCallback(() => {
    setSearchMode('replace');
    setIsSearchOpen(true);
    setSearchFocusVersion((v) => v + 1);
  }, []);
  
  // 关闭查找面板
  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
  }, []);

  // 全局 Ctrl/Cmd+F：即使焦点不在编辑器内（如侧边栏、大纲面板），
  // 只要处于源码模式也能打开查找面板
  useEffect(() => {
    const handleGlobalFind = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      if (e.defaultPrevented || e.isComposing) return;
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'f') return;
      // 焦点在输入控件（对话框、侧边栏搜索框等）或模态框内时不抢占
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditableTarget = !!target?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (isEditableTarget && !containerRef.current?.contains(target)) return;
      if (target?.closest?.('[role="dialog"], [aria-modal="true"]')) return;
      e.preventDefault();
      openFind();
    };
    window.addEventListener('keydown', handleGlobalFind);
    return () => window.removeEventListener('keydown', handleGlobalFind);
  }, [openFind]);

  useEffect(() => {
    if (!containerRef.current) return;

    // 自定义 Markdown 折叠服务，支持折叠代码块、标题区域等
    const markdownFoldService = foldService.of((state, from, _to) => {
      const tree = syntaxTree(state);
      let node = tree.resolveInner(from, 1);

      // 查找可折叠的父节点
      while (node) {
        const name = node.type.name;

        // 折叠代码块 (FencedCode)
        // 只在代码块的第一行显示折叠标记
        if (name === 'FencedCode') {
          const lineStart = state.doc.lineAt(node.from).number;
          const lineEnd = state.doc.lineAt(node.to).number;
          const currentLine = state.doc.lineAt(from).number;
          // 只在代码块的第一行显示折叠标记
          if (currentLine !== lineStart) {
            return null;
          }
          if (lineEnd > lineStart) {
            // 从开头 ``` 行的末尾（换行符）开始折叠，保留 ```js 等标记可见
            // 折叠到 node.to 将结尾 ``` 也隐藏
            const from = Math.max(node.from, state.doc.line(lineStart).to);
            const to = node.to;
            return { from, to };
          }
        }

        // 折叠引用块 (Blockquote)
        // 只在引用块的第一行显示折叠标记
        if (name === 'Blockquote') {
          const lineStart = state.doc.lineAt(node.from).number;
          const lineEnd = state.doc.lineAt(node.to).number;
          const currentLine = state.doc.lineAt(from).number;
          if (currentLine !== lineStart) {
            return null;
          }
          if (lineEnd > lineStart) {
            const startPos = state.doc.line(lineStart).from;
            const endPos = state.doc.line(lineEnd).to;
            return { from: startPos, to: endPos };
          }
        }

        // 折叠列表 (BulletList 或 OrderedList)
        // 只在列表的第一行显示折叠标记
        if (name === 'BulletList' || name === 'OrderedList') {
          const lineStart = state.doc.lineAt(node.from).number;
          const lineEnd = state.doc.lineAt(node.to).number;
          const currentLine = state.doc.lineAt(from).number;
          if (currentLine !== lineStart) {
            return null;
          }
          if (lineEnd > lineStart) {
            const startPos = state.doc.line(lineStart).from;
            const endPos = state.doc.line(lineEnd).to;
            return { from: startPos, to: endPos };
          }
        }

        // 折叠 HTML 块 (HTMLBlock)
        // 只在 HTML 块的第一行显示折叠标记
        if (name === 'HTMLBlock') {
          const lineStart = state.doc.lineAt(node.from).number;
          const lineEnd = state.doc.lineAt(node.to).number;
          const currentLine = state.doc.lineAt(from).number;
          if (currentLine !== lineStart) {
            return null;
          }
          if (lineEnd > lineStart) {
            const startPos = state.doc.line(lineStart).from;
            const endPos = state.doc.line(lineEnd).to;
            return { from: startPos, to: endPos };
          }
        }

        if (node.parent) {
          node = node.parent;
        } else {
          break;
        }
      }

      return null;
    });

    // 代码块语言高亮：解析 ```lang 或 ```lang:title，语言表由宿主提供
    // （异步路径就绪前返回 null，随后经 Compartment 重配）。
    const markdownExtension = () =>
      markdown({
        codeLanguages: (info) => {
          const lang = info.split(':')[0].split(' ')[0];
          return languageResolverRef.current?.(lang) ?? null;
        },
      });

    // 宿主能同步提供语言表时先用它（避免异步就绪前整篇按纯文本重排）。
    // 绑定宿主对象调用：实现方若依赖 this，取出方法引用会丢接收者。
    const host = getEditorHost();
    if (host.getCodeLanguageSupport) {
      languageResolverRef.current = (lang) => host.getCodeLanguageSupport?.(lang) ?? null;
    }

    // 计算初始主题
    const initialIsDark = appearance === 'dark' ||
      (appearance === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const initialTheme = initialIsDark ? sourceCodeThemeDarkState : sourceCodeThemeLightState;
    currentThemeRef.current = initialTheme;

    const state = EditorState.create({
      doc: content,
      extensions: [
        // Markdown 语法高亮，支持代码块内嵌语言高亮
        languageCompartmentRef.current.of(markdownExtension()),
        // 主题配置（使用 Compartment 以便动态切换）
        themeCompartmentRef.current.of(getThemeExtension(initialTheme)),
        // 当前行高亮（类似 VS Code）
        highlightActiveLine(),
        // 自动换行（使用 Compartment 以便动态切换）
        lineWrappingCompartmentRef.current.of(codeBlockWordWrap ? EditorView.lineWrapping : []),
        // 不安装 CodeMirror 原生 history：撤销/重做统一由 EditorDocumentSession 经
        // onUndo / onRedo 派发，两视图共用一份历史。
        // 只读状态（使用 Compartment 以便动态切换）
        // 使用 readOnly 而非 EditorView.editable(false)：后者会移除 contenteditable，
        // 导致编辑器无法获得焦点，查找快捷键（Mod-f）失效；readOnly 保留焦点与选区，仅阻止用户输入。
        editableCompartmentRef.current.of(editable ? [] : EditorState.readOnly.of(true)),
        // 行号显示（使用 Compartment 以便动态切换）
        lineNumbersCompartmentRef.current.of(showLineNumbers ? lineNumbers() : []),
        // 代码折叠边栏
        foldGutter({
          markerDOM: (open) => {
            const marker = document.createElement('span');
            marker.className = 'cm-fold-marker';
            // 使用与 Lucide Chevron 相同的 SVG 路径
            marker.innerHTML = open
              ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(90deg)"><polyline points="9 18 15 12 9 6"></polyline></svg>'
              : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
            marker.style.cssText = 'cursor: pointer; display: flex; align-items: center; justify-content: center;';
            return marker;
          },
        }),
        // 自定义 Markdown 折叠服务
        markdownFoldService,
        // 基础编辑快捷键
        keymap.of([
          // 保存
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              onSaveRef.current?.();
              return true;
            },
          },
          // 撤销/重做：恒由统一历史会话回调处理；回调缺失或返回 false 时也只消费
          // 快捷键、不回退 CM 原生 history（后者会把回退记成新编辑）。
          {
            key: 'Mod-z',
            run: () => {
              const undoSession = onUndoRef.current;
              if (!undoSession) return true;
              try {
                undoSession();
              } catch (err) {
                console.error('[source-view] undo failed', err);
              }
              return true;
            },
            preventDefault: true,
          },
          // 重做 (Windows/Linux: Ctrl+Shift+Z, macOS: Cmd+Shift+Z)
          {
            key: 'Mod-y',
            run: () => {
              const redoSession = onRedoRef.current;
              if (!redoSession) return true;
              try {
                redoSession();
              } catch (err) {
                console.error('[source-view] redo failed', err);
              }
              return true;
            },
            preventDefault: true,
          },
          {
            key: 'Mod-Shift-z',
            run: () => {
              const redoSession = onRedoRef.current;
              if (!redoSession) return true;
              try {
                redoSession();
              } catch (err) {
                console.error('[source-view] redo failed', err);
              }
              return true;
            },
            preventDefault: true,
          },
          // 全选
          { key: 'Mod-a', run: selectAll, preventDefault: true },
          // 删除当前行
          { key: 'Mod-Shift-k', run: deleteLine, preventDefault: true },
          // 上移/下移当前行
          { key: 'Alt-ArrowUp', run: moveLineUp, preventDefault: true },
          { key: 'Alt-ArrowDown', run: moveLineDown, preventDefault: true },
          // 复制当前行到上方/下方
          { key: 'Mod-Shift-ArrowUp', run: copyLineUp, preventDefault: true },
          { key: 'Mod-Shift-ArrowDown', run: copyLineDown, preventDefault: true },
          // 选中当前行
          { key: 'Mod-l', run: selectLine, preventDefault: true },
          // 换行并缩进
          { key: 'Enter', run: insertNewlineAndIndent, preventDefault: true },
          // 查找
          {
            key: 'Mod-f',
            preventDefault: true,
            run: () => {
              openFind();
              return true;
            },
          },
          // 替换（锁定/只读模式下不打开替换面板）
          {
            key: 'Mod-h',
            preventDefault: true,
            run: (view) => {
              if (view.state.readOnly) return true;
              openReplace();
              return true;
            },
          },
          // 允许 Ctrl+/ / Cmd+/ 冒泡到全局 keydown 监听（切换编辑模式）
          { key: 'Mod-/', run: () => false },
        ]),
        // 代码折叠快捷键
        keymap.of(foldKeymap),
        // 高亮匹配项
        searchHighlightExtension,
        // 内容变化监听
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const newContent = update.state.doc.toString();
          lastSelfContentRef.current = newContent;
          // 程序化同步内容 / 历史回放时抑制 onChange，避免自激循环
          if (!applyingContentRef.current) {
            const main = update.state.selection.main;
            // 事务开始前的选区：撤销组用它作为目标光标（代码块末尾输入时事务后
            // 的光标会落在块边界上）。这里传 thunk：同一撤销组合只有起点那次
            // 需要，而算它要把事务前的整篇文档 toString 再逐字符扫到光标，
            // 长文档上是每键一大笔纯浪费。
            const beforeMain = update.startState.selection.main;
            onChangeRef.current(
              newContent,
              offsetRangeToCursor(newContent, main.anchor, main.head),
              () =>
                offsetRangeToCursor(
                  update.startState.doc.toString(),
                  beforeMain.anchor,
                  beforeMain.head,
                ),
            );
          }
          // 通知搜索面板重新计算匹配项（面板关闭时没有消费者，跳过以免白重渲染）
          if (searchOpenRef.current) setDocVersion((version) => version + 1);
          // 实时提取大纲（仅激活时）；只在可能影响标题的编辑后重算
          if (
            activeRef.current &&
            onOutlineChangeRef.current &&
            changeMayAffectOutline(update)
          ) {
            onOutlineChangeRef.current(extractOutlineFromDoc(newContent));
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    // 浏览器原生撤销会绕过统一历史（historyUndo/historyRedo 的 DOM 默认行为），
    // 拦掉 beforeinput 的这两类输入，撤销统一由上层路由。
    const onBeforeInput = (event: Event) => {
      const input = event as InputEvent;
      if (input.inputType === 'historyUndo' || input.inputType === 'historyRedo') {
        event.preventDefault();
      }
    };
    view.dom.addEventListener('beforeinput', onBeforeInput);

    // 命令式 API：统一历史会话经适配器驱动源码视图
    onViewReadyRef.current?.({
      getMarkdown: () => view.state.doc.toString(),
      getSelection: () => {
        const main = view.state.selection.main;
        return offsetRangeToCursor(view.state.doc.toString(), main.anchor, main.head);
      },
      applyMarkdown: (md, selection, align = 'nearest') => {
        applyingContentRef.current = true;
        try {
          // CRLF → LF：与 CM 内部文档一致，偏移/长度才是同一坐标系。
          const text = toLf(md);
          const current = view.state.doc.toString();
          const sel = selection
            ? rangeToOffsets(text, selection)
            : {
                anchor: view.state.selection.main.anchor,
                head: view.state.selection.main.head,
              };
          const anchor = Math.max(0, Math.min(sel.anchor, text.length));
          const head = Math.max(0, Math.min(sel.head, text.length));
          // `scrollIntoView: true` 是最小滚动（目标行在视口外时贴到最近一条边）。
          // 模式切换按窗口视觉中线居中；`y: 'center'` 对齐的是滚动容器中线，
          // 会因为顶部标题栏（以及 IR 的格式操作栏）看起来偏下。
          const scroll =
            align === 'center'
              ? { effects: modeSwitchScrollTarget(view, head) }
              : { scrollIntoView: true as const };
          // 文本相同只恢复选区：不产生整篇替换，也不惊动视图滚动之外的布局。
          if (text === current) {
            view.dispatch({
              selection: EditorSelection.range(anchor, head),
              ...scroll,
            });
            return;
          }
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
            selection: EditorSelection.range(anchor, head),
            ...scroll,
          });
        } finally {
          applyingContentRef.current = false;
        }
      },
      focus: () => view.focus(),
    });

    // 语言包懒加载：就绪后重配 markdown 扩展，代码块才有高亮；
    // 加载失败只退化到纯文本，不影响编辑。
    const loadLanguages = host.loadCodeLanguageSupport?.bind(host);
    if (loadLanguages) {
      void loadLanguages()
        .then((resolver) => {
          if (!resolver || viewRef.current !== view) return;
          languageResolverRef.current = resolver;
          view.dispatch({
            effects: languageCompartmentRef.current.reconfigure(markdownExtension()),
          });
        })
        .catch((err) => {
          // 语言包加载失败不影响编辑；代码块按纯文本显示
          if (import.meta.env.DEV) {
            console.warn('[source-view] failed to load code language support', err);
          }
        });
    }

    const gutterEl = view.dom.querySelector('.cm-foldGutter');
    const onEnter = () => gutterEl?.classList.add('gutter-hovered');
    const onLeave = () => gutterEl?.classList.remove('gutter-hovered');
    gutterEl?.addEventListener('mouseenter', onEnter);
    gutterEl?.addEventListener('mouseleave', onLeave);

    // 主题变化处理函数（外观切换时触发）
    const handleThemeChange = () => {
      const isDark = document.documentElement.classList.contains('dark');
      const themeName = isDark ? darkThemeRef.current : lightThemeRef.current;
      currentThemeRef.current = themeName;
      view.dispatch({
        effects: themeCompartmentRef.current.reconfigure(getThemeExtension(themeName)),
      });
      // 强制刷新光标颜色（修复 WebKit 下 CSS 变量不触发重绘的问题）
      const fg = getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim();
      if (fg) {
        view.dom.querySelectorAll<HTMLElement>('.cm-cursor').forEach(el => {
          el.style.setProperty('border-left-color', fg, 'important');
        });
        // 下个帧恢复 CSS 变量控制，确保持续跟随主题
        requestAnimationFrame(() => {
          view.dom.querySelectorAll<HTMLElement>('.cm-cursor').forEach(el => {
            el.style.removeProperty('border-left-color');
          });
        });
      }
    };

    // 监听外观模式变化事件
    window.addEventListener('appearancechange', handleThemeChange);
    // 监听颜色主题变化事件
    window.addEventListener('colorthemechange', handleThemeChange);
    // 为了兼容性也监听旧的 themechange
    window.addEventListener('themechange', handleThemeChange);

    // 监听系统主题变化（当外观为 system 时）
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = () => {
      handleThemeChange();
    };
    mediaQuery.addEventListener('change', handleMediaChange);

    return () => {
      gutterEl?.removeEventListener('mouseenter', onEnter);
      gutterEl?.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('appearancechange', handleThemeChange);
      window.removeEventListener('colorthemechange', handleThemeChange);
      window.removeEventListener('themechange', handleThemeChange);
      mediaQuery.removeEventListener('change', handleMediaChange);
      onViewReadyRef.current?.(null);
      view.dom.removeEventListener('beforeinput', onBeforeInput);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // 当外部 content 变化时更新编辑器内容（仅激活时；程序化同步抑制 onChange；
  // syncContent=false 时由外部经 applyMarkdown 驱动，跳过此同步）
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !active || syncContent === false) return;

    // content 可能是 CRLF，CM 文档恒为 LF：按归一化后的文本比较，避免每次渲染都重写。
    const next = toLf(content);
    if (next !== view.state.doc.toString()) {
      applyingContentRef.current = true;
      try {
        const transaction = view.state.update({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: next,
          },
        });
        view.dispatch(transaction);
      } finally {
        applyingContentRef.current = false;
      }
    }
  }, [content, active, syncContent]);

  // 激活状态切换只影响大纲/滚动 gating（activeRef）与下方大纲 effect；
  // 光标保存/恢复统一由 TextoEditor 的历史会话 syncView 负责。

  // 当 showLineNumbers 变化时动态更新行号显示
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: lineNumbersCompartmentRef.current.reconfigure(
        showLineNumbers ? lineNumbers() : []
      ),
    });
  }, [showLineNumbers]);

  // 当 codeBlockWordWrap 变化时动态更新自动换行
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: lineWrappingCompartmentRef.current.reconfigure(
        codeBlockWordWrap ? EditorView.lineWrapping : []
      ),
    });
  }, [codeBlockWordWrap]);

  // 当 editable 变化时动态更新编辑状态
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: editableCompartmentRef.current.reconfigure(
        editable ? [] : EditorState.readOnly.of(true)
      ),
    });
  }, [editable]);

  // 当外部 content 变化时更新大纲（用于初始加载和外部更新）；
  // 仅在激活（可见）时输出，避免隐藏编辑器覆盖侧边栏大纲。
  // 以视图文档为源：CM 文档恒为 LF（CRLF 的 \r 会让标题正则失配），
  // 且 session 驱动时可避免 content prop 落后导致的陈旧大纲。
  useEffect(() => {
    if (!active || !onOutlineChange) return;
    const view = viewRef.current;
    // 本视图自己的编辑已在 updateListener 里按需重算过；content 是它回流的
    // 同一份字符串，不必再整篇提取一次（长文档上等于每键翻倍）。
    if (lastSelfContentRef.current === content) return;
    const outline = extractOutlineFromDoc(
      view ? view.state.doc.toString() : toLf(content),
    );
    onOutlineChange(outline);
  }, [content, onOutlineChange, active]);

  // 处理跳转到指定行
  useEffect(() => {
    const view = viewRef.current;
    if (!view || scrollToLine === undefined) return;

    const lineCount = view.state.doc.lines;
    if (scrollToLine < 1 || scrollToLine > lineCount) return;

    const line = view.state.doc.line(scrollToLine);
    if (line) {
      view.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: 'start' }),
      });
    }
  }, [scrollToLine, scrollTrigger]);

  // 处理跳转到指定标题
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !scrollToHeading) return;

    // 逐行读取（CM 的行访问是 O(log n)），避免为了找个标题把整篇文档
    // 字符串化再 split 一遍。
    const { doc } = view.state;
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      const match = line.text.match(/^(#{1,6})\s+(.+)$/);
      if (match && match[2].trim() === scrollToHeading) {
        view.dispatch({
          effects: EditorView.scrollIntoView(line.from, { y: 'start' }),
        });
        break;
      }
    }
  }, [scrollToHeading]);

  return (
    <div ref={containerRef} className="source-code-editor">
      <SearchPanel
        view={viewRef.current}
        isOpen={isSearchOpen}
        onClose={closeSearch}
        initialMode={searchMode}
        docVersion={docVersion}
        readOnly={!editable}
        focusVersion={searchFocusVersion}
      />
    </div>
  );
}
