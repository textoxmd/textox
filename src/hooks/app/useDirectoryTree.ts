import { useState, useRef, useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { OPENED_FOLDER_KEY } from '@/app/constants';
import { createRefreshScheduler, type RefreshScheduler } from '@/utils/refreshScheduler';
import { convertFileNode, createRootNode, type RustFileNode } from '@/app/fileTree';
import type { FileNode } from '@/components/sidebar/file-tree/types';
import type { FileHandle } from '@/app/types';
import { resolveFileEditor } from '@/plugins/registry';

type OutlineItem = { level: number; text: string; line: number; pos?: number; excerpt?: string };

interface UseDirectoryTreeParams {
  rootPath: string | null;
  currentFile: string | null;
  setCurrentFile: Dispatch<SetStateAction<string | null>>;
  setCurrentContent: Dispatch<SetStateAction<string>>;
  setOriginalContent: Dispatch<SetStateAction<string>>;
  setIsModified: Dispatch<SetStateAction<boolean>>;
  setFileHandle: Dispatch<SetStateAction<FileHandle>>;
  setEditorKey: Dispatch<SetStateAction<number>>;
  setOutline: Dispatch<SetStateAction<OutlineItem[]>>;
  clearCurrentFileDeleted: () => void;
  updateRecentItemPath: (oldPath: string, newPath: string) => void;
}

/**
 * 文件树：目录内容状态、目录刷新（含合并调度器）、以及新建/删除/重命名文件与文件夹。
 * 新建/删除文件会顺带更新当前文档状态，因此需要文档 setter 与 clearCurrentFileDeleted。
 */
export function useDirectoryTree({
  rootPath,
  currentFile,
  setCurrentFile,
  setCurrentContent,
  setOriginalContent,
  setIsModified,
  setFileHandle,
  setEditorKey,
  setOutline,
  clearCurrentFileDeleted,
  updateRecentItemPath,
}: UseDirectoryTreeParams) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<FileNode[]>([]);
  const [renamingPath, setRenamingPath] = useState<string | undefined>(undefined);

  // 使用 ref 保持最新的 rootPath，避免闭包问题
  const rootPathRef = useRef(rootPath);
  rootPathRef.current = rootPath;

  const refreshDirectory = useCallback(async () => {
    const currentRootPath = rootPathRef.current;
    if (!currentRootPath) return;

    try {
      const result = await invoke<RustFileNode[]>('read_directory', { path: currentRootPath });
      setFiles(createRootNode(currentRootPath, result.map(convertFileNode)));
    } catch (error) {
      console.error('[App] Failed to refresh directory:', error);
    }
  }, []);

  // 使用 ref 保持回调函数的稳定性
  const refreshDirectoryRef = useRef(refreshDirectory);
  refreshDirectoryRef.current = refreshDirectory;

  // 目录刷新的合并器：短时间内多个文件事件（写入、批量改标签、iCloud 同步、
  // 扩展属性变化）只重读一次目录树（实现与用例见 utils/refreshScheduler.ts）
  const refreshSchedulerRef = useRef<RefreshScheduler | null>(null);
  refreshSchedulerRef.current ??= createRefreshScheduler(() => refreshDirectoryRef.current());
  const scheduleDirectoryRefresh = refreshSchedulerRef.current.schedule;

  useEffect(() => () => refreshSchedulerRef.current?.cancel(), []);

  // 加载保存的文件夹
  useEffect(() => {
    const loadSavedFolder = async () => {
      const savedFolder = localStorage.getItem(OPENED_FOLDER_KEY);
      if (savedFolder && savedFolder !== 'null') {
        try {
          const folderPath = JSON.parse(savedFolder);
          const result = await invoke<RustFileNode[]>('read_directory', { path: folderPath });
          setFiles(createRootNode(folderPath, result.map(convertFileNode)));
        } catch (error) {
          console.error('Failed to load saved folder:', error);
          localStorage.removeItem(OPENED_FOLDER_KEY);
        }
      }
    };
    loadSavedFolder();
  }, []);

  const handleCreateFile = useCallback(async (parentPath: string, name: string) => {
    try {
      let newPath = `${parentPath}/${name}`;
      let currentName = name;
      let counter = 0;
      const maxRetries = 10;

      // 检查文件是否已存在，如果存在则自动重命名
      while (counter < maxRetries) {
        try {
          await invoke('create_file', { path: newPath });
          break;
        } catch (error: any) {
          const errorStr = error.toString().toLowerCase();
          if (errorStr.includes('exists') || errorStr.includes(t('error.fileExists').toLowerCase()) || errorStr.includes('17')) {
            counter++;
            const dotIndex = currentName.lastIndexOf('.');
            if (dotIndex > 0) {
              currentName = `${currentName.substring(0, dotIndex)} ${counter}.${currentName.substring(dotIndex + 1)}`;
            } else {
              currentName = `${currentName} ${counter}`;
            }
            newPath = `${parentPath}/${currentName}`;
          } else {
            throw error;
          }
        }
      }

      if (counter >= maxRetries) {
        throw new Error(t('error.maxRetriesReached'));
      }

      // 由文件类型编辑器提供的初始内容（如白板空场景），避免空文件无法解析
      const fileEditor = resolveFileEditor(newPath);
      if (fileEditor?.createEmptyContent) {
        const content = await fileEditor.createEmptyContent(newPath);
        await invoke('write_file', { path: newPath, content });
      }
      const handledByFileEditor = fileEditor !== null;

      await refreshDirectory();

      // 文件类型编辑器接管当前窗口编辑器位置
      if (handledByFileEditor) {
        const displayName = newPath.split('/').pop() || newPath.split('\\').pop() || '';
        setCurrentFile(newPath);
        setFileHandle({ kind: 'persistent', path: newPath, displayName });
        setCurrentContent('');
        setOriginalContent('');
        setIsModified(false);
        setEditorKey(prev => prev + 1);
        setOutline([]);
        return;
      }

      // 自动打开新创建的文件
      const content = await invoke<string>('read_file', { path: newPath });
      setCurrentFile(newPath);
      setCurrentContent(content);
      setOriginalContent(content);
      setIsModified(false);
      setFileHandle({ kind: 'persistent', path: newPath, displayName: newPath.split('/').pop() || newPath.split('\\').pop() || '' });

      setEditorKey(prev => prev + 1);
      setOutline([]);
    } catch (error) {
      console.error('Failed to create file:', error);
      alert(t('error.createFileFailed', { error }));
    }
  }, [refreshDirectory, t]);

  const handleCreateFolder = useCallback(async (parentPath: string, name: string) => {
    try {
      let newPath = `${parentPath}/${name}`;
      let currentName = name;
      let counter = 0;
      const maxRetries = 10;

      // 检查文件夹是否已存在，如果存在则自动重命名
      while (counter < maxRetries) {
        try {
          await invoke('create_folder', { path: newPath });
          break;
        } catch (error: any) {
          const errorStr = error.toString().toLowerCase();
          if (errorStr.includes('exists') || errorStr.includes(t('error.fileExists').toLowerCase()) || errorStr.includes('17')) {
            counter++;
            currentName = `${name} ${counter}`;
            newPath = `${parentPath}/${currentName}`;
          } else {
            throw error;
          }
        }
      }

      if (counter >= maxRetries) {
        throw new Error(t('error.maxRetriesReached'));
      }

      await refreshDirectory();
    } catch (error) {
      console.error('Failed to create folder:', error);
      alert(t('error.createFolderFailed', { error }));
    }
  }, [refreshDirectory]);

  const handleDeleteFiles = useCallback(async (paths: string[]) => {
    if (paths.length === 0) return;
    const findNode = (nodes: FileNode[], targetPath: string): FileNode | null => {
      for (const node of nodes) {
        if (node.path === targetPath) return node;
        if (node.children) {
          const found = findNode(node.children, targetPath);
          if (found) return found;
        }
      }
      return null;
    };
    try {
      if (localStorage.getItem('texto:delete-without-confirmation') !== 'true') {
        const firstPath = paths[0]!;
        const firstNode = findNode(files, firstPath);
        const isDirectory = firstNode?.isDirectory ?? false;
        const name = firstNode?.name ?? firstPath.split('/').pop() ?? firstPath;

        const title = paths.length > 1
          ? t('directoryTree.deleteConfirmMultiple', { count: paths.length })
          : isDirectory
            ? t('directoryTree.deleteConfirmTitle', { name })
            : t('directoryTree.deleteConfirmTitleFile', { name });

        const { confirmed, dontAskAgain } = await invoke<{ confirmed: boolean; dontAskAgain: boolean }>('confirm_delete', {
          title,
          message: t('directoryTree.deleteConfirmRecoveryHint'),
          okLabel: t('directoryTree.deleteConfirmMoveToTrash'),
          cancelLabel: t('common.cancel'),
          suppressionLabel: t('directoryTree.deleteConfirmDontAskAgain'),
        });
        if (dontAskAgain) {
          localStorage.setItem('texto:delete-without-confirmation', 'true');
        }
        if (!confirmed) return;
      }

      for (const path of paths) {
        const node = findNode(files, path);
        if (node?.isDirectory) {
          await invoke('delete_folder', { path });
        } else {
          await invoke('delete_file', { path });
        }
      }
      await refreshDirectory();
      if (currentFile && paths.includes(currentFile)) {
        clearCurrentFileDeleted();
        setCurrentFile(null);
        setCurrentContent('');
        setOriginalContent('');
        setIsModified(false);
        setOutline([]);
      }
    } catch (error) {
      console.error('Failed to delete:', error);
      alert(t('error.deleteFailed', { error }));
    }
  }, [refreshDirectory, files, currentFile, t, clearCurrentFileDeleted]);

  const handleRenameFile = useCallback(async (oldPath: string, newPath: string) => {
    try {
      await invoke('rename_file', { oldPath, newPath });
      await refreshDirectory();
      if (currentFile === oldPath) {
        setCurrentFile(newPath);
      }
      setRenamingPath(undefined);
      updateRecentItemPath(oldPath, newPath);
    } catch (error) {
      console.error('Failed to rename file:', error);
      alert(t('error.renameFailed', { error }));
    }
  }, [currentFile, refreshDirectory, t, updateRecentItemPath]);

  return {
    files,
    setFiles,
    renamingPath,
    setRenamingPath,
    rootPathRef,
    refreshDirectory,
    scheduleDirectoryRefresh,
    handleCreateFile,
    handleCreateFolder,
    handleDeleteFiles,
    handleRenameFile,
  };
}
