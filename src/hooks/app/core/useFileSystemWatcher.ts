import { useCallback, type MutableRefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/utils/logger';
import { useFileWatcher, type FsEvent } from '@/hooks/useFileWatcher';
import { isContentCandidate, isFsEventForPath, isMetadataKind } from '@/utils/externalChange';
import { resolveFileEditor } from '@/plugins/registry';
import type { FileEditorHandle } from '@/plugins/types';
import type { useDocumentState } from './useDocumentState';
import type { useExternalChangeGuard } from './useExternalChangeGuard';

type DocumentState = ReturnType<typeof useDocumentState>;
type ExternalChangeGuard = ReturnType<typeof useExternalChangeGuard>;

interface UseFileSystemWatcherParams {
  doc: DocumentState;
  guard: ExternalChangeGuard;
  scheduleDirectoryRefresh: () => void;
  fileEditorRef: MutableRefObject<FileEditorHandle | null>;
  openedFolderPath: string | null;
  watchExternalChanges: boolean;
}

/**
 * 文件系统监听：把 fs 事件分派到外部变更/删除处理，并刷新目录树。
 * 依赖文档状态与外部变更守卫层，自身不向 App 暴露额外接口。
 */
export function useFileSystemWatcher({
  doc,
  guard,
  scheduleDirectoryRefresh,
  fileEditorRef,
  openedFolderPath,
  watchExternalChanges,
}: UseFileSystemWatcherParams) {
  const {
    fileHandleRef,
    currentFileRef,
    currentFileDeletedRef,
    ignoreExternalModifyRef,
    clearCurrentFileDeleted,
    setCurrentFile,
    currentFile,
  } = doc;
  const { handleCurrentFileExternalChange, markCurrentFileDeleted } = guard;

  // 文件监听事件处理
  const handleFsCreate = useCallback((event: FsEvent) => {
    logger.log('[App] File created:', event.path);
    // 当前文件“删除后同名重建”：视为外部替换，做内容比对/静默刷新/冲突提示
    if (isFsEventForPath(currentFileRef.current, event.path, event.isDirectory)) {
      if (currentFileDeletedRef.current) {
        logger.log('[App] Current file recreated after deletion, verifying content:', event.path);
        clearCurrentFileDeleted();
        handleCurrentFileExternalChange(event.path, {
          size: event.size,
          mtimeMs: event.mtimeMs ?? event.mtime_ms,
        });
      }
    }
    // 延迟刷新以避免重复操作导致的竞态
    scheduleDirectoryRefresh();
  }, [clearCurrentFileDeleted, handleCurrentFileExternalChange, currentFileRef, currentFileDeletedRef, scheduleDirectoryRefresh]);

  const handleFsRemove = useCallback((event: FsEvent) => {
    logger.log('[App] File removed:', event.path);
    // 当前打开的文件被删除时不清空编辑器：删除通常是“替换保存”的前半段
    // （临时文件覆盖 / 云盘回写），也可能确实是外部删除；两种情况都保留缓冲。
    if (isFsEventForPath(currentFileRef.current, event.path, event.isDirectory)) {
      markCurrentFileDeleted();
    }
    scheduleDirectoryRefresh();
  }, [markCurrentFileDeleted, currentFileRef, scheduleDirectoryRefresh]);

  const handleFsRename = useCallback((event: FsEvent) => {
    logger.log('[App] File renamed:', event.oldPath, '->', event.path);
    // 如果重命名的是当前打开的文件，更新当前文件路径
    if (currentFileRef.current === event.oldPath) {
      setCurrentFile(event.path);
    }
    // 原子替换保存（外部编辑器写临时文件再覆盖当前文件）：新路径就是当前文件，
    // 按内容变更处理，否则删除内容后保存不会刷新编辑器
    if (isFsEventForPath(currentFileRef.current, event.path, event.isDirectory)) {
      logger.log('[App] Current file replaced via rename, verifying content:', event.path);
      if (currentFileDeletedRef.current) {
        logger.log('[App] Rename event confirms file recovery, clearing deleted state:', event.path);
        clearCurrentFileDeleted();
      }
      handleCurrentFileExternalChange(event.path, {
        size: event.size,
        mtimeMs: event.mtimeMs ?? event.mtime_ms,
      });
    }
    scheduleDirectoryRefresh();
  }, [handleCurrentFileExternalChange, clearCurrentFileDeleted, currentFileRef, currentFileDeletedRef, setCurrentFile, scheduleDirectoryRefresh]);

  const handleFsModify = useCallback(async (event: FsEvent) => {
    // 如果是临时文件（未保存文件），不处理外部修改检测
    // 临时文件由应用内部管理，不需要外部修改提示
    if (fileHandleRef.current.kind === 'temp') {
      if (
        isFsEventForPath(currentFileRef.current, event.path, event.isDirectory) &&
        currentFileDeletedRef.current
      ) {
        clearCurrentFileDeleted();
      }
      logger.log('[App] Ignoring modify event for unsaved file:', event.path);
      return;
    }

    // 只处理内容类候选：data（原地写入）或 any（macOS 上原子替换保存产生 Name(Any) 事件）
    // metadata 类型直接忽略
    const contentCandidate =
      isContentCandidate(event.modifyKind) || isContentCandidate((event as any).modify_kind);
    if (!contentCandidate) {
      // 目录修改、以及文件上的扩展属性修改都要刷新目录树：
      // Finder 改标签颜色只写扩展属性（Metadata 事件），不刷新的话圆点会停在旧颜色
      const metadataModified =
        isMetadataKind(event.modifyKind) || isMetadataKind((event as any).modify_kind);
      if (event.isDirectory || metadataModified) {
        logger.log('[App] Directory/metadata modified:', event.path);
        scheduleDirectoryRefresh();
      }
      return;
    }

    logger.log('[App] File data modified:', event.path, 'isDirectory:', event.isDirectory, 'modifyKind:', event.modifyKind, 'currentFile:', currentFileRef.current);

      // 检查是否是当前打开的文件被外部修改
    if (isFsEventForPath(currentFileRef.current, event.path, event.isDirectory)) {
      logger.log('[App] Current file data modified, checking filters...');

      // 若此前文件短暂消失后重建，modify 事件也可视为恢复完成
      if (currentFileDeletedRef.current) {
        logger.log('[App] Modify event confirms file recovery, clearing deleted state:', event.path);
        clearCurrentFileDeleted();
      }

      // 由文件类型编辑器自行处理外部修改的文件，交给其通用句柄
      // （同一窗口只有一个 Rust 监听订阅，App 负责收事件并转发）
      if (resolveFileEditor(currentFileRef.current)?.capabilities?.externalModify) {
        fileEditorRef.current?.handleExternalModify?.();
        return;
      }

      // macOS FSEvents 把“移出目录/移到废纸篓”报成 Modify(Name(Any))：
      // 事件路径此时已不存在，stat 为空。探测不到文件时按“被删除/移走”处理，
      // 保留缓冲并标记，而不是尝试刷新内容或弹冲突框。
      if (event.size == null && event.mtimeMs == null && event.mtime_ms == null) {
        try {
          const type = await invoke<string>('check_path_type', { path: event.path });
          if (type !== 'file') {
            logger.log('[App] Current file moved away (path gone), marking deleted:', event.path);
            markCurrentFileDeleted();
            return;
          }
        } catch {
          logger.log('[App] Current file path gone, marking deleted:', event.path);
          markCurrentFileDeleted();
          return;
        }
      }

      // 检查是否应该忽略此修改（应用自身保存的短暂窗口）
      if (ignoreExternalModifyRef.current.has(event.path)) {
        logger.log('[App] Ignoring external data modify for file (in ignore list):', event.path);
        return;
      }

      await handleCurrentFileExternalChange(event.path, {
        size: event.size,
        mtimeMs: event.mtimeMs ?? event.mtime_ms,
      });
      return;
    } else {
      // 不是当前打开的文件
      logger.log('[App] Other file data modified:', event.path, 'currentFile:', currentFileRef.current);
    }

    // macOS 上重命名操作可能被识别为 Modify 事件
    // 因此需要刷新目录树来同步文件列表
    scheduleDirectoryRefresh();
  }, [handleCurrentFileExternalChange, clearCurrentFileDeleted, markCurrentFileDeleted, fileHandleRef, currentFileRef, currentFileDeletedRef, ignoreExternalModifyRef, fileEditorRef, scheduleDirectoryRefresh]);

  // 计算文件监听路径：文件夹模式下使用 openedFolderPath，单文件模式下使用文件所在目录
  const watchPath = openedFolderPath || (currentFile ? currentFile.substring(0, currentFile.lastIndexOf('/')) : null);

  // 启用文件监听（根据设置决定是否启用）
  useFileWatcher({
    rootPath: watchPath,
    onCreate: handleFsCreate,
    onRemove: handleFsRemove,
    onRename: handleFsRename,
    onModify: handleFsModify,
    enabled: !!watchPath && watchExternalChanges,
  });
}
