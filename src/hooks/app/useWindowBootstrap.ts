import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, confirm } from '@tauri-apps/plugin-dialog';
import { exit } from '@tauri-apps/plugin-process';
import { toast } from 'sonner';
import { logger } from '@/utils/logger';
import { readAppConfig, writeAppConfig } from '@/utils/appConfig';
import {
  getWindowInfo,
  isMainWindow,
  createNewWindow,
  updateWindowFile,
  updateWindowFolder,
  updateWindowMode,
  clearLaunchWorkspaceFlag,
  notifyWindowReady,
  takePendingRecentItem,
} from '@/utils/windowManager';
import { convertFileNode, createRootNode, type RustFileNode } from '@/app/fileTree';
import type { FileNode } from '@/components/sidebar/file-tree/types';
import type { TempFile } from '@/app/types';
import { resolveFileEditor, isDisabledFileExtension } from '@/plugins/registry';
import type { FileEditorHandle } from '@/plugins/types';
import type { useSidebar } from '@/hooks/useSidebar';
import type { useDocumentState } from './core/useDocumentState';
import type { useDocumentSession } from './core/useDocumentSession';
import { applyUnloadPreparation, prepareWindowUnload } from './unloadGuard';
import { openRecentItemPath } from './openRecentItem';
import { openDocumentOrThrow } from './openDocument';
import { deferAfterFirstPaint } from './deferAfterFirstPaint';
import { subscribePluginReload } from '@/plugins/pluginReload';

type DocumentState = ReturnType<typeof useDocumentState>;
type DocumentSession = ReturnType<typeof useDocumentSession>;
type OutlineItem = { level: number; text: string; line: number; pos?: number; excerpt?: string };

interface UseWindowBootstrapParams {
  doc: DocumentState;
  session: DocumentSession;
  setFiles: Dispatch<SetStateAction<FileNode[]>>;
  sidebar: ReturnType<typeof useSidebar>;
  addToRecentItems: (path: string) => Promise<void>;
  removeRecentItem: (path: string) => void;
  setOutline: Dispatch<SetStateAction<OutlineItem[]>>;
  setOpenedFolderPath: Dispatch<SetStateAction<string | null>>;
  setIsSingleFileMode: Dispatch<SetStateAction<boolean>>;
  setShowOutline: Dispatch<SetStateAction<boolean>>;
  setIsInitializing: Dispatch<SetStateAction<boolean>>;
  hasInitializedRef: MutableRefObject<boolean>;
  hasFileOpenedByEventRef: MutableRefObject<boolean>;
  hasSetupCloseListenerRef: MutableRefObject<boolean>;
  fileEditorRef: MutableRefObject<FileEditorHandle | null>;
}

/**
 * 窗口启动引导与关闭守卫：恢复上次工作区/文件、消费待打开队列，
 * 以及 check-exit / check-close 的未保存处理。
 */
