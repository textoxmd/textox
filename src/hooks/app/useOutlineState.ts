import { useState, useEffect, useCallback, useMemo, type RefObject } from 'react';
import { readAppConfig, writeAppConfig } from '@/utils/appConfig';
import { useOutline, filterHeadings, OutlineHeading } from '@/hooks/useOutline';
import { useOutlineActiveIndex } from '@/hooks/useOutlineActiveIndex';
import { useOutlinePanel } from '@/hooks/useOutlinePanel';
import type { TextoEditorRef } from '@/components/TextoEditor/TextoEditorRef';
import { outlinePlainText } from '@/components/TextoEditor/src/outline-text';
import { revealHeadingRef } from '@/components/headingReveal';
import type { OutlineStyle } from '@/app/types';

/** 大纲项（侧栏 App 状态 / 编辑器发射）允许缺 `pos`：个别标题暂时没有 ProseMirror 位置。 */
type OutlineSourceItem = {
  level: number;
  text: string;
  /** 去 Markdown 标记后的可见文本；由 withDisplayText 派生。 */
  displayText?: string;
  line: number;
  pos?: number;
};

/**
 * 大纲状态项 → 命令面板/侧栏使用的 `OutlineHeading`。
 * 缺 `pos` 的标题用 -1 标记，跳转时由 `jumpToHeading` 交给 `revealHeadingRef` 按文本定位。
 */
export function toOutlineHeadings(items: OutlineSourceItem[]): OutlineHeading[] {
  return items.map((item, index) => ({
    id: `heading-${index}`,
    level: item.level,
    text: item.text,
    pos: item.pos ?? -1,
    line: item.line,
    ...(item.displayText !== undefined
      ? { displayText: item.displayText }
      : {}),
  }));
}

/** 给大纲项补一个显示用纯文本；原始 `text` 保持不变。 */
export function withDisplayText<T extends { text: string }>(
  items: T[],
): (T & { displayText: string })[] {
  return items.map((item) => ({
    ...item,
    displayText: outlinePlainText(item.text),
  }));
}

interface UseOutlineStateParams {
  editorRef: RefObject<TextoEditorRef | null>;
  currentFile: string | null;
  editorMode: 'ir' | 'sv';
  currentContent: string;
  commandInput: string;
}

/**
 * 大纲状态：面板可见性/样式、标题列表（IR 用 useOutline，SV 用 outline 状态）、
 * 滚动跳转，以及命令面板的大纲模式过滤。
 */
