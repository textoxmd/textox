import type { ReactNode, RefObject } from 'react';
import type { EditorPaneMode, PanePhase } from './usePaneTransition';

export interface EditorPanesProps {
  visualMode: EditorPaneMode;
  phase: PanePhase;
  rtl: boolean;
  ir: ReactNode;
  sv: ReactNode;
  irHeader?: ReactNode;
  containerRef?: RefObject<HTMLDivElement>;
  className?: string;
  /** 叠在编辑器上的浮动元素（如 Agent 正在输入的提示），不影响编辑器布局 */
  overlay?: ReactNode;
}

export function EditorPanes({
  visualMode,
  phase,
  rtl,
  ir,
  sv,
  irHeader,
  containerRef,
  className,
  overlay,
}: EditorPanesProps) {
  const classes = [
    'markdown-editor',
    'editor-content-fade-in',
    rtl ? 'editor-content-rtl' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={containerRef}
      id="writer"
      className={classes}
      data-pane-transition={phase === 'idle' ? undefined : phase}
    >
      <div className="editor-panes">
        <div className="editor-pane" data-pane="ir" data-active={visualMode === 'ir'}>
          {irHeader}
          {ir}
        </div>
        <div className="editor-pane" data-pane="sv" data-active={visualMode === 'sv'}>
          {sv}
        </div>
        {overlay}
      </div>
    </div>
  );
}
