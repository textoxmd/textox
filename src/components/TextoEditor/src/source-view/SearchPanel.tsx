import React, { useState, useEffect, useRef, useCallback } from 'react';
import { EditorView } from '@codemirror/view';
import type { ChangeSpec } from '@codemirror/state';
import { updateSearchHighlights } from './searchHighlights';
import { findMatches, type SearchMatch } from './search-text';
import {
  ChevronDown,
  ChevronUp,
  X,
  ArrowLeftRight,
  Copy
} from 'lucide-react';

interface SearchPanelProps {
  view: EditorView | null;
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'find' | 'replace';
  /** 文档版本号，变化时重新计算匹配项（不移动光标） */
  docVersion?: number;
  /** 只读模式（锁定）：仅允许查找，隐藏并禁用替换 */
  readOnly?: boolean;
  /** 递增以请求重新聚焦查找输入框（即使面板已打开） */
  focusVersion?: number;
}

const MIN_WIDTH = 400;
const MAX_WIDTH = 800;

/** 文档版本变化后的重扫延迟：连续输入时合并成一次全篇扫描 */
const DOC_RESCAN_DEBOUNCE_MS = 120;

export const SearchPanel: React.FC<SearchPanelProps> = ({
  view,
  isOpen,
  onClose,
  initialMode = 'find',
  docVersion = 0,
  readOnly = false,
  focusVersion = 0
}) => {
  const [mode, setMode] = useState<'find' | 'replace'>(initialMode);
  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [preserveCase, setPreserveCase] = useState(false);
  const [currentMatch, setCurrentMatch] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [width, setWidth] = useState(MIN_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const prevDocVersionRef = useRef(docVersion);

  const findAllMatches = useCallback((text: string) => {
    if (!view || !text) return { matches: [] as SearchMatch[], truncated: false };
    return findMatches(view.state.doc.toString(), text, { caseSensitive, wholeWord, regex });
  }, [view, caseSensitive, wholeWord, regex]);

  /**
   * 同步重扫：替换 / 跳转不能依赖防抖窗口（DOC_RESCAN_DEBOUNCE_MS）里的旧偏移，
   * 否则文档刚改过就点替换会落到错位的位置、改坏相邻文本。
   */
  const rescanMatches = useCallback((): SearchMatch[] => {
    const { matches: fresh, truncated: isTruncated } = findAllMatches(searchText);
    prevDocVersionRef.current = docVersion;
    setMatches(fresh);
    setTotalMatches(fresh.length);
    setTruncated(isTruncated);
    return fresh;
  }, [findAllMatches, searchText, docVersion]);

  const applyMatch = useCallback((matchList: SearchMatch[], index: number) => {
    if (!view || matchList.length === 0) return;
    const matchIndex = ((index % matchList.length) + matchList.length) % matchList.length;
    const match = matchList[matchIndex];
    updateSearchHighlights(view, matchList, matchIndex);
    view.dispatch({
      selection: { anchor: match.from, head: match.to },
      effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
    });
    setCurrentMatch(matchIndex + 1);
  }, [view]);

  useEffect(() => {
    if (!view) return;
    if (!isOpen || !searchText) {
      setMatches([]);
      setTotalMatches(0);
      setTruncated(false);
      setCurrentMatch(0);
      updateSearchHighlights(view, [], -1);
      return;
    }
    const { matches: newMatches, truncated: isTruncated } = findAllMatches(searchText);
    setMatches(newMatches);
    setTotalMatches(newMatches.length);
    setTruncated(isTruncated);
    if (newMatches.length === 0) {
      setCurrentMatch(0);
      updateSearchHighlights(view, [], -1);
      return;
    }
    const cursorPos = view.state.selection.main.from;
    const currentIndex = newMatches.findIndex(m => m.from <= cursorPos && m.to >= cursorPos);
    applyMatch(newMatches, currentIndex >= 0 ? currentIndex : 0);
  }, [searchText, isOpen, findAllMatches, view, applyMatch]);

  // 文档内容变化时刷新匹配项与高亮；不移动光标/滚动，避免干扰正在进行的编辑。
  // 连续输入时用防抖合并成一次全篇扫描（否则每个按键都要重新扫描整篇文档）。
  useEffect(() => {
    if (prevDocVersionRef.current === docVersion) return;
    if (!view || !isOpen || !searchText) {
      prevDocVersionRef.current = docVersion;
      return;
    }
    const timer = window.setTimeout(() => {
      prevDocVersionRef.current = docVersion;
      const { matches: newMatches, truncated: isTruncated } = findAllMatches(searchText);
      setMatches(newMatches);
      setTotalMatches(newMatches.length);
      setTruncated(isTruncated);
      if (newMatches.length === 0) {
        setCurrentMatch(0);
        updateSearchHighlights(view, [], -1);
        return;
      }
      const cursorPos = view.state.selection.main.from;
      const atCursor = newMatches.findIndex(m => m.from <= cursorPos && m.to >= cursorPos);
      const index = atCursor >= 0
        ? atCursor
        : Math.min(Math.max(currentMatch - 1, 0), newMatches.length - 1);
      updateSearchHighlights(view, newMatches, index);
      if (index !== currentMatch - 1) setCurrentMatch(index + 1);
    }, DOC_RESCAN_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [docVersion, view, isOpen, searchText, findAllMatches, currentMatch]);

  const goToMatch = (index: number) => {
    if (!view) return;
    // 文档可能刚变过还没重扫，按最新内容跳转。
    const fresh = rescanMatches();
    if (fresh.length === 0) {
      setCurrentMatch(0);
      updateSearchHighlights(view, [], -1);
      return;
    }
    applyMatch(fresh, index - 1);
  };

  const goToNext = () => goToMatch(currentMatch + 1);
  const goToPrev = () => goToMatch(currentMatch - 1);

  const preserveCaseTransform = (original: string, replacement: string): string => {
    if (original === original.toUpperCase()) return replacement.toUpperCase();
    if (original === original.toLowerCase()) return replacement.toLowerCase();
    if (original[0] === original[0].toUpperCase()) {
      return replacement[0].toUpperCase() + replacement.slice(1).toLowerCase();
    }
    return replacement;
  };

  const replaceCurrent = () => {
    if (readOnly || !view || !searchText) return;
    const fresh = rescanMatches();
    if (fresh.length === 0) {
      setCurrentMatch(0);
      updateSearchHighlights(view, [], -1);
      return;
    }
    const matchIndex = Math.min(Math.max(currentMatch - 1, 0), fresh.length - 1);
    const match = fresh[matchIndex];
    let finalReplaceText = replaceText;
    if (preserveCase) {
      const originalText = view.state.doc.sliceString(match.from, match.to);
      finalReplaceText = preserveCaseTransform(originalText, replaceText);
    }
    view.dispatch({
      changes: { from: match.from, to: match.to, insert: finalReplaceText },
      selection: { anchor: match.from + finalReplaceText.length }
    });
    const { matches: newMatches, truncated: isTruncated } = findAllMatches(searchText);
    setMatches(newMatches);
    setTotalMatches(newMatches.length);
    setTruncated(isTruncated);
    if (newMatches.length === 0) {
      setCurrentMatch(0);
      updateSearchHighlights(view, [], -1);
      return;
    }
    applyMatch(newMatches, matchIndex < newMatches.length ? matchIndex : 0);
  };

  const replaceAll = () => {
    if (readOnly || !view || !searchText) return;
    // 先按当前文档重扫，避免用防抖前算出的旧偏移批量改动。
    const fresh = rescanMatches();
    if (fresh.length === 0) {
      setCurrentMatch(0);
      updateSearchHighlights(view, [], -1);
      return;
    }
    const doc = view.state.doc;
    // 一次性构造全部变更交给 CodeMirror 单趟应用；旧实现从后往前逐项
    // `slice(0, from) + repl + slice(to)`，每次切片都复制整篇文档（O(n·m)）。
    const changes: ChangeSpec[] = fresh.map((match) => {
      const insert = preserveCase
        ? preserveCaseTransform(doc.sliceString(match.from, match.to), replaceText)
        : replaceText;
      return { from: match.from, to: match.to, insert };
    });
    view.dispatch({ changes });
    setMatches([]);
    setTotalMatches(0);
    setTruncated(false);
    setCurrentMatch(0);
    updateSearchHighlights(view, [], -1);
  };

  // 拖拽调整宽度
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
  }, [width]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = startXRef.current - e.clientX;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidthRef.current + deltaX));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'Enter') {
        if (e.shiftKey) goToPrev();
        else goToNext();
      } else if (e.key === 'F3') {
        e.preventDefault();
        if (e.shiftKey) goToPrev();
        else goToNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, currentMatch, matches]);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
    }
  }, [isOpen, focusVersion]);

  const toggleMode = () => setMode(mode === 'find' ? 'replace' : 'find');

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className="search-panel"
      style={{ width: `${width}px` }}
    >
      {/* 左侧拖拽条 */}
      <div
        className="resize-handle"
        onMouseDown={handleResizeStart}
        title="拖动调整宽度"
      />
      <div className="search-content">
        {/* 左侧：折叠按钮（跨两行）；只读模式下不提供替换 */}
        <div className="toggle-cell">
          {!readOnly && (
            <button className="toolbar-button toggle-btn" onClick={toggleMode} title={mode === 'find' ? '展开替换' : '收起替换'}>
              {mode === 'find' ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
            </button>
          )}
        </div>

        {/* 右侧：输入框区域 */}
        <div className="search-rows">
          {/* 第一行：查找输入框 + 匹配计数 + 导航按钮 + 关闭按钮 */}
          <div className="search-row">
            {/* 查找输入框 */}
            <div className="input-wrapper">
              <div className="input-container">
                <input
                  ref={searchInputRef}
                  type="text"
                  className="search-input"
                  placeholder="查找"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                />
                <div className="input-toggles">
                  <button className={`toggle-button ${caseSensitive ? 'active' : ''}`} onClick={() => setCaseSensitive(!caseSensitive)} title="区分大小写 (Alt+C)">Aa</button>
                  <button className={`toggle-button ${wholeWord ? 'active' : ''}`} onClick={() => setWholeWord(!wholeWord)} title="全字匹配 (Alt+W)">\b</button>
                  <button className={`toggle-button ${regex ? 'active' : ''}`} onClick={() => setRegex(!regex)} title="使用正则表达式 (Alt+R)">.*</button>
                </div>
              </div>
            </div>
            {/* 中间区域：匹配计数 */}
            <div className="center-actions">
              {searchText && totalMatches === 0 && <span className="match-count no-results">无结果</span>}
              {totalMatches > 0 && <span className="match-count">{currentMatch}/{totalMatches}{truncated ? '+' : ''}</span>}
            </div>
            {/* 导航按钮 */}
            <div className="nav-buttons">
              <button className="toolbar-button" onClick={goToPrev} title="上一个 (Shift+Enter)" disabled={totalMatches === 0}><ChevronUp size={12} /></button>
              <button className="toolbar-button" onClick={goToNext} title="下一个 (Enter)" disabled={totalMatches === 0}><ChevronDown size={12} /></button>
            </div>
            {/* 关闭按钮 */}
            <button className="toolbar-button" onClick={onClose} title="关闭 (Esc)"><X size={12} /></button>
          </div>

          {/* 第二行：替换输入框（仅在替换模式且非只读时显示） */}
          {mode === 'replace' && !readOnly && (
            <div className="search-row">
              {/* 替换输入框 */}
              <div className="input-wrapper">
                <div className="input-container">
                  <input ref={replaceInputRef} type="text" className="search-input search-input-replace" placeholder="替换" value={replaceText} onChange={(e) => setReplaceText(e.target.value)} />
                  <button className={`toggle-button ${preserveCase ? 'active' : ''}`} onClick={() => setPreserveCase(!preserveCase)} title="保留大小写" style={{ position: 'absolute', right: '4px' }}>Aa</button>
                </div>
              </div>
              {/* 中间区域：替换按钮（与匹配计数同列） */}
              <div className="center-actions">
                <div className="replace-actions">
                  <button className="icon-action-button" onClick={replaceCurrent} title="替换" disabled={totalMatches === 0}><ArrowLeftRight size={12} /></button>
                  <button className="icon-action-button" onClick={replaceAll} title="全部替换" disabled={totalMatches === 0}><Copy size={12} /></button>
                </div>
              </div>
              {/* 导航按钮占位列 */}
              <div className="nav-buttons-placeholder" />
              {/* 关闭按钮占位列 */}
              <div className="close-placeholder" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