export function useOutlineState({
  editorRef,
  currentFile,
  editorMode,
  currentContent,
  commandInput,
}: UseOutlineStateParams) {
  const outlinePanel = useOutlinePanel();

  // 大纲样式：off（关闭）| text（文字树）| minimap（迷你地图），单一数据源为 AppConfig
  const [outlineStyle, setOutlineStyle] = useState<OutlineStyle>('off');
  // 面板可见性：大纲样式非 off 且有打开文档
  const outlineVisible = outlineStyle !== 'off' && !!currentFile;
  // 面板卸载延迟：可见变 false 时先播放右滑退出动画再卸载
  const [outlineClosing, setOutlineClosing] = useState(false);
  const [outlineMounted, setOutlineMounted] = useState(outlineVisible);
  useEffect(() => {
    if (outlineVisible) {
      setOutlineClosing(false);
      setOutlineMounted(true);
      return;
    }
    setOutlineClosing(true);
    const timer = setTimeout(() => setOutlineMounted(false), 200);
    return () => clearTimeout(timer);
  }, [outlineVisible]);

  // 切换大纲样式（关闭/文字/迷你地图）：先更新本地状态保证即时反馈，再落盘配置。
  const changeOutlineStyle = useCallback((value: OutlineStyle) => {
    setOutlineStyle(value);
    void readAppConfig<any>()
      .then((config) => writeAppConfig({ ...config, outline_style: value }))
      .catch((err) => console.error('Failed to save outline style:', err));
  }, []);

  const [outline, setOutline] = useState<{ level: number; text: string; line: number; pos?: number; excerpt?: string }[]>([]);
  // 侧栏树、minimap、命令面板共用的显示文本：只在这里转换一次。
  const displayOutline = useMemo(() => withDisplayText(outline), [outline]);
  const [scrollToLine, setScrollToLine] = useState<number | undefined>(undefined);
  const [scrollTrigger, setScrollTrigger] = useState(0);
  const [scrollToHeading] = useState<string | undefined>(undefined);

  // 当前滚动到的标题下标（供迷你地图大纲高亮）
  const activeOutlineIndex = useOutlineActiveIndex(editorRef, outline, editorMode, outlineStyle !== 'off');

  const handleOutlineClick = useCallback((line: number, text?: string, pos?: number) => {
    if (editorMode === 'ir') {
      if (pos != null && editorRef.current?.editorView) {
        const view = editorRef.current.editorView;
        const dom = view.domAtPos(pos + 1);
        const el = dom.node instanceof Element ? dom.node : dom.node.parentElement;
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      // 没有 pos 的标题：交给 MarkdownEditor 按文本定位
      revealHeadingRef.current?.(line, text ?? '');
      return;
    }
    setScrollToLine(line);
    setScrollTrigger(prev => prev + 1);
  }, [editorMode, editorRef]);

  // 跳转到指定标题
  const jumpToHeading = useCallback((heading: OutlineHeading) => {
    // 源码模式下使用行号跳转
    if (editorMode === 'sv') {
      setScrollToLine(heading.line || 1);
      setScrollTrigger(Date.now());
      return;
    }

    // IR 模式下使用 ProseMirror 的 pos 跳转
    if (!editorRef.current?.editorView) return;

    // 没有 pos 的标题（-1）：交给 MarkdownEditor 按文本定位
    if (heading.pos < 0) {
      // line 缺失时传 0：兜底入口按文本匹配。
      revealHeadingRef.current?.(heading.line ?? 0, heading.text);
      return;
    }

    const view = editorRef.current.editorView;

    // 滚动到视图（直接滚动，不修改选区）
    const dom = view.domAtPos(heading.pos + 1);
    if (dom.node instanceof Element) {
      dom.node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (dom.node.parentElement) {
      dom.node.parentElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [editorMode, editorRef]);

  // 检测是否为大纲模式
  const isOutlineMode = commandInput.startsWith('#');

  // 获取大纲标题列表
  // 即时渲染模式使用 useOutline hook，源码模式使用 outline 状态
  const outlineHeadingsFromHook = useOutline(editorRef, isOutlineMode && !!currentFile && editorMode === 'ir', currentContent);
  const displayHookHeadings = useMemo(
    () => withDisplayText(outlineHeadingsFromHook),
    [outlineHeadingsFromHook],
  );
  const outlineHeadings = useMemo(() => {
    // 编辑器发射的大纲优先（含侧栏/命令面板共用的显示文本）。
    if (displayOutline.length > 0) return toOutlineHeadings(displayOutline);
    if (editorMode === 'sv') return [];
    return displayHookHeadings;
  }, [editorMode, displayOutline, displayHookHeadings]);

  // 过滤标题
  const filteredHeadings = useMemo(() => {
    if (!isOutlineMode) return [];
    const searchTerm = commandInput.slice(1).trim();
    return filterHeadings(outlineHeadings, searchTerm);
  }, [outlineHeadings, isOutlineMode, commandInput]);

  return {
    outlinePanel,
    outlineStyle,
    setOutlineStyle,
    outlineVisible,
    outlineClosing,
    outlineMounted,
    changeOutlineStyle,
    outline: displayOutline,
    setOutline,
    scrollToLine,
    setScrollToLine,
    scrollTrigger,
    setScrollTrigger,
    scrollToHeading,
    activeOutlineIndex,
    handleOutlineClick,
    jumpToHeading,
    isOutlineMode,
    outlineHeadings,
    filteredHeadings,
  };
}
