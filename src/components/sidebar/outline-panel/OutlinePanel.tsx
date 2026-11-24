import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListTree, X } from 'lucide-react';
import { OutlineTree } from '../outline-tree/OutlineTree';
import { OutlineMinimap } from '../outline-minimap/OutlineMinimap';
import { SidebarResizeHandle } from '../SidebarResizeHandle';

interface OutlinePanelProps {
  width: number;
  isResizing: boolean;
  closing?: boolean;
  outline?: {
    level: number;
    text: string;
    displayText?: string;
    line: number;
    pos?: number;
    excerpt?: string;
  }[];
  outlineStyle: 'off' | 'text' | 'minimap';
  activeIndex?: number;
  /** 文档标识（文件路径等），传给迷你地图视图用于切换时淡入重渲染 */
  documentKey?: string;
  onClose: () => void;
  onOutlineClick?: (line: number, text?: string, pos?: number) => void;
  onResizeStart: () => void;
}

/** 迷你地图模式的固定条宽（含与窗口右沿的间距） */
const MINIMAP_MODE_WIDTH = 44;

/**
 * 文本大纲浮层右侧留白：面板右缘距容器 12px + 面板与正文之间的 12px 间隙。
 * 正文避让的内边距 = 面板实测宽度 + 该留白。
 */
const OUTLINE_GUTTER_EXTRA = 24;

export function OutlinePanel({
  width,
  isResizing,
  closing,
  outline,
  outlineStyle,
  activeIndex,
  documentKey,
  onClose,
  onOutlineClick,
  onResizeStart,
}: OutlinePanelProps) {
  const { t } = useTranslation();
  // 收起大纲时 outlineStyle 会立即变为 off，但面板要等 200ms 右滑退出动画结束后才卸载。
  // 若此时直接按 off 渲染，面板会在滑出过程中从「迷你地图」退化成「文字大纲」再消失
  // （背景、宽度、minimap-mode 一并跳变）。因此记住最后一次激活的样式，收起动画期间沿用。
  const [lastActiveStyle, setLastActiveStyle] = useState<Exclude<OutlinePanelProps['outlineStyle'], 'off'>>(
    outlineStyle === 'off' ? 'text' : outlineStyle,
  );
  if (outlineStyle !== 'off' && outlineStyle !== lastActiveStyle) {
    // render 阶段同步调整状态：React 会立即重渲染，不提交中间帧，避免样式闪变
    setLastActiveStyle(outlineStyle);
  }
  const renderStyle = outlineStyle === 'off' ? lastActiveStyle : outlineStyle;
  const isMinimap = renderStyle === 'minimap';
  const effectiveWidth = isMinimap ? MINIMAP_MODE_WIDTH : width;

  // 内容避让：文本大纲是绝对定位浮层，不再挤占编辑器宽度。把面板实测宽度写入父容器的
  // --outline-gutter，编辑器滚动容器据此加「右内边距」（滚动条之外），正文换行避让面板，
  // 而滚动条仍固定在容器最右缘；minimap 模式写 0，由其自身规则处理留白。
  // 收起动画期间面板仍挂载、该值保持不变，面板卸载后才回弹（配合 padding 过渡）。
  const panelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = panelRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const apply = () => {
      const gutter = isMinimap ? 0 : el.offsetWidth + OUTLINE_GUTTER_EXTRA;
      parent.style.setProperty('--outline-gutter', `${gutter}px`);
    };
    apply();
    // 拖拽改宽只改内联宽度、不触发 React 重渲染，用 ResizeObserver 实时跟随
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      parent.style.removeProperty('--outline-gutter');
    };
  }, [isMinimap]);

  return (
    <div
      ref={panelRef}
      id="outline-panel"
      className={`outline-panel-float ${isResizing ? 'resizing' : ''} ${closing ? 'closing' : ''} ${isMinimap ? 'minimap-mode' : ''}`}
      style={{ width: `${effectiveWidth}px` }}
    >
      {!isMinimap && (
        <div className="outline-panel-header">
          <span className="outline-panel-title">
            <ListTree className="outline-panel-title-icon" />
          </span>
          <button
            className="outline-panel-close-btn"
            onClick={onClose}
            title={t('common.close', 'Close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="outline-panel-body">
        {isMinimap ? (
          <OutlineMinimap
            outline={outline}
            activeIndex={activeIndex}
            documentKey={documentKey}
            onOutlineClick={onOutlineClick}
          />
        ) : (
          <OutlineTree outline={outline} onOutlineClick={onOutlineClick} />
        )}
      </div>
      {!isMinimap && <SidebarResizeHandle position="right" onResizeStart={onResizeStart} />}
    </div>
  );
}