export function useWindowBootstrap({
  doc,
  session,
  setFiles,
  sidebar,
  addToRecentItems,
  removeRecentItem,
  setOutline,
  setOpenedFolderPath,
  setIsSingleFileMode,
  setShowOutline,
  setIsInitializing,
  hasInitializedRef,
  hasFileOpenedByEventRef,
  hasSetupCloseListenerRef,
  fileEditorRef,
}: UseWindowBootstrapParams) {
  const { t } = useTranslation();
  const {
    currentFileRef,
    isModifiedRef,
    currentContentRef,
    fileHandleRef,
    setCurrentFile,
    setCurrentContent,
    setOriginalContent,
    setIsModified,
    setFileHandle,
    setEditorKey,
  } = doc;
  const { openFolder, executeOpenFile, startIcloudGracePeriod, verifyAndSetupIcloudGracePeriod } = session;

  // 未保存守卫的依赖快照：check-close 与插件重载共用，读当前 ref（不订阅变更）。
  const buildUnloadDeps = useCallback(() => {
    const file = currentFileRef.current;
    return {
      file,
      content: currentContentRef.current,
      isModified: isModifiedRef.current,
      isTemp: fileHandleRef.current.kind === 'temp',
      isCustomSave: resolveFileEditor(file)?.capabilities?.customSave === true,
      editor: fileEditorRef.current,
      t,
    };
  }, [t]);

  // 被禁用插件拦截的路径只提示一次：windowInfo.current_file 与 pending 队列可能指向同一文件
  const disabledNoticeRef = useRef<Set<string>>(new Set());
  // 退出流程已开始：延迟建窗回调据此放弃创建新窗口，避免应用退不掉
  const closingRef = useRef(false);
  // 延迟建窗的取消句柄（启动 effect 卸载时清理）
  const cancelExtraWindowsRef = useRef<(() => void) | null>(null);
  const notifyDisabledFile = useCallback((path: string) => {
    if (disabledNoticeRef.current.has(path)) return;
    disabledNoticeRef.current.add(path);
    toast.info(t('settings.pluginFileDisabled'));
  }, [t]);

  // 启动阶段消费「最近项目」：在创建兜底空白文档之前打开它，
  // 避免新窗口先闪一下未保存的临时文档再切到目标目录/文件。
  const openPendingRecentItem = useCallback(
    (item: string) =>
      openRecentItemPath(item, {
        t,
        openFolder,
        executeOpenFile,
        addToRecentItems,
        removeRecentItem,
        notifyDisabledFile,
        updateWindowFile,
        updateWindowFolder,
        updateWindowMode,
      }),
    [addToRecentItems, executeOpenFile, notifyDisabledFile, openFolder, removeRecentItem, t],
  );

  // 启动时检查窗口信息（用于新窗口打开文件的场景）
  useEffect(() => {
    const checkWindowInfo = async () => {
      const perfStart = performance.now();
      const logPerf = (label: string) => {
        logger.log(`[PERF] ${label}: ${(performance.now() - perfStart).toFixed(2)}ms`);
      };

      // 防止重复执行（React StrictMode 会导致组件渲染两次）
      if (hasInitializedRef.current) {
        logger.log('Window already initialized, skipping');
        return;
      }
      hasInitializedRef.current = true;

      // 标记是否已从 windowInfo.current_file 成功恢复（用于 finally 判断）
      let recovered = false;
      // 保存窗口信息供 finally 块使用（finally 无法访问 try 内的局部变量）
      let windowInfoRef: Awaited<ReturnType<typeof getWindowInfo>> | null = null;

      try {
        logPerf('Start initialization');

        // 预取临时文件列表：只有「没有任何文档可恢复」的主窗口兜底分支会消费。
        // 先发起、不等待，避免把目录扫描加到单文件/工作区恢复的关键路径上。
        // 代价：所有窗口都会多扫一次临时目录（非主窗口直接丢弃结果），这是有意的取舍。
        const tempFilesPromise = invoke<TempFile[]>('list_temp_files').catch(err => {
          logger.warn('Failed to list temp files:', err);
          return [] as TempFile[];
        });

        // 并行获取窗口信息和主窗口判断（二者独立）
        const [isMain, windowInfo] = await Promise.all([
          isMainWindow(),
          getWindowInfo().catch(err => {
            logger.warn('getWindowInfo failed, continuing with null:', err);
            return null as unknown as Awaited<ReturnType<typeof getWindowInfo>>;
          }),
        ]);
        windowInfoRef = windowInfo;
        logPerf('isMainWindow + getWindowInfo completed (temp prefetch in flight)');
        logger.log('Window info:', windowInfo);

        // 尝试从窗口信息恢复文件，失败则降级到默认流程
        const restoredFile = windowInfo?.current_file;
        if (!hasFileOpenedByEventRef.current && restoredFile) {
          try {
            const filePath = restoredFile;
            logger.log('Opening pre-loaded file from window info:', filePath);

            const opened = await openDocumentOrThrow(filePath);

            const isDirectory = opened.kind === 'directory';
            const content = isDirectory ? '' : opened.content;

            // 读取先于禁用判断是有意取舍：需要先知道是不是目录，才能决定是否按扩展名拦截。
            // 代价是禁用扩展名的文件内容会被读出来再丢弃；读取失败时走兜底，而不是提示「插件已禁用」。
            if (!isDirectory && isDisabledFileExtension(filePath)) {
              notifyDisabledFile(filePath);
            } else if (opened.kind === 'temp') {
              const fileName = filePath.split(/[/\\]/).pop() || t('file.untitledMd');
              setOpenedFolderPath(null);
              setFiles([]);
              setIsSingleFileMode(true);
              setCurrentFile(filePath);
              setFileHandle({ kind: 'temp', path: filePath });
              setCurrentContent(content);
              setOriginalContent(content);
              setIsModified(false);
              setEditorKey(prev => prev + 1);
              setOutline([]);
              logger.log('Opened unsaved file:', fileName);
              recovered = true;
            } else if (isDirectory) {
              await openFolder(filePath);
              addToRecentItems(filePath);
              recovered = true;
            } else if (windowInfo.opened_folder) {
              const folderPath = windowInfo.opened_folder;
              setOpenedFolderPath(folderPath);
              setIsSingleFileMode(false);
              sidebar.setCollapsed(windowInfo.sidebar_collapsed);
              setShowOutline(windowInfo.sidebar_show_outline);
              invoke('extend_asset_scope', { path: folderPath }).catch(err => {
                logger.warn('Failed to extend asset scope for restored folder:', err);
              });
              const dirResult = await invoke<RustFileNode[]>('read_directory', { path: folderPath });
              setFiles(createRootNode(folderPath, dirResult.map(convertFileNode)));
              startIcloudGracePeriod(filePath);
              setCurrentFile(filePath);
              setCurrentContent(content);
              setOriginalContent(content);
              setIsModified(false);
              setFileHandle({ kind: 'persistent', path: filePath, displayName: filePath.split('/').pop() || filePath.split('\\').pop() || '' });
              setEditorKey(prev => prev + 1);
              setOutline([]);
              verifyAndSetupIcloudGracePeriod(filePath);
              recovered = true;
            } else {
              logger.log('Opening file in single file mode:', filePath);
              const lastSepIdx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
              const restoreParentDir = lastSepIdx >= 0 ? filePath.slice(0, lastSepIdx) : '';
              if (restoreParentDir) {
                invoke('extend_asset_scope', { path: restoreParentDir }).catch(err => {
                  logger.warn('Failed to extend asset scope for restored file dir:', err);
                });
              }
              startIcloudGracePeriod(filePath);
              setOpenedFolderPath(null);
              setFiles([]);
              setIsSingleFileMode(true);
              setCurrentFile(filePath);
              setFileHandle({ kind: 'persistent', path: filePath, displayName: filePath.split('/').pop() || filePath.split('\\').pop() || '' });
              setCurrentContent(content);
              setOriginalContent(content);
              setIsModified(false);
              setEditorKey(prev => prev + 1);
              setOutline([]);
              sidebar.setCollapsed(true);
              addToRecentItems(filePath);
              verifyAndSetupIcloudGracePeriod(filePath);
              recovered = true;
            }
            // 显式路径获胜：仅在真正打开时消费启动工作区标记，避免刷新时重复触发未保存文件分窗口
            if (recovered && windowInfo?.is_launch_workspace) {
              clearLaunchWorkspaceFlag().catch(err => {
                logger.warn('Failed to clear launch workspace flag:', err);
              });
            }
          } catch (error) {
            logger.warn('Failed to restore file from window info, falling back:', error);
          }
        }

        if (!recovered) {
          // 没有预加载的文件，检查待处理队列（应用启动时通过右键打开）
          const pendingFile = await invoke<string | null>('check_pending_open_file');
          if (pendingFile) {
            logger.log('Opening pending file from queue:', pendingFile);

            // 检查是否为目录
            const opened = await openDocumentOrThrow(pendingFile);
            const pendingDisabled =
              opened.kind !== 'directory' && isDisabledFileExtension(pendingFile);

            if (pendingDisabled) {
              // 所属插件被禁用时，该文件类型视为不可打开：不读取、不打开
              // 不置 recovered、不 return，以便回退到 opened_folder 恢复或默认空/临时文档
              notifyDisabledFile(pendingFile);
            } else {
              startIcloudGracePeriod(pendingFile);
              if (opened.kind === 'directory') {
                await openFolder(pendingFile);
                await addToRecentItems(pendingFile);
                await updateWindowFile(null);
                await updateWindowFolder(pendingFile);
                await updateWindowMode(false);
              } else {
                // 单文件打开不经过对话框，扩权所在目录以加载文档已有的图片引用
                const lastSepIdx = Math.max(pendingFile.lastIndexOf('/'), pendingFile.lastIndexOf('\\'));
                const pendingParentDir = lastSepIdx >= 0 ? pendingFile.slice(0, lastSepIdx) : '';
                if (pendingParentDir) {
                  invoke('extend_asset_scope', { path: pendingParentDir }).catch(err => {
                    logger.warn('Failed to extend asset scope for pending file dir:', err);
                  });
                }
                const content = opened.content;

                setOpenedFolderPath(null);
                setFiles([]);
                setIsSingleFileMode(true);
                setCurrentFile(pendingFile);

                setFileHandle({ kind: 'persistent', path: pendingFile, displayName: pendingFile.split('/').pop() || pendingFile.split('\\').pop() || '' });
                setCurrentContent(content);
                setOriginalContent(content);
                setIsModified(false);
                setEditorKey(prev => prev + 1);
                setOutline([]);
                sidebar.setCollapsed(true);

                await addToRecentItems(pendingFile);
                verifyAndSetupIcloudGracePeriod(pendingFile);
                await updateWindowFile(pendingFile);
                await updateWindowMode(true);
              }

              // 显式路径获胜：消费启动工作区标记，避免刷新时重复触发未保存文件分窗口
              if (windowInfo?.is_launch_workspace) {
                clearLaunchWorkspaceFlag().catch(err => {
                  logger.warn('Failed to clear launch workspace flag:', err);
                });
              }
              recovered = true;
              return;
            }
          }

          // 原生菜单「最近项目」创建的新窗口：目录/文件路径由后端暂存。
          // 必须在创建兜底空白文档之前消费，否则会先闪一下未保存的临时文档。
          if (!recovered) {
            const pendingRecentItem = await takePendingRecentItem().catch(err => {
              logger.warn('Failed to take pending recent item:', err);
              return null;
            });
            if (pendingRecentItem) {
              logger.log('Opening pending recent item from startup:', pendingRecentItem);
              try {
                recovered = await openPendingRecentItem(pendingRecentItem);
              } catch (err) {
                logger.warn('Failed to open pending recent item:', err);
              }
              if (recovered) return;
            }
          }

          // 从 windowInfo 恢复打开的文件夹：
          // - 页面刷新场景：恢复上次打开的文件夹
          // - 启动注入场景：后端预置 opened_folder（默认工作区）
          if (windowInfo?.opened_folder) {
            logger.log('Restoring folder from windowInfo (page refresh):', windowInfo.opened_folder);
            const folderPath = windowInfo.opened_folder;
            // 启动注入的默认工作区：未保存文件全部在新窗口恢复（方案 C）
            if (windowInfo.is_launch_workspace) {
              // 复用启动早期发起的预取：本分支仍**同步**创建窗口（工作区启动时先把未保存
              // 文件分出去），与下面兜底分支的「延迟建窗」不同，这里不要改成 defer。
              const allTempFiles = await tempFilesPromise;
              // 跳过扩展名属于被禁用插件的 temp 文件：不建窗口，保留在磁盘
              const tempFiles = allTempFiles.filter((f) => {
                if (isDisabledFileExtension(f.path)) {
                  notifyDisabledFile(f.path);
                  return false;
                }
                return true;
              });
              for (const file of tempFiles) {
                try {
                  await createNewWindow(file.path);
                } catch (e) {
                  console.error('Failed to create window for unsaved file:', e);
                }
              }
              // 一次性消费标记：此后刷新不再重复执行未保存文件分窗口恢复
              clearLaunchWorkspaceFlag().catch(err => {
                logger.warn('Failed to clear launch workspace flag:', err);
              });
            }
            // 沙盒环境：先恢复书签访问权限；书签缺失/失效时立即走“重新选择目录”
            const accessStarted = await invoke('start_access', { path: folderPath })
              .then(() => true)
              .catch(err => {
                logger.warn('Failed to resolve bookmark access for workspace:', err);
                return false;
              });
            // 恢复目录不经过对话框，扩权目录以加载文档已有的图片引用
            invoke('extend_asset_scope', { path: folderPath }).catch(err => {
              logger.warn('Failed to extend asset scope for restored folder:', err);
            });
            setOpenedFolderPath(folderPath);
            setIsSingleFileMode(false);
            sidebar.setCollapsed(windowInfo.sidebar_collapsed);
            setShowOutline(windowInfo.sidebar_show_outline);
            try {
              if (!accessStarted) {
                throw new Error('Workspace folder access not restored');
              }
              const result = await invoke<RustFileNode[]>('read_directory', { path: folderPath });
              setFiles(createRootNode(folderPath, result.map(convertFileNode)));
              addToRecentItems(folderPath);
            } catch (error) {
              // 工作区目录不可访问（书签失效/目录被移动/权限被撤销）：
              // 引导用户通过系统目录选择器重新选择，而不是直接报错
              console.error('Failed to restore workspace folder:', error);
              const selected = await open({
                directory: true,
                multiple: false,
                defaultPath: folderPath,
                title: t('dialog.selectFolder'),
              });
              if (selected && typeof selected === 'string') {
                // 重新授权并打开（访问与扩权由 create_bookmark 统一处理）
                await invoke('create_bookmark', { path: selected }).catch(() => {});
                try {
                  const result = await invoke<RustFileNode[]>('read_directory', { path: selected });
                  setOpenedFolderPath(selected);
                  setFiles(createRootNode(selected, result.map(convertFileNode)));
                  addToRecentItems(selected);
                  await updateWindowFolder(selected);
                  // 工作区模式（启动注入）：同步更新配置，避免下次启动再次失效
                  if (windowInfo.is_launch_workspace) {
                    try {
                      const cfg = await readAppConfig<any>();
                      await writeAppConfig({ ...cfg, workspace_folder: selected });
                      logger.log('Updated workspace folder config to:', selected);
                    } catch (e) {
                      logger.warn('Failed to update workspace folder config:', e);
                    }
                  }
                } catch (e2) {
                  console.error('Failed to open re-selected folder:', e2);
                  alert(t('error.openFolderFailed', { error: String(e2) }));
                  setOpenedFolderPath(null);
                  setFiles([]);
                  setIsSingleFileMode(true);
                  const newFile = await invoke<TempFile>('create_temp_file', { content: '' });
                  setCurrentFile(newFile.path);
                  setFileHandle({ kind: 'temp', path: newFile.path });
                  setCurrentContent('');
                  setOriginalContent('');
                  setIsModified(false);
                  setEditorKey(prev => prev + 1);
                  sidebar.setCollapsed(true);
                }
              } else {
                // 用户取消：回退空白文档，配置保留
                setOpenedFolderPath(null);
                setFiles([]);
                setIsSingleFileMode(true);
                const newFile = await invoke<TempFile>('create_temp_file', { content: '' });
                setCurrentFile(newFile.path);
                setFileHandle({ kind: 'temp', path: newFile.path });
                setCurrentContent('');
                setOriginalContent('');
                setIsModified(false);
                setEditorKey(prev => prev + 1);
                sidebar.setCollapsed(true);
              }
            }
            recovered = true;
            setIsInitializing(false);
            logPerf('openFolder from windowInfo completed');
            return;
          }

          // 默认打开空白编辑器，不再从 localStorage 自动恢复上次打开的目录
          // 如需恢复文件夹，请使用最近访问列表手动打开

          // 没有预加载的文件，直接进入编辑页
          try {
            logger.log('Starting with editor, isMain:', isMain);

            if (isMain) {
              // 主窗口：恢复所有未保存文件（列表已在启动早期预取）
              const allTempFiles = await tempFilesPromise;
              logPerf('list_temp_files');

              // 跳过扩展名属于被禁用插件的 temp 文件：不读取、不打开，保留在磁盘
              const tempFiles = allTempFiles.filter(f => {
                if (isDisabledFileExtension(f.path)) {
                  notifyDisabledFile(f.path);
                  return false;
                }
                return true;
              });

              if (tempFiles.length > 0) {
                // 恢复第一个未保存文件到主窗口
                const firstFile = tempFiles[0];
                const content = await invoke<string>('read_temp_file', {
                  path: firstFile.path
                });
                logPerf('read_temp_file');

                setOpenedFolderPath(null);
                setFiles([]);
                setIsSingleFileMode(true);
                setCurrentFile(firstFile.path);

                setFileHandle({ kind: 'temp', path: firstFile.path });
                setCurrentContent(content);
                setOriginalContent(content);
                setIsModified(false);
                setEditorKey(prev => prev + 1);
                sidebar.setCollapsed(true);

                // 为其他未保存文件创建新窗口：首屏之后再做，避免阻塞窗口出现。
                // 临时文件列表是启动早期（t0）的快照；同进程内不会有其他窗口在此期间创建新的临时文件。
                const extraTempPaths = tempFiles.slice(1).map((file) => file.path);
                if (extraTempPaths.length > 0) {
                  cancelExtraWindowsRef.current = deferAfterFirstPaint(() => {
                    if (closingRef.current) return;
                    void (async () => {
                      for (const path of extraTempPaths) {
                        // 每建一窗都复查：退出流程可能在中途开始
                        if (closingRef.current) return;
                        try {
                          await createNewWindow(path);
                        } catch (e) {
                          console.error('Failed to create window for unsaved file:', e);
                        }
                      }
                    })();
                  });
                }
              } else {
                // 没有未保存文件，创建新的临时文件
                const newFile = await invoke<TempFile>('create_temp_file', { content: '' });
                setOpenedFolderPath(null);
                setFiles([]);
                setIsSingleFileMode(true);
                setCurrentFile(newFile.path);
          
                setFileHandle({ kind: 'temp', path: newFile.path });
                setCurrentContent('');
                setOriginalContent('');
                setIsModified(false);
                sidebar.setCollapsed(true);
              }
            } else {
              // 其他窗口：创建新的临时文件
              const newFile = await invoke<TempFile>('create_temp_file', { content: '' });
              setOpenedFolderPath(null);
              setFiles([]);
              setIsSingleFileMode(true);
              setCurrentFile(newFile.path);
        
              setFileHandle({ kind: 'temp', path: newFile.path });
              setCurrentContent('');
              setOriginalContent('');
              setIsModified(false);
              sidebar.setCollapsed(true);
            }
            logPerf('editor setup complete');
          } catch (error) {
            console.error('Failed to setup editor:', error);
          }
        }
      } catch (error) {
        console.error('Failed to check window info:', error);
      } finally {
        setIsInitializing(false);
        logPerf('Initialization complete');

        // 通知后端窗口已就绪，获取待打开的文件路径
        try {
          const pendingFile = await notifyWindowReady();
          logger.log('Window ready notification sent, pending file:', pendingFile);

          // 如果有待打开的文件且尚未恢复，打开它（避免与 windowInfo.current_file 重复）
          if (!recovered && pendingFile) {
            logger.log('Opening file from window ready:', pendingFile);
            try {
              const opened = await openDocumentOrThrow(pendingFile);
              const pendingDisabled =
                opened.kind !== 'directory' && isDisabledFileExtension(pendingFile);

              if (pendingDisabled) {
                // 所属插件被禁用时，该文件类型视为不可打开：不读取、不打开
                notifyDisabledFile(pendingFile);
              } else {
                startIcloudGracePeriod(pendingFile);
                if (opened.kind === 'directory') {
                  await openFolder(pendingFile);
                  await addToRecentItems(pendingFile);
                  await updateWindowFile(null);
                  await updateWindowFolder(pendingFile);
                  await updateWindowMode(false);
                } else {
                  // 单文件打开不经过对话框，扩权所在目录以加载文档已有的图片引用
                  const lastSepIdx = Math.max(pendingFile.lastIndexOf('/'), pendingFile.lastIndexOf('\\'));
                  const readyParentDir = lastSepIdx >= 0 ? pendingFile.slice(0, lastSepIdx) : '';
                  if (readyParentDir) {
                    invoke('extend_asset_scope', { path: readyParentDir }).catch(err => {
                      logger.warn('Failed to extend asset scope for ready file dir:', err);
                    });
                  }
                  const content = opened.content;

                  setOpenedFolderPath(null);
                  setFiles([]);
                  setIsSingleFileMode(true);
                  setCurrentFile(pendingFile);

                  setFileHandle({ kind: 'persistent', path: pendingFile, displayName: pendingFile.split('/').pop() || pendingFile.split('\\').pop() || '' });
                  setCurrentContent(content);
                  setOriginalContent(content);
                  setIsModified(false);
                  setEditorKey(prev => prev + 1);
                  setOutline([]);
                  sidebar.setCollapsed(true);

                  await addToRecentItems(pendingFile);
                  verifyAndSetupIcloudGracePeriod(pendingFile);
                  await updateWindowFile(pendingFile);
                  await updateWindowMode(true);
                }

                // 显式路径获胜：消费启动工作区标记，避免刷新时重复触发未保存文件分窗口
                if (windowInfoRef?.is_launch_workspace) {
                  clearLaunchWorkspaceFlag().catch(err => {
                    logger.warn('Failed to clear launch workspace flag:', err);
                  });
                }
              }
            } catch (error) {
              console.error('Failed to open file from window ready:', error);
            }
          }
        } catch (e) {
          console.error('Failed to notify window ready:', e);
        }
      }
    };

    checkWindowInfo();
  }, [addToRecentItems, openPendingRecentItem]);

  // 只在真正卸载时取消已排期的额外窗口创建。
  // 不能放在启动 effect 的 cleanup 里：该 effect 依赖会变化（如语言切换改变 `t`
  // ⇒ openPendingRecentItem 身份变化），重跑时会取消建窗，而 `hasInitializedRef`
  // 早退不会重排，其它未保存文档本次启动就静默不恢复了。
  useEffect(() => () => {
    cancelExtraWindowsRef.current?.();
    cancelExtraWindowsRef.current = null;
  }, []);

  // 监听退出检查事件
  useEffect(() => {
    logger.log('Setting up check-exit listener');
    const unlisten = listen('check-exit', async () => {
      logger.log('check-exit event received');
      // 退出流程开始：后续的延迟建窗回调必须放弃，否则应用退不掉
      closingRef.current = true;
      try {
        // 检查当前窗口是否有未保存的更改或临时文件有内容
        // 由文件类型编辑器自行保存的文件：以编辑器自身的修改状态为准
        const customSave = resolveFileEditor(currentFileRef.current)?.capabilities?.customSave === true;
        const hasUnsaved = customSave
          ? isModifiedRef.current
          : (currentContentRef.current.trim() &&
            (isModifiedRef.current || fileHandleRef.current.kind === 'temp'));
        if (hasUnsaved) {
          const confirmed = await confirm(t('unsavedChanges.confirmExit'), { title: t('unsavedChanges.title'), kind: 'warning' });
          logger.log('confirm result:', confirmed);
          if (confirmed) {
            await exit(0);
          } else {
            // 用户取消退出：解除关闭态，延迟建窗仍可正常进行
            closingRef.current = false;
          }
        } else {
          await exit(0);
        }
      } catch (e) {
        console.error('Error in check-exit handler:', e);
        closingRef.current = false;
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  // 监听窗口关闭检查事件
  useEffect(() => {
    logger.log('Setting up check-close listener');

    // 防止重复执行（React StrictMode 会导致组件渲染两次）
    if (hasSetupCloseListenerRef.current) {
      logger.log('Window already initialized, skipping check-close listener setup');
      return;
    }
    hasSetupCloseListenerRef.current = true;

    let isClosing = false;
    let unlistenFn: (() => void) | null = null;

    // 获取当前窗口，只监听发送给当前窗口的事件
    const setupListener = async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const currentWindow = getCurrentWindow();

      unlistenFn = await currentWindow.listen('check-close', async () => {
        // 防止重复处理
        if (isClosing) {
          logger.log('Already closing, ignoring');
          return;
        }
        isClosing = true;

        const file = currentFileRef.current;
        logger.log('check-close event received, isModified:', isModifiedRef.current, 'file:', file);

        try {
          const prep = await prepareWindowUnload(buildUnloadDeps());
          if (!prep.proceed) {
            isClosing = false;
            invoke('cancel_quit').catch(() => {});
            return;
          }
          if (prep.deleteTemp && file) {
            await invoke('delete_temp_file', { path: file }).catch(() => {});
          }
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const window = getCurrentWindow();
          await invoke('unregister_window', { window });
          await window.destroy();
        } catch (error) {
          console.error('Error in check-close handler:', error);
          isClosing = false;
          invoke('cancel_quit').catch(() => {});
        }
      });
    };

    setupListener();

    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, []);

  // 插件启用变更：非设置窗口在未保存守卫通过后重载，使新插件配置生效。
  useEffect(() => {
    return subscribePluginReload({
      beforeReload: async () => {
        const deps = buildUnloadDeps();
        const prep = await prepareWindowUnload(deps);
        if (!prep.proceed) return false;
        await applyUnloadPreparation(prep, deps.file, {
          updateWindowFile: (path) => updateWindowFile(path),
          deleteTempFile: (path) => invoke('delete_temp_file', { path }),
        });
        return true;
      },
      reload: () => window.location.reload(),
    });
  }, [buildUnloadDeps]);
}
