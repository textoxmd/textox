import { useCallback, useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreVertical, Download, Printer, Settings, X } from 'lucide-react';
import Overflow from '@rc-component/overflow';
import { createSettingsWindow } from '@/utils/windowManager';
import { TextoEditorRef } from '../TextoEditor/TextoEditorRef';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { setBlockType } from 'prosemirror-commands';
import { listExporters, type ExporterId } from '@/utils/export';
import type { ToolbarActiveState, ToolbarStateController } from '../TextoEditor/src/features/toolbar-state';
import { listToolbarItems } from './registry';
import { useMeasuredWidth } from './useMeasuredWidth';
import {
  buildToolbarEntries,
  groupEntriesBySection,
  isEntryVisible,
  omittedToolbarEntries,
} from './entries';
import type { ToolbarContext, ToolbarEntry } from './types';

interface EditorToolbarProps {
  editorRef: React.RefObject<TextoEditorRef>;
  /** 功能开关：工具栏是否被用户开启（showEditorToolbar）。仅此项变化播放展开/收起动画。 */
  visible: boolean;
  /** 上下文是否允许工具栏出现（IR 模式、有文档、非插件编辑器）。此项变化直接瞬时显隐。 */
  contextVisible: boolean;
  onCloseToolbar?: () => void;
  onExportPdf?: () => void;
  onExport?: (id: ExporterId) => void;
  onExportPng?: () => void;
  onPrint?: () => void;
  isSingleFileMode?: boolean;
  pdfExportDisabled?: boolean;
  toolbarStateController?: ToolbarStateController;
}

const HEADING_KEYS: { value: string; key: string }[] = [
  { value: '1', key: 'menu.heading_1' },
  { value: '2', key: 'menu.heading_2' },
  { value: '3', key: 'menu.heading_3' },
  { value: '4', key: 'menu.heading_4' },
  { value: '5', key: 'menu.heading_5' },
  { value: '6', key: 'menu.heading_6' },
];

const HEADING_LABEL_KEYS = [...HEADING_KEYS.map((opt) => opt.key), 'menu.paragraph'];

