import { useCallback, useRef, type Dispatch, type SetStateAction, type MutableRefObject, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open, confirm } from '@tauri-apps/plugin-dialog';
import { documentDir } from '@tauri-apps/api/path';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import i18n from '@/i18n';
import { logger } from '@/utils/logger';
import { toast } from 'sonner';
import { isMobilePlatform } from '@/utils/platform';
import { createNewWindow } from '@/utils/windowManager';
import { showSaveConflictDialog } from '@/components/FileModifiedDialog';
import { convertFileNode, createRootNode, type RustFileNode } from '@/app/fileTree';
import type { FileNode } from '@/components/sidebar/file-tree/types';
import { isDisabledFileExtension, resolveFileEditor } from '@/plugins/registry';
import type { FileEditorHandle } from '@/plugins/types';
import type { TempFile } from '@/app/types';
import type { useSidebar } from '@/hooks/useSidebar';
import type { useDocumentState } from './useDocumentState';
import type { useExternalChangeGuard } from './useExternalChangeGuard';
import type { TextoEditorRef } from '@/components/TextoEditor/TextoEditorRef';
import { resolveDirty, type EditorChangeMeta } from './dirty';

type DocumentState = ReturnType<typeof useDocumentState>;
type ExternalChangeGuard = ReturnType<typeof useExternalChangeGuard>;
type OutlineItem = { level: number; text: string; line: number; pos?: number; excerpt?: string };

export interface UseDocumentLifecycleParams {
  doc: DocumentState;
  guard: ExternalChangeGuard;
  setFiles: Dispatch<SetStateAction<FileNode[]>>;
  sidebar: ReturnType<typeof useSidebar>;
  addToRecentItems: (path: string) => Promise<void>;
  setOutline: Dispatch<SetStateAction<OutlineItem[]>>;
  setScrollToLine: Dispatch<SetStateAction<number | undefined>>;
  setScrollTrigger: Dispatch<SetStateAction<number>>;
  setOpenedFolderPath: Dispatch<SetStateAction<string | null>>;
  setIsSingleFileMode: Dispatch<SetStateAction<boolean>>;
  setShowOutline: Dispatch<SetStateAction<boolean>>;
  openedFolderPath: string | null;
  openedFolderPathRef: MutableRefObject<string | null>;
  autoSaveEnabled: boolean;
  setSaveStatus: Dispatch<SetStateAction<'saved' | 'saving' | 'modified'>>;
  setLastSavedTime: Dispatch<SetStateAction<string | null>>;
  fileEditorRef: MutableRefObject<FileEditorHandle | null>;
  editorRef: RefObject<TextoEditorRef | null>;
}

/**
 * 文档生命周期：打开/保存/关闭文件，新建文件，自动保存与内容变更。
 * 依赖文档状态、外部变更守卫、目录树（setFiles）、侧边栏与最近记录。
 */
