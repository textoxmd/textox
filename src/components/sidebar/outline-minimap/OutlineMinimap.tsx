import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';

interface OutlineMinimapProps {
  outline?: {
    level: number;
    text: string;
    displayText?: string;
    line: number;
    pos?: number;
    excerpt?: string;
  }[];
  /** 当前滚动到的标题下标（-1 表示无） */
  activeIndex?: number;
  /** 文档标识（文件路径等）：变化时触发索引条淡入重渲染，用于平滑「切换文件」过渡 */
  documentKey?: string;
  onOutlineClick?: (line: number, text?: string, pos?: number) => void;
}

interface PreviewState {
  index: number;
  top: number;
  right: number;
}

/** 懒加载的 markdown 渲染器（不透传原始 HTML，避免 XSS） */
let md: MarkdownIt | null = null;
function renderMarkdown(src: string): string {
  if (!md) {
    md = new MarkdownIt({ html: false, linkify: true });
    md.use(taskLists);
  }
  return md.render(src);
}

export function OutlineMinimap({ outline, activeIndex = -1, documentKey, onOutlineClick }: OutlineMinimapProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  // 切换文件时清掉残留的悬浮态/预览卡，避免用旧下标访问新 outline（越界）
  useEffect(() => {
    setHovered(null);
    setPreview(null);
  }, [documentKey]);
  // 渲染结果缓存：同一段摘要的 markdown 只渲染一次，悬浮切换时复用（避免重复 parse + 重设 innerHTML）
  const markdownCacheRef = useRef<Map<string, string>>(new Map());
  const renderExcerpt = (excerpt: string): string => {
    const cache = markdownCacheRef.current;
    const cached = cache.get(excerpt);
    if (cached !== undefined) return cached;
    const html = renderMarkdown(excerpt);
    cache.set(excerpt, html);
    return html;
  };

  // 大纲超长时，跟随当前项滚动（仅当该项滚出可视区时）
  useEffect(() => {
    if (hovered !== null || activeIndex < 0) return;
    const rail = railRef.current;
    const el = rail?.children[activeIndex] as HTMLElement | undefined;
    if (!rail || !el) return;
    const railRect = rail.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.top >= railRect.top && elRect.bottom <= railRect.bottom) return;
    const itemTop = elRect.top - railRect.top + rail.scrollTop;
    const target = itemTop - rail.clientHeight / 2 + el.clientHeight / 2;
    rail.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [activeIndex, hovered]);

  // 没有大纲时不渲染任何内容（不显示「暂无大纲」提示）
  if (!outline || outline.length === 0) {
    return null;
  }

  // 预览项按下标现取，不能缓存：outline 会在内容编辑后重建为更短的数组，
  // 而 preview.index 是相对旧数组的，可能越界。取不到即视为无预览。
  const previewItem = preview ? outline[preview.index] : undefined;

  const handleEnter = (index: number) => {
    setHovered(index);
    const el = railRef.current?.children[index] as HTMLElement | undefined;
    const rect = el?.getBoundingClientRect();
    if (!rect) return;
    setPreview({
      index,
      top: rect.top + rect.height / 2,
      // 定位到标记（按钮）左缘再往左一点，避免预览卡挡住拉长后的条码
      right: window.innerWidth - rect.left + 10,
    });
  };

  const handleLeave = () => {
    setHovered(null);
    setPreview(null);
  };

  // 颜色强度：悬浮时只有中间项变亮；滚动激活时中间最亮、上下渐暗
  const intensityFor = (i: number): number => {
    if (hovered !== null) {
      return i === hovered ? 1 : 0;
    }
    if (activeIndex >= 0) {
      const d = Math.abs(i - activeIndex);
      if (d === 0) return 1;
      if (d === 1) return 0.5;
    }
    return 0;
  };

  // 宽度进度：悬浮时中间拉最长，两侧依此递减；滚动激活只变颜色、不变长度
  const progressFor = (i: number): number => {
    if (hovered === null) return 0;
    const d = Math.abs(i - hovered);
    // 递减梯度：d=0 拉满，d=1..3 依次缩短，更远回到静止
    const decay = [1, 0.6, 0.3, 0.12];
    return d < decay.length ? decay[d] : 0;
  };

  return (
    <div className="outline-minimap" onMouseLeave={handleLeave}>
      <div className="outline-minimap-rail" ref={railRef} key={documentKey ?? ''}>
        {outline.map((h, i) => (
          <button
            key={i}
            type="button"
            className="outline-minimap-item"
            aria-label={h.displayText ?? h.text}
            onMouseEnter={() => handleEnter(i)}
            onClick={() => onOutlineClick?.(h.line, h.text, h.pos)}
          >
            <span
              className="outline-minimap-marker"
              style={
                {
                  '--marker-progress': progressFor(i),
                  '--marker-intensity': intensityFor(i),
                } as CSSProperties
              }
            />
          </button>
        ))}
      </div>
      {createPortal(
        <div
          className={`outline-minimap-tooltip${previewItem ? ' is-visible' : ''}`}
          style={{
            top: previewItem && preview ? preview.top : -9999,
            right: previewItem && preview ? preview.right : 0,
          }}
        >
          {previewItem && (
            <>
              <div className="outline-minimap-tooltip-title">
                <span className="outline-minimap-tooltip-text">
                  {previewItem.displayText ?? previewItem.text}
                </span>
              </div>
              <div
                className="outline-minimap-tooltip-excerpt"
                dangerouslySetInnerHTML={{ __html: previewItem.excerpt ? renderExcerpt(previewItem.excerpt) : '' }}
              />
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