export function EditorToolbar({ editorRef, visible, contextVisible, onCloseToolbar, onExportPdf, onExport, onExportPng, onPrint, isSingleFileMode, pdfExportDisabled, toolbarStateController }: EditorToolbarProps) {
  const { t } = useTranslation();
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [toolbarActive, setToolbarActive] = useState<ToolbarActiveState>({
    headingLevel: null, bold: false, italic: false, strikethrough: false,
    inlineCode: false, marks: [],
    blockquote: false, codeBlock: false, bulletList: false, orderedList: false, taskList: false,
    blockInsertDisabled: false,
  });
  const headingMeasureRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  // 固定宽度：测量元素随 contextVisible 条件挂载，重新可见时须重新测量
  // （否则首帧 ref 为空会让宽度永久停留在 0，按钮随标题/段落文案变宽窄）。
  const headingWidth = useMeasuredWidth(headingMeasureRef, contextVisible);

  const ctx: ToolbarContext = {
    editorRef,
    getView: () => editorRef.current?.editorView ?? null,
    active: toolbarActive,
    isSingleFileMode: !!isSingleFileMode,
  };

  // 工具栏项 → 有序渲染单元。位置即优先级：越靠右越先折叠。
  const entries = useMemo(
    () => buildToolbarEntries(listToolbarItems(), ctx),
    // ctx 由 toolbarActive / isSingleFileMode / editorRef 决定；getView 为稳定闭包
    [toolbarActive, isSingleFileMode, editorRef],
  );
  // 当前可见的最大索引（-1 = 全部折叠），由 @rc-component/overflow 回调更新
  const [visibleCount, setVisibleCount] = useState(() => entries.length - 1);

  const exportEntries = [
    ...listExporters().map((exporter) => ({
      id: exporter.id,
      labelKey: exporter.labelKey,
      run: () => onExport?.(exporter.id),
      disabled: false,
    })),
    { id: 'png', labelKey: 'menu.export_png', run: () => onExportPng?.(), disabled: !onExportPng },
    { id: 'pdf', labelKey: 'menu.export_pdf', run: () => onExportPdf?.(), disabled: false },
  ];

  useEffect(() => {
    if (!visible || !toolbarStateController) return;
    return toolbarStateController.subscribe(setToolbarActive);
  }, [visible, toolbarStateController]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown, true);
    return () => document.removeEventListener('mousedown', onDocMouseDown, true);
  }, [exportMenuOpen]);

  const exportDropdownExec = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    setExportMenuOpen(false);
    fn();
  };

  const handleHideToolbar = useCallback(() => {
    onCloseToolbar?.();
  }, [onCloseToolbar]);

  const handleHeadingChange = useCallback(
    (value: string) => {
      const view = editorRef.current?.editorView;
      if (!view) return;
      view.focus();
      if (value === '0') {
        setBlockType(view.state.schema.nodes.paragraph)(view.state, view.dispatch, view);
      } else {
        const level = Number(value);
        setBlockType(view.state.schema.nodes.heading, { level })(view.state, view.dispatch, view);
      }
    },
    [editorRef],
  );

  const renderEntry = useCallback(
    (entry: ToolbarEntry, { index }: { index: number }) => {
      const Icon = entry.icon;
      // 被折叠（不可见）的项不进入 Tab 焦点顺序；库已加 aria-hidden/pointer-events:none。
      const tabIndex = isEntryVisible(index, visibleCount) ? undefined : -1;
      return (
        <Fragment key={entry.id}>
          {entry.isSectionStart && <span className="editor-toolbar-separator" aria-hidden="true" />}
          <button
            type="button"
            className={entry.active ? 'editor-toolbar-btn active' : 'editor-toolbar-btn'}
            onMouseDown={(e) => {
              e.preventDefault();
              entry.run();
            }}
            title={t(entry.labelKey)}
            disabled={entry.disabled}
            tabIndex={tabIndex}
          >
            <Icon size={15} />
          </button>
        </Fragment>
      );
    },
    [t, visibleCount],
  );

  const heading = (
    <div className="editor-toolbar-heading-wrap relative">
      <div
        ref={headingMeasureRef}
        aria-hidden="true"
        className="invisible absolute left-0 top-0 w-max whitespace-nowrap text-[13px] font-medium"
      >
        {HEADING_LABEL_KEYS.map((key) => (
          <div key={key}>{t(key)}</div>
        ))}
      </div>
      <Select value={String(toolbarActive.headingLevel ?? 0)} onValueChange={handleHeadingChange}>
        <SelectTrigger
          size="sm"
          title={t(HEADING_KEYS.find((opt) => opt.value === String(toolbarActive.headingLevel ?? 0))?.key ?? 'menu.paragraph')}
          style={headingWidth ? { width: headingWidth + 34 } : undefined}
          className="justify-center gap-0.5 rounded border-none bg-transparent dark:bg-transparent px-2 py-0 text-[13px] font-medium text-muted-foreground cursor-pointer hover:bg-muted dark:hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:ring-0"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          position="popper"
          align="start"
          className="min-w-30 [&_[data-radix-select-viewport]]:h-auto"
        >
          {HEADING_KEYS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-[13px]">{t(opt.key)}</SelectItem>
          ))}
          <SelectItem value="0" className="text-[13px]">{t('menu.paragraph')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  const omittedGroups = groupEntriesBySection(omittedToolbarEntries(entries, visibleCount));

  const appCluster = (
    <div className="editor-toolbar-app">
      <div className="editor-toolbar-separator" />

      <button className="editor-toolbar-btn" onClick={() => createSettingsWindow()} title={t('common.settings')}>
        <Settings size={15} />
      </button>

      {(onExport || onExportPdf || onExportPng) && (
        <div className="editor-toolbar-menu-wrap" ref={exportMenuRef}>
          <button
            className="editor-toolbar-btn"
            onClick={() => setExportMenuOpen(open => !open)}
            title={t('common.export')}
            disabled={pdfExportDisabled}
          >
            <Download size={15} />
          </button>
          {exportMenuOpen && (
            <div className="editor-toolbar-dropdown">
              {exportEntries.map((entry) => (
                <button
                  key={entry.id}
                  className="editor-toolbar-dropdown-item"
                  disabled={entry.disabled}
                  onMouseDown={exportDropdownExec(entry.run)}
                >
                  {t(entry.labelKey)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {onPrint && (
        <button className="editor-toolbar-btn" onClick={() => onPrint()} title={t('common.print')} disabled={pdfExportDisabled}>
          <Printer size={15} />
        </button>
      )}

      <div className="editor-toolbar-separator" />

      <DropdownMenu>
        <DropdownMenuTrigger className="editor-toolbar-btn" title={t('common.more')}>
          <MoreVertical size={15} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="editor-toolbar-more-dropdown">
          {omittedGroups.map((group, i) => (
            <Fragment key={group.section}>
              {i > 0 && <div className="editor-toolbar-overflow-divider" />}
              {group.entries.map((entry) => {
                const Icon = entry.icon;
                return (
                  <DropdownMenuItem
                    key={entry.id}
                    disabled={entry.disabled}
                    onClick={() => entry.run()}
                  >
                    <Icon size={13} />
                    <span>{t(entry.labelKey)}</span>
                  </DropdownMenuItem>
                );
              })}
            </Fragment>
          ))}
          {omittedGroups.length > 0 && <div className="editor-toolbar-overflow-divider" />}
          <DropdownMenuItem onClick={handleHideToolbar}>
            <X size={13} />
            <span>{t('common.closeToolbar')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  // 不再因 contextVisible 卸载：工具栏现由骨架渲染在 IR pane 内部，随 IR 页一起平移；
  // 模式切到 SV 时由 IR pane 的 display:none 负责隐藏，卸载会破坏"随页滑出"的转场。
  // 是否处于 IR 上下文（contextVisible）仍用于控制测量元素的重测时机。
  return (
    <div className={`editor-toolbar${exportMenuOpen ? ' menu-open' : ''}${!visible ? ' toolbar-hidden' : ''}`}>
      {heading}
      <Overflow
        className="editor-toolbar-editor"
        maxCount={Overflow.RESPONSIVE}
        data={entries}
        itemKey={(entry) => entry.id}
        renderItem={renderEntry}
        renderRest={() => null}
        onVisibleChange={setVisibleCount}
      />
      {appCluster}
    </div>
  );
}