export function useDocumentLifecycle({
  doc,
  guard,
  setFiles,
  sidebar,
  addToRecentItems,
  setOutline,
  setScrollToLine,
  setScrollTrigger,
  setOpenedFolderPath,
  setIsSingleFileMode,
  setShowOutline,
  openedFolderPath,
  openedFolderPathRef,
  autoSaveEnabled,
  setSaveStatus,
  setLastSavedTime,
  fileEditorRef,
  editorRef,
}: UseDocumentLifecycleParams) {
  const { t } = useTranslation();

  const {
    currentFileRef,
    fileHandleRef,
    currentContentRef,
    isModifiedRef,
    currentFileDeletedRef,
    externalConflictRef,
    icloudSyncTimersRef,
    icloudSyncWindowRef,
    ignoreExternalModifyRef,
    lastWrittenContentRef,
    originalContentRef,
    originalBaselineRef,
    editorSettleVersionRef,
    editorMountVersionRef,
    setCurrentFile,
    setCurrentContent,
    setOriginalContent,
    setIsModified,
    setFileHandle,
    setEditorKey,
    clearCurrentFileDeleted,
    hasBufferToKeep,
    ensureOriginalBaseline,
  } = doc;

  const {
    updateFileFingerprint,
    silentReloadFile,
    checkSaveConflict,
    clearExternalConflict,
    performWrite,
    reloadCurrentFile,
    promptConflictDialog,
    startIcloudGracePeriod,
    verifyAndSetupIcloudGracePeriod,
  } = guard;

  const creatingFileRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSave = useCallback(async (): Promise<string | null> => {
    const handle = fileHandleRef.current;

    // 由文件类型编辑器自行保存的文件（含临时文件另存为），骨架不参与写盘
    if (resolveFileEditor(currentFileRef.current)?.capabilities?.customSave) {
      await fileEditorRef.current?.save();
      return null;
    }

    // 写盘内容与保存点取自编辑器会话：结算编辑组后返回的 content 是规范 EOL 文本，
    // 且保存点代次用于确认「写盘期间是否又发生了编辑」。
    const savePoint = editorRef.current?.beginSavePoint() ?? null;
    const content = savePoint?.content ?? currentContentRef.current;

    if (handle.kind === 'none') {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const filePath = await save({
        filters: [
          { name: 'Markdown', extensions: ['md', 'markdown'] },
          { name: 'Text', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        defaultPath: 'Untitled.md',
      });
      if (!filePath) return null;
      ignoreExternalModifyRef.current.add(filePath);
      let savedPath: string | null = null;
      try {
        await invoke('write_file', { path: filePath, content: content || '' });
        setCurrentFile(filePath);
        setFileHandle({ kind: 'persistent', path: filePath, displayName: filePath.split('/').pop() || filePath.split('\\').pop() || 'Untitled.md' });
        originalContentRef.current = content || '';
        lastWrittenContentRef.current.set(filePath, content || '');
        updateFileFingerprint(filePath);
        setOriginalContent(content || '');
        if (savePoint) editorRef.current?.confirmSavePoint(savePoint.stateId, savePoint.sessionId, savePoint.saveSeq);
        const dirty = editorRef.current?.isDirty() ?? false;
        // 写盘期间的新编辑不能被旧保存点内容覆盖
        if (!dirty) currentContentRef.current = content || '';
        setIsModified(dirty);
        savedPath = filePath;
      } catch (error) {
        console.error('Failed to save file:', error);
        alert(t('error.saveFailed', { error }));
      } finally {
        setTimeout(() => ignoreExternalModifyRef.current.delete(filePath), 3000);
      }
      return savedPath;
    }

    if (handle.kind === 'temp') {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const filePath = await save({
        filters: [
          { name: 'Markdown', extensions: ['md', 'markdown'] },
          { name: 'Text', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        defaultPath: 'Untitled.md',
      });
      if (!filePath) return null;
      ignoreExternalModifyRef.current.add(filePath);
      let savedPath: string | null = null;
      try {
        await invoke('write_file', { path: filePath, content });
        await invoke('delete_temp_file', { path: handle.path });
        setCurrentFile(filePath);
        setFileHandle({ kind: 'persistent', path: filePath, displayName: filePath.split('/').pop() || filePath.split('\\').pop() || 'Untitled.md' });
        originalContentRef.current = content;
        lastWrittenContentRef.current.set(filePath, content);
        updateFileFingerprint(filePath);
        setOriginalContent(content);
        if (savePoint) editorRef.current?.confirmSavePoint(savePoint.stateId, savePoint.sessionId, savePoint.saveSeq);
        const dirty = editorRef.current?.isDirty() ?? false;
        // 写盘期间的新编辑不能被旧保存点内容覆盖
        if (!dirty) currentContentRef.current = content;
        setIsModified(dirty);
        savedPath = filePath;
      } catch (error) {
        console.error('Failed to save file:', error);
        alert(t('error.saveFailed', { error }));
      } finally {
        setTimeout(() => ignoreExternalModifyRef.current.delete(filePath), 3000);
      }
      return savedPath;
    }

    // kind === 'persistent': save in-place
    // 保存前检查磁盘内容是否已被外部修改（对齐主流编辑器的 save-time conflict check）
    const diskConflict = await checkSaveConflict(handle.path);
    if (diskConflict) {
      // 是否有未保存修改由编辑器保存点决定（字符串比较会把「改回原样」误判为干净）
      const hasUnsavedChanges = isModifiedRef.current;
      if (!hasUnsavedChanges) {
        // 没有未保存修改：静默加载磁盘最新内容即可，不需要写盘
        logger.log('[App] Clean file changed on disk before save, silent reloading:', handle.path);
        await silentReloadFile(handle.path);
        return handle.path;
      }

      const conflictAction = await showSaveConflictDialog(handle.displayName);
      if (conflictAction === 'cancel') {
        logger.log('[App] Save cancelled due to external conflict:', handle.path);
        return null;
      }
      if (conflictAction === 'reload') {
        await reloadCurrentFile(handle.path);
        clearExternalConflict(handle.path);
        return handle.path;
      }
      // overwrite：用户确认覆盖外部修改
      logger.log('[App] User chose to overwrite external changes:', handle.path);
    }

    await performWrite(handle.path, content, savePoint);
    return handle.path;
  }, [t, checkSaveConflict, performWrite, reloadCurrentFile, showSaveConflictDialog, silentReloadFile, updateFileFingerprint, editorRef]);

  // “已删除”图标点击：将当前缓冲直接保存回原路径（重建被删除的文件）
  const handleRecoverDeletedFile = useCallback(async () => {
    const handle = fileHandleRef.current;
    if (handle.kind !== 'persistent') {
      await handleSave();
      return;
    }
    await performWrite(handle.path, currentContentRef.current);
  }, [handleSave, performWrite]);

  // 打开指定文件夹（不记录到最近打开，记录逻辑在调用方处理）
  const openFolder = useCallback(async (folderPath: string) => {
    try {
      // 书签/最近打开不经过对话框，asset 协议 scope 不会被自动扩权，这里显式扩展以支持图片加载
      invoke('extend_asset_scope', { path: folderPath }).catch(err => {
        logger.warn('Failed to extend asset scope for folder:', err);
      });
      // 如果当前是未保存文件，打开目录前删除它
      const oldFile = currentFileRef.current;
      if (oldFile && fileHandleRef.current.kind === 'temp') {
        try {
          await invoke('delete_temp_file', { path: oldFile });
        } catch (e) {
          logger.log('Failed to delete unsaved file on folder open:', e);
        }
      }

      setOpenedFolderPath(folderPath);
      setIsSingleFileMode(false);
      // 打开文件夹直接把侧边栏布局摆好，不播放展开滑动动画
      sidebar.setCollapsed(false, { animate: false });
      setShowOutline(false); // 打开新目录时默认显示目录视图
      // 清空当前文件状态，关闭编辑器中的文件
      setCurrentFile(null);
      setCurrentContent('');
      setOriginalContent('');
      setIsModified(false);
      setFileHandle({ kind: 'none' });

      setEditorKey(prev => prev + 1);
      setOutline([]);
      const result = await invoke<RustFileNode[]>('read_directory', { path: folderPath });
      setFiles(createRootNode(folderPath, result.map(convertFileNode)));
      // 注意：不在这里记录到最近打开，由调用方决定是否记录
      return true;
    } catch (error) {
      console.error('Failed to open folder:', error);
      alert(t('error.openFolderFailed', { error }));
      return false;
    }
  }, [t]);

  // 执行实际的文件打开操作
  const executeOpenFile = useCallback(async (selected: string, isDirectory: boolean) => {
    // 所属插件被禁用时，该文件类型视为不可打开（最近文件 / 打开对话框 / 系统 open-file 事件）
    if (!isDirectory && isDisabledFileExtension(selected)) {
      toast.info(t('settings.pluginFileDisabled'));
      return false;
    }

    try {
      if (isDirectory) {
        // 如果当前是未保存文件，打开目录前删除它
        const oldFile = currentFileRef.current;
        if (oldFile && fileHandleRef.current.kind === 'temp') {
          try {
            await invoke('delete_temp_file', { path: oldFile });
          } catch (e) {
            logger.log('Failed to delete unsaved file on folder open:', e);
          }
        }

        // 打开文件夹
        setOpenedFolderPath(selected);
        setIsSingleFileMode(false);
        setCurrentFile(null);
        setCurrentContent('');
        setOriginalContent('');
        setIsModified(false);
        setFileHandle({ kind: 'none' });

        setEditorKey(prev => prev + 1);
        setOutline([]);
        const result = await invoke<RustFileNode[]>('read_directory', { path: selected });
        setFiles(createRootNode(selected, result.map(convertFileNode)));
        addToRecentItems(selected);
        invoke('create_bookmark', { path: selected }).catch(() => {});
      } else {
        // 如果当前是临时文件，打开文件前删除它
        const oldFile = currentFileRef.current;
        if (oldFile && fileHandleRef.current.kind === 'temp') {
          try {
            await invoke('delete_temp_file', { path: oldFile });
          } catch (e) {
            logger.log('Failed to delete temp file on file open:', e);
          }
        }

        // 打开文件 - 以单文件模式打开，避免沙盒权限问题
        // 先清空旧大纲，避免内容加载期间展示上一个文档的标题
        setOutline([]);
        // 单文件打开不经过对话框，扩权所在目录以加载文档已有的图片引用
        const lastSepIdx = Math.max(selected.lastIndexOf('/'), selected.lastIndexOf('\\'));
        const parentDir = lastSepIdx >= 0 ? selected.slice(0, lastSepIdx) : '';
        if (parentDir) {
          invoke('extend_asset_scope', { path: parentDir }).catch(err => {
            logger.warn('Failed to extend asset scope for file dir:', err);
          });
        }
        const content = await invoke<string>('read_file', { path: selected });

        setOpenedFolderPath(null);
        setFiles([]);
        setIsSingleFileMode(true);
        setCurrentFile(selected);

        setFileHandle({ kind: 'persistent', path: selected, displayName: selected.split('/').pop() || selected.split('\\').pop() || '' });
        setCurrentContent(content);
        setOriginalContent(content);
        setIsModified(false);
        setEditorKey(prev => prev + 1);
        // 以单文件模式打开时同样直接摆放侧边栏，不播放折叠动画
        sidebar.setCollapsed(true, { animate: false });
        addToRecentItems(selected);
        invoke('create_bookmark', { path: selected }).catch(() => {});
      }
      return true;
    } catch (error) {
      console.error('Failed to open:', error);
      alert(t('error.openFailed', { error }));
      return false;
    }
  }, [addToRecentItems, t]);

  // 处理未保存更改并继续操作
  const handleUnsavedChanges = async (action: 'openFile' | 'openFolder' | 'openRecentItem', targetPath?: string) => {
    const file = currentFileRef.current;
    const content = currentContentRef.current;
    const fileName = file
      ? (file.split('/').pop() || file.split('\\').pop() || '')
      : '';

    logger.log('[App] handleUnsavedChanges called, action:', action, 'isModified:', isModifiedRef.current, 'hasContent:', !!currentContentRef.current.trim());

    // 使用 message 对话框显示三个按钮：保存、不保存、取消
    const { message, save: saveDialog } = await import('@tauri-apps/plugin-dialog');
    const msgText = fileHandleRef.current.kind === 'temp'
      ? t('unsavedChanges.closeUnsavedMessage')
      : currentFileDeletedRef.current
        ? i18n.language?.startsWith('zh')
          ? '当前文件已被删除，是否保存到原位置？'
          : 'The current file was deleted. Save it back to its original location?'
        : t('unsavedChanges.message', { fileName });
    const choice = await message(msgText, {
      title: t('unsavedChanges.title'),
      kind: 'warning',
      buttons: {
        yes: t('unsavedChanges.save'),
        no: t('unsavedChanges.dontSave'),
        cancel: t('unsavedChanges.cancel')
      }
    });

    logger.log('[App] User choice:', choice);

    if (choice === t('unsavedChanges.cancel')) {
      // 用户选择取消，保持当前文件
      logger.log('User chose to cancel, keeping current file');
      return;
    }

    if (choice === t('unsavedChanges.save')) {
      // 用户选择保存
      try {
        // 检查是否是未保存文件（需要另存为）
        const isUnsaved = fileHandleRef.current.kind === 'temp';

        if (isUnsaved) {
          // 使用 save 对话框选择实际保存位置
          const displayName = (fileHandleRef.current.kind === 'temp' ? 'Untitled.md' : (currentFileRef.current ? currentFileRef.current.split(/[/\\]/).pop() || '' : '') || t('file.untitledMd'));
          const filePath = await saveDialog({
            filters: [
              { name: 'Markdown', extensions: ['md', 'markdown'] },
              { name: 'Text', extensions: ['txt'] },
              { name: 'All Files', extensions: ['*'] },
            ],
            defaultPath: displayName,
          });

          if (!filePath) {
            // 用户取消了保存对话框，取消整个操作
            logger.log('User cancelled save dialog');
            return;
          }

          // 保存到新位置
          await invoke('write_file', {
            path: filePath,
            content: content,
          });

          // 删除临时文件
          if (file) {
            try {
              await invoke('delete_temp_file', { path: file });
            } catch (e) {
              logger.log('Failed to delete temp file:', e);
            }
          }

          // 保存文件时不记录到最近打开，只在通过菜单打开时记录
          // addToRecentItems(filePath);
          logger.log('File saved to:', filePath);
        } else if (file) {
          // 已有文件，直接保存
          await invoke('write_file', {
            path: file,
            content: content,
          });
          if (currentFileRef.current === file) clearCurrentFileDeleted();
          logger.log('File saved:', file);
        }
      } catch (error) {
        console.error('[App] Failed to save:', error);
        alert(t('error.saveFailed', { error }));
        return;
      }
    } else if (choice === t('unsavedChanges.dontSave')) {
      // 用户选择不保存，删除临时文件（如果是临时文件）
      if (file && fileHandleRef.current.kind === 'temp') {
        try {
          await invoke('delete_temp_file', { path: file });
          logger.log('Deleted temp file:', file);
        } catch (e) {
          logger.log('Failed to delete temp file:', e);
        }
      }
    }

    // 继续打开文件/文件夹选择对话框
    try {
      if (action === 'openFile') {
        const selected = await open({ multiple: false });
        if (selected && typeof selected === 'string') {
          const pathType = await invoke<string>('check_path_type', { path: selected });
          const isDirectory = pathType === 'directory';
          await executeOpenFile(selected, isDirectory);
        }
      } else if (action === 'openFolder') {
        // iPad 上无文件夹选择器，退化为打开单个文件
        if (isMobilePlatform()) {
          const selected = await open({ multiple: false });
          if (selected && typeof selected === 'string') {
            const pathType = await invoke<string>('check_path_type', { path: selected });
            const isDirectory = pathType === 'directory';
            await executeOpenFile(selected, isDirectory);
          }
          return;
        }
        const selected = await open({ directory: true, multiple: false });
        if (selected && typeof selected === 'string') {
          await openFolder(selected);
          addToRecentItems(selected);
          invoke('create_bookmark', { path: selected }).catch(() => {});
        }
      } else if (action === 'openRecentItem' && targetPath) {
        const targetType = await invoke<string>('check_path_type', { path: targetPath });
        const targetIsDirectory = targetType === 'directory';

        if (targetIsDirectory) {
          // iPad 上无文件夹选择器，退化为打开单个文件
          if (isMobilePlatform()) {
            const selected = await open({
              multiple: false,
              defaultPath: targetPath,
              title: t('dialog.selectFile'),
            });
            if (selected && typeof selected === 'string') {
              const selectedType = await invoke<string>('check_path_type', { path: selected });
              const isDirectory = selectedType === 'directory';
              await executeOpenFile(selected, isDirectory);
            }
            return;
          }
          const selected = await open({
            directory: true,
            multiple: false,
            defaultPath: targetPath,
            title: t('dialog.selectFolder'),
          });
          if (selected && typeof selected === 'string') {
            await openFolder(selected);
            addToRecentItems(selected);
            invoke('create_bookmark', { path: selected }).catch(() => {});
          }
        } else {
          const selected = await open({
            multiple: false,
            defaultPath: targetPath,
            title: t('dialog.selectFile'),
          });
          if (selected && typeof selected === 'string') {
            const selectedType = await invoke<string>('check_path_type', { path: selected });
            const isDirectory = selectedType === 'directory';
            await executeOpenFile(selected, isDirectory);
          }
        }
      }
    } catch (error) {
      console.error('[App] Failed to open:', error);
      alert(t('error.openFailed', { error }));
    }
  };

  // 打开文件或文件夹
  const handleOpenFile = useCallback(async () => {
    const defaultDir = await documentDir();
    try {
      logger.log('[App] handleOpenFile called, isModified:', isModifiedRef.current, 'hasContent:', !!currentContentRef.current.trim(), 'fileHandle:', fileHandleRef.current.kind);
      // 检查当前是否有未保存的更改、临时文件有内容，或文件已被删除/移走
      if (hasBufferToKeep()) {
        await handleUnsavedChanges('openFile');
        return;
      }

      // 没有未保存的更改，直接打开文件选择对话框
      const selected = await open({
        multiple: false,
        defaultPath: defaultDir,
      });

      if (selected && typeof selected === 'string') {
        // 检查是文件还是目录
        const pathType = await invoke<string>('check_path_type', { path: selected });
        const isDirectory = pathType === 'directory';
        await executeOpenFile(selected, isDirectory);
      }
    } catch (error) {
      console.error('Failed to open:', error);
      alert(t('error.openFailed', { error }));
    }
  }, [executeOpenFile, t, hasBufferToKeep]);

  const handleOpenFolder = useCallback(async () => {
    // iPad 上无文件夹选择器，退化为打开单个文件
    if (isMobilePlatform()) {
      return handleOpenFile();
    }
    const defaultDir = await documentDir();
    try {
      // 检查当前是否有未保存的更改、临时文件有内容，或文件已被删除/移走
      if (hasBufferToKeep()) {
        await handleUnsavedChanges('openFolder');
        return;
      }

      // 没有未保存的更改，直接打开文件夹选择对话框
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: defaultDir,
      });

      if (selected && typeof selected === 'string') {
        await openFolder(selected);
        // 通过菜单打开文件夹，记录到最近打开
        addToRecentItems(selected);
        invoke('create_bookmark', { path: selected }).catch(() => {});
      }
    } catch (error) {
      console.error('Failed to open folder:', error);
    }
  }, [openFolder, addToRecentItems, hasBufferToKeep]);



  // 创建新文件（创建未保存文件）
  const handleNewFile = useCallback(async () => {
    // 防止重复创建
    if (creatingFileRef.current) {
      logger.log('File creation already in progress, skipping');
      return;
    }

    creatingFileRef.current = true;

    try {
      // 创建新的未保存文件
      const newFile = await invoke<TempFile>('create_temp_file', { content: '' });

      // 打开未保存文件
      setOpenedFolderPath(null);
      setFiles([]);
      setIsSingleFileMode(true);
      setCurrentFile(newFile.path);

      setFileHandle({ kind: 'temp', path: newFile.path });
      setCurrentContent('');
      setOriginalContent('');
      setIsModified(false);
      setEditorKey(prev => prev + 1);

      logger.log('New unsaved file created:', newFile.path, 'originalContent set to empty');
    } catch (error) {
      console.error('Failed to create new file:', error);
      alert(t('error.createFileFailed', { error }));
    } finally {
      creatingFileRef.current = false;
    }
  }, [t]);

  const handleFileSelect = useCallback(async (path: string) => {
    // 再次点击已在编辑器打开的文件时直接忽略，避免无谓的重新读取与编辑器重挂载
    if (currentFileRef.current === path) {
      logger.log('File already open, skip reload:', path);
      return;
    }

    // 所属插件被禁用时，该文件类型视为不可打开（目录树/文件链接/宿主打开入口；
    // 最近文件、打开对话框、系统 open-file 事件由 executeOpenFile 兜底）
    if (isDisabledFileExtension(path)) {
      toast.info(t('settings.pluginFileDisabled'));
      return;
    }

    logger.log('File selected:', path);

    // 由文件类型编辑器自行读取的文件，骨架不读取其内容
    const handledByFileEditor = resolveFileEditor(path) !== null;

    // 清除旧文件的 iCloud 同步宽限期
    if (currentFileRef.current) {
      const oldTimer = icloudSyncTimersRef.current.get(currentFileRef.current);
      if (oldTimer) {
        clearTimeout(oldTimer);
        icloudSyncTimersRef.current.delete(currentFileRef.current);
      }
      icloudSyncWindowRef.current.delete(currentFileRef.current);
    }

    // 立即为新文件设置 iCloud 同步宽限期（防止竞态条件）
    startIcloudGracePeriod(path);

    // 先立即取消旧文件选中态，目录树高亮即时切换
    setCurrentFile(path);

    // 如果当前文件有未保存的更改、临时文件有内容，或文件已被删除/移走，提示用户
    if (hasBufferToKeep()) {
      const shouldSave = await confirm(
        currentFileDeletedRef.current
          ? i18n.language?.startsWith('zh')
            ? '当前文件已被删除，是否保存到原位置？'
            : 'The current file was deleted. Save it back to its original location?'
          : t('unsavedChanges.simpleMessage'),
      );
      if (shouldSave) {
        await handleSave();
      } else if (fileHandleRef.current.kind === 'temp') {
        await invoke('delete_temp_file', { path: fileHandleRef.current.path }).catch(() => {});
      }
    }

    try {
      // 链接/目录树打开的文件同样需要显式扩权所在目录，否则同目录图片 403
      const lastSepIdx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
      const parentDir = lastSepIdx >= 0 ? path.slice(0, lastSepIdx) : '';
      if (parentDir) {
        invoke('extend_asset_scope', { path: parentDir }).catch(err => {
          logger.warn('Failed to extend asset scope for file dir:', err);
        });
      }

      const content = handledByFileEditor
        ? ''
        : await invoke<string>('read_file', { path });
      logger.log('File content loaded, length:', content.length);

      const fileName = path.split('/').pop() || path.split('\\').pop() || '';
      setFileHandle({ kind: 'persistent', path, displayName: fileName });
      currentContentRef.current = content;
      originalContentRef.current = content;
      // 重新打开文件后清除旧的自写入记录，避免把后续真实外部修改误判为自身回显
      lastWrittenContentRef.current.delete(path);
      updateFileFingerprint(path);
      setCurrentContent(content);
      setOriginalContent(content);
      setIsModified(false);
      setEditorKey(prev => prev + 1);
      setOutline([]);
      // 清除上一文件残留的跳转目标，避免在新文件（可能更短）上触发越界滚动
      setScrollToLine(undefined);
      setScrollTrigger(0);

      // 只有在非目录模式下（单文件模式）才记录到最近打开
      // 目录模式下只记录目录，不记录目录内的文件
      if (!openedFolderPathRef.current) {
        addToRecentItems(path);
        invoke('create_bookmark', { path }).catch(() => {});
      }

      // 清除该文件的忽略状态，允许再次检测外部修改
      ignoreExternalModifyRef.current.delete(path);

      // 异步验证是否为 iCloud 文件，若不是则移出宽限期
      verifyAndSetupIcloudGracePeriod(path);
    } catch (error) {
      console.error('Failed to read file:', error);
    }
  }, [handleSave, startIcloudGracePeriod, verifyAndSetupIcloudGracePeriod, addToRecentItems, updateFileFingerprint, hasBufferToKeep, t]);

  // 打开文件链接：存在性检查 → 书签授权 → 读探针(权限不足回退对话框) → 路由
  const handleOpenFileLink = useCallback(async (path: string) => {
    try {
      // 所属插件被禁用时，该文件类型视为不可打开
      if (isDisabledFileExtension(path)) {
        toast.info(t('settings.pluginFileDisabled'));
        return;
      }

      try {
        const type = await invoke<string>('check_path_type', { path });
        if (type !== 'file') return;
      } catch {
        return;
      }

      // 命中书签时先启动沙盒访问，保证 read_file 能读到（目录书签超限时批量启动被跳过，这里兜底）
      const hasBookmark = await invoke<boolean>('has_bookmark', { path }).catch(() => false);
      if (hasBookmark) {
        await invoke('start_access', { path }).catch(err => {
          logger.warn('Failed to resolve bookmark access:', err);
        });
      }

      try {
        await invoke<string>('read_file', { path });
      } catch {
        const selected = await open({ multiple: false, defaultPath: path, title: t('dialog.selectFile') });
        if (!selected || typeof selected !== 'string') return;
        const selectedType = await invoke<string>('check_path_type', { path: selected });
        if (selectedType !== 'file') return;
        path = selected;
        invoke('create_bookmark', { path: selected }).catch(() => {});
      }

      const normPath = path.replace(/\\/g, '/');
      const normFolder = openedFolderPath ? openedFolderPath.replace(/\\/g, '/').replace(/\/+$/, '') : null;
      const inCurrentFolder = !!normFolder && (normPath === normFolder || normPath.startsWith(normFolder + '/'));
      if (inCurrentFolder) {
        await handleFileSelect(path);
      } else {
        await createNewWindow(path);
      }
    } catch (error) {
      console.error('Failed to open file link:', error);
    }
  }, [handleFileSelect, openedFolderPath, t]);

  const handleFileClose = useCallback(async (path: string) => {
    if (path !== currentFileRef.current) return;

    // 清除 iCloud 同步宽限期
    const oldTimer = icloudSyncTimersRef.current.get(path);
    if (oldTimer) {
      clearTimeout(oldTimer);
      icloudSyncTimersRef.current.delete(path);
    }
    icloudSyncWindowRef.current.delete(path);

    // 如果有未保存的更改、临时文件有内容，或文件已被删除/移走，提示用户
    if (hasBufferToKeep()) {
      const shouldSave = await confirm(
        currentFileDeletedRef.current
          ? i18n.language?.startsWith('zh')
            ? '当前文件已被删除，是否保存到原位置？'
            : 'The current file was deleted. Save it back to its original location?'
          : t('unsavedChanges.simpleMessage'),
      );
      if (path !== currentFileRef.current) return;
      if (shouldSave) {
        await handleSave();
      } else if (fileHandleRef.current.kind === 'temp') {
        await invoke('delete_temp_file', { path: fileHandleRef.current.path }).catch(() => {});
      }
    }

    if (path !== currentFileRef.current) return;
    ignoreExternalModifyRef.current.delete(path);

    setCurrentFile(null);
    setCurrentContent('');
    setOriginalContent('');
    setIsModified(false);
    setFileHandle({ kind: 'none' });
    setOutline([]);
  }, [t, confirm, handleSave, hasBufferToKeep]);

  // 自动保存功能
  const autoSave = useCallback(async () => {
    const handle = fileHandleRef.current;
    if (handle.kind === 'none') return;
    if (handle.kind === 'persistent' && !autoSaveEnabled) return;

    const savePoint = editorRef.current?.beginSavePoint() ?? null;
    const content = savePoint?.content ?? currentContentRef.current;
    setSaveStatus('saving');
    try {
      if (handle.kind === 'temp') {
        await invoke('write_file', { path: handle.path, content });
        setSaveStatus('modified');
      } else {
        // 自动保存前检查外部冲突：有冲突时跳过写入，避免静默覆盖外部修改
        const hasConflict = await checkSaveConflict(handle.path);
        if (hasConflict) {
          // 兜底：即使 watcher 事件延迟/丢失，自动保存发现冲突时也直接弹窗确认
          await promptConflictDialog(handle.path, handle.displayName);
          // 若用户已通过弹窗覆盖保存或重新加载，冲突已清除；否则保持 modified
          setSaveStatus(externalConflictRef.current.has(handle.path) ? 'modified' : 'saved');
          logger.log('[App] Auto-save skipped, file changed externally:', handle.path);
          return;
        }
        // 文件已被删除/移到废纸篓时，自动保存不擅自重建原位置文件：
        // 保留“未保存”状态，由用户点“已删除”图标或手动保存来决定恢复。
        if (currentFileDeletedRef.current) {
          setSaveStatus('modified');
          logger.log('[App] Auto-save skipped, file missing on disk:', handle.path);
          return;
        }
        ignoreExternalModifyRef.current.add(handle.path);
        await invoke('write_file', { path: handle.path, content });
        originalContentRef.current = content;
        lastWrittenContentRef.current.set(handle.path, content);
        clearExternalConflict(handle.path);
        setOriginalContent(content);
        if (savePoint) editorRef.current?.confirmSavePoint(savePoint.stateId, savePoint.sessionId, savePoint.saveSeq);
        // 写盘期间可能又有编辑：以保存点代次判断，不能无条件标记为已保存
        const dirty = editorRef.current?.isDirty() ?? false;
        setIsModified(dirty);
        setSaveStatus(dirty ? 'modified' : 'saved');
        if (!dirty) {
          const now = new Date();
          const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          setLastSavedTime(timeStr);
          if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
          saveStatusTimerRef.current = setTimeout(() => {
            setSaveStatus('saved');
            setLastSavedTime(null);
          }, 5000);
        }
        setTimeout(() => ignoreExternalModifyRef.current.delete(handle.path), 3000);
      }
    } catch (error) {
      console.error('Auto save failed:', error);
      setSaveStatus('modified');
    }
  }, [autoSaveEnabled, checkSaveConflict, clearExternalConflict, promptConflictDialog, editorRef]);

  const handleContentChange = useCallback(async (content: string, meta?: EditorChangeMeta) => {
    let isNewFile = false;
    if (fileHandleRef.current.kind === 'none' && content.trim()) {
      try {
        const newFile = await invoke<TempFile>('create_temp_file', { content: '' });
        fileHandleRef.current = { kind: 'temp', path: newFile.path };
        setCurrentFile(newFile.path);
        setFileHandle({ kind: 'temp', path: newFile.path });
        isNewFile = true;
      } catch (error) {
        console.error('Failed to create temp file:', error);
        return;
      }
    }

    setCurrentContent(content);
    currentContentRef.current = content;
    // 大文档的 dirty 基线会推迟到空闲时段；首次变更前确保它已对应当前原文。
    ensureOriginalBaseline();
    if (editorSettleVersionRef.current < editorMountVersionRef.current) {
      editorSettleVersionRef.current = editorMountVersionRef.current;
      const anchored = !resolveDirty(
        content,
        originalContentRef.current,
        originalBaselineRef.current,
        meta,
      );
      setIsModified(!anchored);
      return;
    }
    const modified = resolveDirty(
      content,
      originalContentRef.current,
      originalBaselineRef.current,
      meta,
    );
    setIsModified(modified);

    if (isNewFile && fileHandleRef.current.kind === 'temp') {
      setSaveStatus('modified');
      try {
        await invoke('write_file', { path: fileHandleRef.current.path, content });
      } catch (error) {
        console.error('Failed to save initial content:', error);
      }
    }

    const shouldAutoSave = modified && fileHandleRef.current.kind !== 'none' &&
      (fileHandleRef.current.kind === 'temp' || autoSaveEnabled);
    if (shouldAutoSave) {
      setSaveStatus('modified');
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => autoSave(), 1000);
    }
  }, [autoSaveEnabled, autoSave, ensureOriginalBaseline]);

  const handleOpenInFinder = useCallback(async (path: string) => {
    try {
      await revealItemInDir(path);
    } catch (error) {
      console.error('Failed to open in finder:', error);
    }
  }, []);
  return {
    handleSave,
    handleRecoverDeletedFile,
    openFolder,
    executeOpenFile,
    handleUnsavedChanges,
    handleOpenFile,
    handleOpenFolder,
    handleNewFile,
    handleFileSelect,
    handleOpenFileLink,
    handleFileClose,
    autoSave,
    handleContentChange,
    handleOpenInFinder,
  };
}
