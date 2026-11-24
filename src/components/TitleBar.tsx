import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { LockIcon, UnlockIcon, RecoverFileIcon, SidebarShowIcon, SidebarHideIcon } from './icons';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FileInfoCard } from './titlebar/FileInfoCard';
import { splitFilename } from './titlebar/filename';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useWindowFocus } from '../hooks/useWindowFocus';
import {
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  isWindowMaximized,
  onWindowResized,
  IS_WINDOWS,
} from '../utils/windowManager';

/**
 * 标题栏文件信息卡片的数据来源。
 *
 * 组装在 `App.tsx`，标题栏本身不读文档状态。
 */
export interface TitleBarFileInfo {
  /** 文档绝对路径；临时文件为 null */
  filePath: string | null;
  /** 是否为未落盘的临时文档 */
  isTemp: boolean;
  /**
   * 读取全文，供字数 / 行数 / 换行符统计。
   *
   * 用 getter 而非值：卡片只在 Popover 展开时挂载，此时才需要全文；
   * 若直接把 content 放进 props，编辑时每键都会让标题栏（及其 memo）失效。
   */
  getContent: () => string;
}

interface TitleBarProps {
  title?: string;
  isModified?: boolean;
  isUnsavedFile?: boolean;
  hasExternalConflict?: boolean;
  isFileDeleted?: boolean;
  onRecoverFile?: () => void;
  hasSidebar?: boolean;
  sidebarPosition?: 'left' | 'right';
  isSettingsWindow?: boolean;
  isSidebarHeader?: boolean;
  editorMode?: 'ir' | 'sv';
  onToggleEditorMode?: () => void;
  onToggleSidebar?: () => void;
  isWindows?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
  isLocked?: boolean;
  onToggleLock?: () => void;
  hasDocument?: boolean;
  /** 文件信息卡片所需数据；缺省时不渲染悬浮卡片 */
  fileInfo?: TitleBarFileInfo;
  isFileEditorActive?: boolean;
}

function getFileNameWithoutExt(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex > 0) {
    return fileName.substring(0, lastDotIndex);
  }
  return fileName;
}

function getFileExt(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex > 0 && lastDotIndex < fileName.length - 1) {
    return fileName.substring(lastDotIndex + 1).toLowerCase();
  }
  return '';
}

/**
 * 卡片经 Portal 挂到 body，但 React 合成事件仍会冒泡回标题栏；
 * 命中卡片内部时不应触发窗口拖动 / 最大化 / 原生标题栏菜单。
 */
export function isInFileInfoCard(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.titlebar-file-info-popup') !== null;
}

const MaximizeIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" stroke="currentColor" strokeOpacity="0.8" strokeWidth="0.8" />
  </svg>
);

const RestoreIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <rect x="2" y="0.5" width="7.5" height="7.5" rx="0.5" stroke="currentColor" strokeOpacity="0.8" strokeWidth="0.8" />
    <rect x="0.5" y="2" width="7.5" height="7.5" rx="0.5" fill="var(--titlebar-bg)" stroke="currentColor" strokeOpacity="0.8" strokeWidth="0.8" />
  </svg>
);

const MinimizeIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <rect x="1" y="4.5" width="8" height="1" rx="0.5" fill="currentColor" fillOpacity="0.8" />
  </svg>
);

const CloseIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
  </svg>
);

const MenuIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect x="1.5" y="3" width="11" height="1.2" rx="0.6" fill="currentColor" fillOpacity="0.8" />
    <rect x="1.5" y="6.5" width="11" height="1.2" rx="0.6" fill="currentColor" fillOpacity="0.8" />
    <rect x="1.5" y="10" width="11" height="1.2" rx="0.6" fill="currentColor" fillOpacity="0.8" />
  </svg>
);

