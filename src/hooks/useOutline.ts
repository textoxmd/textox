import { useState, useEffect, type RefObject } from 'react';
import type { TextoEditorRef } from '@/components/TextoEditor/TextoEditorRef';
import { extractHeadings } from '@/components/TextoEditor/src/outline';
import type { OutlineHeading } from '@/components/TextoEditor/src/outline';

// 兼容：OutlineHeading 仍从本模块重导出，供 app 侧既有 `@/hooks/useOutline` 导入路径使用。
// （sliceExcerpts 已由 SourceCodeEditor 直连编辑器引擎。）
export type { OutlineHeading } from '@/components/TextoEditor/src/outline';

/**
 * Hook: 使用编辑器引用获取大纲标题
 */
export function useOutline(
  editorRef: RefObject<TextoEditorRef | null>,
  isOutlineMode: boolean,
  content: string // 添加 content 作为依赖，当内容变化时重新提取
): OutlineHeading[] {
  const [headings, setHeadings] = useState<OutlineHeading[]>([]);

  useEffect(() => {
    if (!isOutlineMode || !editorRef.current?.editorView) {
      setHeadings([]);
      return;
    }
    const extracted = extractHeadings(editorRef.current.editorView);
    setHeadings(extracted);
  }, [editorRef, isOutlineMode, content]);

  return headings;
}

/**
 * 过滤标题
 */
export function filterHeadings(
  headings: OutlineHeading[],
  searchTerm: string
): OutlineHeading[] {
  if (!searchTerm.trim()) return headings;
  const term = searchTerm.toLowerCase();
  return headings.filter((h) =>
    (h.displayText ?? h.text).toLowerCase().includes(term),
  );
}
