import { ChevronRight, Circle } from 'lucide-react';
import { useHeightAnimation } from '@/hooks/useHeightAnimation';
import type { OutlineNode } from './types';

function OutlineExpandArrow({ isExpanded, hasChildren }: { isExpanded: boolean; hasChildren: boolean }) {
  if (!hasChildren) {
    return (
      <span className="expand-arrow dot cursor-default text-muted-foreground/60">
        <Circle size={6} fill="currentColor" />
      </span>
    );
  }
  return (
    <span className={`expand-arrow ${isExpanded ? 'expanded' : ''}`}>
      <ChevronRight size={12} />
    </span>
  );
}

interface OutlineTreeNodeProps {
  node: OutlineNode;
  level: number;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onOutlineClick?: (line: number, text?: string, pos?: number) => void;
  t: (key: string) => string;
}

export function OutlineTreeNode({
  node, level, expandedIds, onToggleExpand, onOutlineClick, t,
}: OutlineTreeNodeProps) {
  const isExpanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0;
  const outlineChildrenRef = useHeightAnimation(isExpanded, { noAnimation: true });
  const indentWidth = 15;
  const guideLineOffset = 14.5;
  const basePadding = 8;
  const paddingValue = level * indentWidth + basePadding;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOutlineClick?.(node.line, node.text, node.pos);
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasChildren) onToggleExpand(node.id);
  };

  return (
    <div className="outline-tree-node">
      <div className="outline-tree-item" style={{ paddingLeft: `${paddingValue}px` }} onClick={handleClick}>
        {Array.from({ length: level }).map((_, i) => (
          <span key={i} className="outline-tree-indent" style={{ left: `${i * indentWidth + guideLineOffset}px` }} />
        ))}
        <span className="outline-expand-arrow-wrapper" onClick={handleToggleExpand}>
          <OutlineExpandArrow isExpanded={isExpanded} hasChildren={hasChildren} />
        </span>
        <span className="outline-text">{node.displayText ?? node.text}</span>
      </div>
      {hasChildren && (
        <div ref={outlineChildrenRef} className="outline-children">
          <div className="outline-children-content">
            {node.children.map((child) => (
              <OutlineTreeNode
                key={child.id}
                node={child}
                level={level + 1}
                expandedIds={expandedIds}
                onToggleExpand={onToggleExpand}
                onOutlineClick={onOutlineClick}
                t={t}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
