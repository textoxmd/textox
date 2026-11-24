import { useState, useEffect, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { OutlineTreeNode } from './OutlineTreeNode';
import { buildOutlineTree, getAllExpandableIds } from './types';
import { ScrollEdges, useScrollEdges } from '@/components/sidebar/ScrollEdges';

interface OutlineTreeProps {
  outline?: {
    level: number;
    text: string;
    displayText?: string;
    line: number;
    pos?: number;
  }[];
  onOutlineClick?: (line: number, text?: string, pos?: number) => void;
}

function OutlineTreeBase({ outline, onOutlineClick }: OutlineTreeProps) {
  const { t } = useTranslation();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // 渐隐层要挂在不滚动的父级：.outline-panel 自己滚动
  const edges = useScrollEdges<HTMLDivElement>();

  // 树只在 outline 变化时重建：原来每次渲染都 buildOutlineTree 一次（渲染体 + effect 各一次）
  const tree = useMemo(
    () => (outline && outline.length > 0 ? buildOutlineTree(outline) : []),
    [outline],
  );
  useEffect(() => {
    if (tree.length === 0) return;
    const allIds = getAllExpandableIds(tree);
    setExpandedIds((prev) => {
      // 只补齐新出现的可展开节点：不能清空重建，否则用户手动折叠的节点
      // 会在每次大纲变化（现在是每次标题变更）后被强制重新展开。
      let changed = false;
      const next = new Set(prev);
      for (const id of allIds) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tree]);

  const handleToggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  if (!outline || outline.length === 0) {
    return (
      <div className="outline-scroll">
        <div className="outline-panel" ref={edges.ref}>
          <div className="outline-empty">{t('outline.empty')}</div>
        </div>
        <ScrollEdges canScrollUp={edges.canScrollUp} canScrollDown={edges.canScrollDown} />
      </div>
    );
  }

  return (
    <div className="outline-scroll">
      <div className="outline-panel" ref={edges.ref}>
        {tree.map((node) => (
          <OutlineTreeNode
            key={node.id}
            node={node}
            level={0}
            expandedIds={expandedIds}
            onToggleExpand={handleToggleExpand}
            onOutlineClick={onOutlineClick}
            t={t}
          />
        ))}
      </div>
      <ScrollEdges canScrollUp={edges.canScrollUp} canScrollDown={edges.canScrollDown} />
    </div>
  );
}

/**
 * 大纲树同样是宿主每键重渲染的受害者：outline 现在只在标题变化时才换身份
 * （见 TextoEditor 的脏标记），配合 memo 后正文输入完全跳过这棵子树。
 */
export const OutlineTree = memo(OutlineTreeBase);