function TitleBarBase({
  title = '',
  isModified = false,
  isUnsavedFile = false,
  hasExternalConflict = false,
  isFileDeleted = false,
  onRecoverFile,
  hasSidebar = false,
  sidebarPosition = 'left',
  isSettingsWindow = false,
  isSidebarHeader = false,
  editorMode = 'ir',
  onToggleEditorMode,
  onToggleSidebar,
  isWindows: propIsWindows,
  onContextMenu: propOnContextMenu,
  isLocked = false,
  onToggleLock,
  hasDocument = false,
  fileInfo,
  isFileEditorActive = false,
}: TitleBarProps) {
  const { t, i18n } = useTranslation();
  // 外部冲突只在有未保存修改时出现，此时用一个冲突灯即可，避免两个提示灯重复
  const showIndicator = (isModified || isUnsavedFile) && !hasExternalConflict;
  const isWindows = propIsWindows ?? IS_WINDOWS;
  const [isMaximized, setIsMaximized] = useState(false);
  const isWindowFocused = useWindowFocus();

  const displayTitle = isSettingsWindow ? t('common.settings') : title;
  const fileNameWithoutExt = getFileNameWithoutExt(displayTitle);
  const fileExt = getFileExt(displayTitle);
  const { head: fileNameHead, tail: fileNameTail } = splitFilename(fileNameWithoutExt);

  useEffect(() => {
    if (!isWindows) return;

    isWindowMaximized().then(setIsMaximized);
    const unlisten = onWindowResized(setIsMaximized);
    return () => { unlisten.then(fn => fn()); };
  }, [isWindows]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (isInFileInfoCard(e.target)) return;
    if (!isWindows) return;
    e.preventDefault();
    if (propOnContextMenu) {
      propOnContextMenu(e);
    } else {
      invoke('show_titlebar_menu');
    }
  }, [isWindows, propOnContextMenu]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (isInFileInfoCard(e.target)) return;
    if ((e.target as HTMLElement).closest('.window-title')) return;
    if (isWindows || isSidebarHeader) return;
    toggleMaximizeWindow();
  }, [isWindows, isSidebarHeader]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isInFileInfoCard(e.target)) return;
    if ((e.target as HTMLElement).closest('.window-controls, .window-control-button, [data-slot="tabs"], .toggle-sidebar-btn, .titlebar-menu-btn, .titlebar-lock-btn, .window-title')) return;
    getCurrentWindow().startDragging().catch(() => {});
  }, []);

  const [titlebarHovered, setTitlebarHovered] = useState(false);
  const sidebarBtnTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleSidebarBtnEnter = useCallback(() => {
    if (sidebarBtnTimerRef.current) clearTimeout(sidebarBtnTimerRef.current);
    setTitlebarHovered(true);
  }, []);

  const handleSidebarBtnLeave = useCallback(() => {
    if (sidebarBtnTimerRef.current) clearTimeout(sidebarBtnTimerRef.current);
    sidebarBtnTimerRef.current = setTimeout(() => setTitlebarHovered(false), 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (sidebarBtnTimerRef.current) clearTimeout(sidebarBtnTimerRef.current);
    };
  }, []);

  const renderEditorTabs = (toggle: () => void) => (
    <Tabs
      value={editorMode}
      onValueChange={(value) => {
        if (value !== editorMode) toggle();
      }}
      className="h-[18px]"
    >
      <TabsList className="h-[16px] rounded-[4px] p-[2px]">
        <TabsTrigger
          value="ir"
          className="h-[14px] cursor-pointer rounded-[3px] px-[7px] py-[1px] text-[10px]"
        >
          IR
        </TabsTrigger>
        <TabsTrigger
          value="sv"
          className="h-[14px] cursor-pointer rounded-[3px] px-[7px] py-[1px] text-[10px]"
        >
          SV
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );

  if (isSidebarHeader) {
    return (
      <div
        className={`title-bar sidebar-header ${sidebarPosition === 'right' ? 'sidebar-right' : ''} ${!isWindowFocused ? 'inactive' : ''} ${titlebarHovered ? 'titlebar-hovered' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseEnter={handleSidebarBtnEnter}
        onMouseLeave={handleSidebarBtnLeave}
      >
        <button
          className="toggle-sidebar-btn"
          onClick={onToggleSidebar}
          title={hasSidebar ? t('common.collapse_sidebar', '收起侧边栏') : t('common.expand_sidebar', '展开侧边栏')}
        >
          {hasSidebar ? <SidebarHideIcon /> : <SidebarShowIcon />}
        </button>
      </div>
    );
  }

  return (
    <div
      className={`title-bar ${isWindows ? 'windows' : ''} ${hasSidebar ? 'with-sidebar' : ''} ${sidebarPosition === 'right' ? 'sidebar-right' : ''} ${isSettingsWindow ? 'settings-window' : ''} ${!isWindowFocused ? 'inactive' : ''} ${titlebarHovered ? 'titlebar-hovered' : ''}`}
      data-tauri-drag-region={true}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleSidebarBtnEnter}
      onMouseLeave={handleSidebarBtnLeave}
    >
      <div className="title-bar-left">
        {isWindows && !isSettingsWindow && (
          <button
            className="titlebar-menu-btn"
            onClick={() => invoke('show_titlebar_menu')}
            title={t('common.menu', '菜单')}
          >
            <MenuIcon />
          </button>
        )}

        {isWindows && hasDocument && !isFileEditorActive && onToggleEditorMode && renderEditorTabs(onToggleEditorMode)}
      </div>

      <div className="title-bar-center">
        {!hasSidebar && onToggleSidebar && (
          <button
            className="toggle-sidebar-btn"
            onClick={onToggleSidebar}
            title={t('common.expand_sidebar', '展开侧边栏')}
          >
            <SidebarShowIcon />
          </button>
        )}
        <span className="titlebar-title-area">
          {hasDocument && isFileDeleted && onRecoverFile ? (
            <button
              className="titlebar-lock-btn recover-file"
              onClick={onRecoverFile}
              title={i18n.language?.startsWith('zh')
                ? '文件已从磁盘删除，点击保存到原位置'
                : 'File was deleted from disk. Click to save it back to its original location'}
            >
              <RecoverFileIcon />
            </button>
          ) : hasDocument && onToggleLock ? (
            <button
              className={`titlebar-lock-btn ${isLocked ? 'locked' : ''}`}
              onClick={onToggleLock}
              title={isLocked ? t('common.unlock') : t('common.lock')}
            >
              {isLocked ? <LockIcon /> : <UnlockIcon />}
            </button>
          ) : null}
          {hasDocument && fileInfo ? (
            <Popover>
              <PopoverTrigger
                className="window-title"
                render={<button type="button" />}
              >
                {fileNameHead && <span className="window-title-head">{fileNameHead}</span>}
                <span className="window-title-tail">{fileNameTail}</span>
                {fileExt && <span className="titlebar-file-ext">{fileExt}</span>}
              </PopoverTrigger>
              <PopoverContent
                className="titlebar-file-info-popup"
                side="bottom"
                sideOffset={6}
                aria-label={displayTitle}
              >
                <FileInfoCard
                  fileName={displayTitle}
                  filePath={fileInfo.filePath}
                  isTemp={fileInfo.isTemp}
                  content={fileInfo.getContent()}
                />
              </PopoverContent>
            </Popover>
          ) : (
            <span className="window-title">
              <span>
                {fileNameWithoutExt}
                {fileExt && (
                  <span className="titlebar-file-ext">{fileExt}</span>
                )}
              </span>
            </span>
          )}
          {showIndicator && (
            <span className="modified-indicator">
              <svg width="6" height="6" viewBox="0 0 8 8" fill="currentColor">
                <circle cx="4" cy="4" r="3" />
              </svg>
            </span>
          )}
          {hasExternalConflict && (
            <span
              className="conflict-indicator"
              title={t('titlebar.externalConflict', '文件已在磁盘上被外部修改')}
            >
              <svg width="6" height="6" viewBox="0 0 8 8" fill="currentColor">
                <circle cx="4" cy="4" r="3" />
              </svg>
            </span>
          )}
        </span>
      </div>

      <div className="title-bar-right">
        {!isWindows && hasDocument && !isFileEditorActive && onToggleEditorMode && renderEditorTabs(onToggleEditorMode)}

        {isWindows && (
          <div className="window-controls">
            <button
              className="window-control-button minimize"
              onClick={minimizeWindow}
              title={t('common.minimize', '最小化')}
            >
              <MinimizeIcon />
            </button>
            <button
              className="window-control-button maximize-restore"
              onClick={toggleMaximizeWindow}
              title={isMaximized ? t('common.restore', '还原') : t('common.maximize', '最大化')}
            >
              {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
            </button>
            <button
              className="window-control-button close"
              onClick={closeWindow}
              title={t('common.close', '关闭')}
            >
              <CloseIcon />
            </button>
          </div>
        )}

        {!isWindows && (
          <div className="traffic-light-spacer"></div>
        )}
      </div>
    </div>
  );
}

/** 标题栏在编辑期间 props 完全不变（全文走 fileInfo.getContent 惰性读取），memo 后每键跳过。 */
export const TitleBar = memo(TitleBarBase);
