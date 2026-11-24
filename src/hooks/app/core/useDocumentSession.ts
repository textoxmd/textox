import type { MutableRefObject } from 'react';
import type { FileEditorHandle } from '@/plugins/types';
import { useExternalChangeGuard } from './useExternalChangeGuard';
import { useFileSystemWatcher } from './useFileSystemWatcher';
import { useDocumentLifecycle, type UseDocumentLifecycleParams } from './useDocumentLifecycle';
import type { useDocumentState } from './useDocumentState';

type DocumentState = ReturnType<typeof useDocumentState>;

interface UseDocumentSessionParams extends Omit<UseDocumentLifecycleParams, 'doc' | 'guard'> {
  doc: DocumentState;
  silentExternalChanges: boolean;
  watchExternalChanges: boolean;
  scheduleDirectoryRefresh: () => void;
  fileEditorRef: MutableRefObject<FileEditorHandle | null>;
  openedFolderPath: string | null;
}

/**
 * 文档核心组合层：把外部变更守卫、文件系统监听、文档生命周期三层
 * 叠在上层 useDocumentState 之上，对外暴露单一接口。
 * （state 层由 App 先行建立，因为配置/白板/大纲/文件树都依赖它。）
 */
export function useDocumentSession({
  doc,
  silentExternalChanges,
  watchExternalChanges,
  scheduleDirectoryRefresh,
  fileEditorRef,
  editorRef,
  openedFolderPath,
  ...lifecycleParams
}: UseDocumentSessionParams) {
  const guard = useExternalChangeGuard(doc, silentExternalChanges, editorRef);

  useFileSystemWatcher({
    doc,
    guard,
    scheduleDirectoryRefresh,
    fileEditorRef,
    openedFolderPath,
    watchExternalChanges,
  });

  const lifecycle = useDocumentLifecycle({ doc, guard, fileEditorRef, editorRef, openedFolderPath, ...lifecycleParams });

  return { ...guard, ...lifecycle };
}
