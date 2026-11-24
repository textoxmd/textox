import { useCallback, useEffect, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/utils/logger';
import { ICLOUD_GRACE_DURATION } from '@/app/constants';
import { showSaveConflictDialog } from '@/components/FileModifiedDialog';
import {
  hashContent,
  isDiskContentUnchanged,
  statMatchesFingerprint,
  uniqueKnownContents,
  type EventStat,
  type FileContentStatus,
  type FileMetadata,
} from '@/utils/externalChange';
import type { useDocumentState } from './useDocumentState';
import type { EditorSavePoint } from '@/components/TextoEditor/src/history/session';
import type { TextoEditorRef } from '@/components/TextoEditor/TextoEditorRef';

type DocumentState = ReturnType<typeof useDocumentState>;

interface DiskComparisonResult {
  changed: boolean;
  readable: boolean;
  size?: number;
  mtimeMs?: number | null;
}

/**
 * 外部变更 / 保存冲突守卫：指纹比对、磁盘内容比较、保存前冲突检查、
 * 直接写回、外部修改的统一处理（静默刷新 / 冲突弹窗）、删除标记，以及 iCloud 宽限期。
 * 只依赖文档状态层。
 */
export function useExternalChangeGuard(
  doc: DocumentState,
  silentExternalChanges: boolean,
  editorRef: RefObject<TextoEditorRef | null>,
) {
  const { t } = useTranslation();
  const {
    fileFingerprintRef,
    lastWrittenContentRef,
    ignoreExternalModifyRef,
    externalConflictRef,
    conflictPromptedRef,
    currentContentRef,
    originalContentRef,
    currentFileRef,
    currentFileDeletedRef,
    deletedReconcileTimerRef,
    icloudSyncWindowRef,
    icloudSyncTimersRef,
    setCurrentContent,
    setOriginalContent,
    setIsModified,
    setEditorKey,
    setHasExternalConflict,
    setCurrentFileDeleted,
    clearCurrentFileDeleted,
  } = doc;

  // 查询并记录文件当前 stat（修改时间 + 大小）
  const updateFileFingerprint = useCallback(async (path: string) => {
    try {
      const meta = await invoke<{ size: number; mtimeMs: number | null }>('get_file_metadata', { path });
      fileFingerprintRef.current.set(path, { size: meta.size, mtimeMs: meta.mtimeMs });
      return true;
    } catch (error) {
      console.error('[App] Failed to get file metadata:', error);
      return false;
    }
  }, [fileFingerprintRef]);

  // 静默加载文件最新内容（无未保存修改时外部变更的默认处理）
  const silentReloadFile = useCallback(async (path: string) => {
    try {
      const content = await invoke<string>('read_file', { path });
      currentContentRef.current = content;
      originalContentRef.current = content;
      lastWrittenContentRef.current.delete(path);
      setCurrentContent(content);
      setOriginalContent(content);
      setIsModified(false);
      // 磁盘内容已在原位替换编辑器内容，把会话保存点推进到当前状态：
      // 此后撤销栈里的旧步骤不再是「相对磁盘」的差异。
      editorRef.current?.markSaved();
      clearExternalConflict(path);
      updateFileFingerprint(path);
      if (currentFileRef.current === path) clearCurrentFileDeleted();
      logger.log('[App] File silently reloaded:', path);
      return true;
    } catch (error) {
      console.error('[App] Failed to silently reload file:', error);
      return false;
    }
  }, [updateFileFingerprint, clearCurrentFileDeleted, currentContentRef, originalContentRef, lastWrittenContentRef, setCurrentContent, setOriginalContent, setIsModified, currentFileRef, editorRef]);

  // 比较磁盘内容与已知内容：优先走 Rust 哈希比对（大内容不经过 IPC），失败时回退整文件读取
  const compareDiskContent = useCallback(
    async (
      path: string,
      knownContents: ReadonlyArray<string | undefined>,
    ): Promise<DiskComparisonResult> => {
      const unique = uniqueKnownContents(knownContents);
      if (unique.length > 0) {
        try {
          const expectedHashes = await Promise.all(unique.map(hashContent));
          const status = await invoke<FileContentStatus>('compare_file_content', {
            path,
            expectedHashes,
          });
          return { changed: status.changed, readable: true, size: status.size, mtimeMs: status.mtimeMs };
        } catch (error) {
          console.warn('[App] Hash comparison failed, falling back to full read:', error);
        }
      }
      try {
        const diskContent = await invoke<string>('read_file', { path });
        return { changed: !isDiskContentUnchanged(diskContent, knownContents), readable: true };
      } catch {
        return { changed: true, readable: false };
      }
    },
    [],
  );

  // 保存前检查磁盘内容是否已被外部修改（save-time conflict check）
  const checkSaveConflict = useCallback(async (path: string): Promise<boolean> => {
    // 廉价路径：磁盘 stat 与已知状态一致 → 无冲突，不用读内容
    const fingerprint = fileFingerprintRef.current.get(path);
    if (fingerprint) {
      try {
        const meta = await invoke<FileMetadata>('get_file_metadata', { path });
        if (statMatchesFingerprint(fingerprint, meta)) {
          return false;
        }
      } catch {
        // stat 查询失败时回退到内容比对
      }
    }

    const result = await compareDiskContent(path, [originalContentRef.current]);
    // 读取失败（如文件被删除）时不阻塞保存
    if (!result.readable) return false;
    // 确认无冲突时刷新指纹，让后续 stat 快路径继续生效（避免每次自动保存都整文件读取）
    if (!result.changed && result.size != null && result.mtimeMs != null) {
      fileFingerprintRef.current.set(path, { size: result.size, mtimeMs: result.mtimeMs });
    }
    return result.changed;
  }, [compareDiskContent, fileFingerprintRef, originalContentRef]);

  // 记录外部修改冲突（脏文件被外部修改）
  const markExternalConflict = useCallback((path: string) => {
    externalConflictRef.current.add(path);
    setHasExternalConflict(true);
  }, [externalConflictRef, setHasExternalConflict]);

  const clearExternalConflict = useCallback((path?: string) => {
    if (path) {
      externalConflictRef.current.delete(path);
      conflictPromptedRef.current.delete(path);
    } else {
      externalConflictRef.current.clear();
      conflictPromptedRef.current.clear();
    }
    setHasExternalConflict(false);
  }, [externalConflictRef, conflictPromptedRef, setHasExternalConflict]);

  // 直接写入文件并更新基线（覆盖外部修改 / 正常保存共用）
  // savePoint 来自编辑器会话：写盘成功后把保存点推进到该代次；缺失时（覆盖冲突、
  // 重建已删除文件等）退化为「当前状态即保存点」。
  const performWrite = useCallback(async (
    path: string,
    content: string,
    savePoint?: EditorSavePoint | null,
  ): Promise<boolean> => {
      ignoreExternalModifyRef.current.add(path);
    try {
      await invoke('write_file', { path, content });
      originalContentRef.current = content;
      lastWrittenContentRef.current.set(path, content);
      clearExternalConflict(path);
      updateFileFingerprint(path);
      if (currentFileRef.current === path) clearCurrentFileDeleted();
      setOriginalContent(content);
      if (savePoint) {
        editorRef.current?.confirmSavePoint(savePoint.stateId, savePoint.sessionId, savePoint.saveSeq);
      } else {
        editorRef.current?.markSaved();
      }
      // 写盘期间的新编辑仍算未保存（保存点代次落后于当前状态）
      setIsModified(editorRef.current?.isDirty() ?? false);
      return true;
    } catch (error) {
      console.error('[App] Failed to write file:', error);
      alert(t('error.saveFailed', { error }));
      return false;
    } finally {
      setTimeout(() => ignoreExternalModifyRef.current.delete(path), 3000);
    }
  }, [t, updateFileFingerprint, clearCurrentFileDeleted, ignoreExternalModifyRef, originalContentRef, lastWrittenContentRef, currentFileRef, setOriginalContent, setIsModified, clearExternalConflict, editorRef]);

  // 处理外部文件修改 - 刷新后编辑
  const reloadCurrentFile = useCallback(async (filePath: string) => {
    try {
      // 重新读取文件内容
      const content = await invoke<string>('read_file', { path: filePath });

      // 更新编辑器内容
      currentContentRef.current = content;
      originalContentRef.current = content;
      lastWrittenContentRef.current.delete(filePath);
      setCurrentContent(content);
      setOriginalContent(content);
      setIsModified(false);
      setEditorKey(prev => prev + 1);
      updateFileFingerprint(filePath);

      logger.log('[App] File reloaded after external modification:', filePath);
    } catch (error) {
      console.error('[App] Failed to reload file:', error);
      alert(t('error.reloadFailed', { error }));
    }

    // 从忽略列表中移除（允许后续再次检测）
    ignoreExternalModifyRef.current.delete(filePath);
    clearExternalConflict(filePath);
  }, [t, clearExternalConflict, updateFileFingerprint, currentContentRef, originalContentRef, lastWrittenContentRef, setCurrentContent, setOriginalContent, setIsModified, setEditorKey, ignoreExternalModifyRef]);

  // 弹冲突确认框（事件触发与自动保存兜底共用；同一冲突只弹一次，避免重复打扰）
  const promptConflictDialog = useCallback(async (path: string, displayName: string) => {
    if (conflictPromptedRef.current.has(path)) {
      logger.log('[App] Conflict dialog already shown for file:', path);
      return;
    }
    conflictPromptedRef.current.add(path);
    markExternalConflict(path);
    logger.log('[App] Showing conflict dialog:', path);
    const conflictAction = await showSaveConflictDialog(displayName);
    if (conflictAction === 'cancel') {
      logger.log('[App] Conflict dialog dismissed, conflict kept:', path);
      return;
    }
    if (conflictAction === 'reload') {
      await reloadCurrentFile(path);
      return;
    }
    // overwrite：立即用当前编辑器内容覆盖磁盘
    logger.log('[App] User chose to overwrite external changes:', path);
    await performWrite(path, currentContentRef.current);
  }, [markExternalConflict, reloadCurrentFile, performWrite, conflictPromptedRef, currentContentRef]);

  // 切换/关闭文件时清除外部修改冲突状态
  useEffect(() => {
    externalConflictRef.current.clear();
    conflictPromptedRef.current.clear();
    fileFingerprintRef.current.clear();
    setHasExternalConflict(false);
    clearCurrentFileDeleted();
  }, [doc.currentFile, clearCurrentFileDeleted, externalConflictRef, conflictPromptedRef, fileFingerprintRef, setHasExternalConflict]);

  // 校验磁盘内容是否真的与编辑器已知内容不同
  // macOS 的 FSEvents 会把 chmod/touch/xattr 等纯元数据变化也上报为内容修改，
  // 自身保存的回显事件也可能延迟到达，因此弹窗前必须用内容比对兜底。
  // 先走 stat 廉价过滤（修改时间 + 大小没变 → 直接判定无变化，不读文件内容）
  const verifyExternalContentChange = useCallback(
    async (path: string, eventStat?: EventStat): Promise<boolean> => {
      const fingerprint = fileFingerprintRef.current.get(path);
      if (statMatchesFingerprint(fingerprint, eventStat)) {
        logger.log('[App] File stat unchanged, ignoring modify event:', path);
        return false;
      }

      const knownContents = [
        lastWrittenContentRef.current.get(path),
        originalContentRef.current,
        currentContentRef.current,
      ];
      const result = await compareDiskContent(path, knownContents);
      // 读取失败时无法比对，保守按"已变更"处理，保持原有提示逻辑
      if (!result.readable) {
        console.error('[App] Failed to verify external modify, assuming changed:', path);
        return true;
      }
      // 仅当磁盘内容与已知内容一致时更新指纹（代表"已确认的安全状态"）；
      // 真实外部修改时保持指纹陈旧，让保存/自动保存的内容比对仍能发现未解决的冲突
      if (!result.changed) {
        const size = result.size ?? eventStat?.size;
        const mtimeMs = result.mtimeMs ?? eventStat?.mtimeMs;
        if (size != null && mtimeMs != null) {
          fileFingerprintRef.current.set(path, { size, mtimeMs });
        }
      }
      logger.log('[App] External modify verification:', path, 'changed:', result.changed);
      return result.changed;
    },
    [compareDiskContent, fileFingerprintRef, lastWrittenContentRef, originalContentRef, currentContentRef],
  );

  // 当前打开文件发生外部内容变更时的统一处理：
  // 校验 → iCloud 宽限期 → 干净文件静默刷新 → 静默模式强制刷新 → 脏文件弹窗
  const handleCurrentFileExternalChange = useCallback(
    async (path: string, eventStat?: EventStat) => {
      const isRealExternalChange = await verifyExternalContentChange(path, eventStat);
      if (!isRealExternalChange) {
        logger.log('[App] Ignoring external change (content unchanged on disk):', path);
        return;
      }

      // 检查是否在 iCloud 同步宽限期内
      if (icloudSyncWindowRef.current.has(path)) {
        logger.log('[App] File in iCloud sync grace window, silent reloading:', path);
        silentReloadFile(path);
        return;
      }

      // 没有未保存修改的文件被外部修改 → 静默刷新，不打扰
      if (currentContentRef.current === originalContentRef.current) {
        logger.log('[App] Clean file changed externally, silent reloading:', path);
        silentReloadFile(path);
        return;
      }

      // 有未保存修改：
      if (silentExternalChanges) {
        // 用户显式选择"静默刷新"：强制加载磁盘最新内容（可能丢弃未保存修改）
        logger.log('[App] Silent mode enabled, reloading dirty file:', path);
        silentReloadFile(path);
        return;
      }

      // 默认（弹窗提示）：冲突时直接弹窗确认
      logger.log('[App] Dirty file changed externally, prompting conflict dialog:', path);
      await promptConflictDialog(path, path.split('/').pop() || path);
    },
    [verifyExternalContentChange, silentReloadFile, silentExternalChanges, promptConflictDialog, icloudSyncWindowRef, currentContentRef, originalContentRef],
  );

  // 当前文件从磁盘消失：保留编辑器内容与大纲（参考 VS Code 的做法），
  // 等待同名重建（替换式保存/云盘回写）或用户保存重建；只有切换/关闭时才清空。
  const markCurrentFileDeleted = useCallback(() => {
    if (currentFileDeletedRef.current) return;
    const path = currentFileRef.current;
    if (!path) return;
    currentFileDeletedRef.current = true;
    setCurrentFileDeleted(true);
    logger.log('[App] Current file deleted from disk, keeping buffer:', path);

    // create 事件可能丢失或与 remove 乱序：短暂延迟后确认同名文件是否已重建
    if (deletedReconcileTimerRef.current) clearTimeout(deletedReconcileTimerRef.current);
    deletedReconcileTimerRef.current = setTimeout(async () => {
      deletedReconcileTimerRef.current = null;
      if (!currentFileDeletedRef.current || currentFileRef.current !== path) return;
      try {
        const type = await invoke<string>('check_path_type', { path });
        if (type === 'file') {
          // create/modify 事件可能已抢先完成处理，避免重复校验
          if (!currentFileDeletedRef.current || currentFileRef.current !== path) return;
          logger.log('[App] Deleted file reappeared, verifying content:', path);
          clearCurrentFileDeleted();
          await handleCurrentFileExternalChange(path);
        }
      } catch {
        // 文件仍不存在：保持“已删除”标记，用户可继续编辑，保存时会重建文件
      }
    }, 1200);
  }, [clearCurrentFileDeleted, handleCurrentFileExternalChange, currentFileDeletedRef, currentFileRef, deletedReconcileTimerRef, setCurrentFileDeleted]);

  const startIcloudGracePeriod = useCallback((path: string) => {
    const existing = icloudSyncTimersRef.current.get(path);
    if (existing) {
      clearTimeout(existing);
    }
    icloudSyncWindowRef.current.add(path);
    const timer = setTimeout(() => {
      icloudSyncWindowRef.current.delete(path);
      icloudSyncTimersRef.current.delete(path);
      logger.log('[App] iCloud sync grace period expired for:', path);
    }, ICLOUD_GRACE_DURATION);
    icloudSyncTimersRef.current.set(path, timer);
  }, [icloudSyncTimersRef, icloudSyncWindowRef]);

  const verifyAndSetupIcloudGracePeriod = useCallback(async (path: string) => {
    try {
      const result = await invoke<{ is_icloud: boolean }>('is_icloud_file', { path });
      if (!result.is_icloud) {
        const timer = icloudSyncTimersRef.current.get(path);
        if (timer) {
          clearTimeout(timer);
          icloudSyncTimersRef.current.delete(path);
        }
        icloudSyncWindowRef.current.delete(path);
        logger.log('[App] Not an iCloud file, removed from grace window:', path);
      } else {
        logger.log('[App] iCloud sync grace period confirmed for:', path);
      }
    } catch (error) {
      console.error('[App] Failed to check iCloud file status:', error);
    }
  }, [icloudSyncTimersRef, icloudSyncWindowRef]);

  return {
    updateFileFingerprint,
    silentReloadFile,
    compareDiskContent,
    checkSaveConflict,
    markExternalConflict,
    clearExternalConflict,
    performWrite,
    reloadCurrentFile,
    promptConflictDialog,
    verifyExternalContentChange,
    handleCurrentFileExternalChange,
    markCurrentFileDeleted,
    startIcloudGracePeriod,
    verifyAndSetupIcloudGracePeriod,
  };
}
