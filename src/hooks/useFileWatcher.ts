import { useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { logger } from '@/utils/logger';

export type ModifyKind = 'data' | 'metadata' | 'any';

export interface FsEvent {
  eventType: 'create' | 'remove' | 'rename' | 'modify';
  path: string;
  oldPath?: string;
  isDirectory: boolean;
  /** 修改类型，仅当 eventType 为 'modify' 时有意义（camelCase） */
  modifyKind?: ModifyKind;
  /** 修改类型（snake_case，兼容后端直接序列化） */
  modify_kind?: ModifyKind;
  /** 事件发生时文件的修改时间（毫秒时间戳，camelCase） */
  mtimeMs?: number;
  /** 修改时间（snake_case，兼容后端直接序列化） */
  mtime_ms?: number;
  /** 事件发生时文件大小 */
  size?: number;
}

export interface UseFileWatcherOptions {
  rootPath: string | null;
  onCreate?: (event: FsEvent) => void;
  onRemove?: (event: FsEvent) => void;
  onRename?: (event: FsEvent) => void;
  onModify?: (event: FsEvent) => void;
  enabled?: boolean;
}

export function useFileWatcher(options: UseFileWatcherOptions) {
  const { rootPath, onCreate, onRemove, onRename, onModify, enabled = true } = options;
  const unlistenFns = useRef<UnlistenFn[]>([]);
  const isWatching = useRef(false);
  const currentPath = useRef<string | null>(null);



  const stopWatching = useCallback(async () => {
    if (!isWatching.current) return;

    try {
      await invoke('stop_watching');
      isWatching.current = false;
      currentPath.current = null;
      logger.log('[FileWatcher] Stopped watching');
    } catch (error) {
      console.error('[FileWatcher] Failed to stop watching:', error);
    }
  }, []);

  const startWatching = useCallback(async (path: string) => {
    // 如果已经在监听同一路径，跳过
    if (isWatching.current && currentPath.current === path) {
      logger.log('[FileWatcher] Already watching:', path);
      return;
    }

    // 先停止当前的监听
    if (isWatching.current) {
      await stopWatching();
    }

    try {
      await invoke('start_watching', { path });
      isWatching.current = true;
      currentPath.current = path;
      logger.log('[FileWatcher] Started watching:', path);
    } catch (error) {
      console.error('[FileWatcher] Failed to start watching:', error);
    }
  }, [stopWatching]);

  // 使用 ref 存储最新的回调函数，避免依赖项变化导致重复订阅
  const onCreateRef = useRef(onCreate);
  const onRemoveRef = useRef(onRemove);
  const onRenameRef = useRef(onRename);
  const onModifyRef = useRef(onModify);
  
  // 每次渲染时更新 ref
  onCreateRef.current = onCreate;
  onRemoveRef.current = onRemove;
  onRenameRef.current = onRename;
  onModifyRef.current = onModify;

  useEffect(() => {
    if (!enabled || !rootPath) {
      stopWatching();
      return;
    }

    // 设置事件监听
    const setupListeners = async () => {
      // 先清理旧的监听
      unlistenFns.current.forEach(fn => fn());
      unlistenFns.current = [];

      const listeners: UnlistenFn[] = [];

      if (onCreateRef.current) {
        const unlisten = await listen<FsEvent>('fs:create', (event) => {
          logger.log('[FileWatcher] Create event:', event.payload);
          onCreateRef.current?.(event.payload);
        });
        listeners.push(unlisten);
      }

      if (onRemoveRef.current) {
        const unlisten = await listen<FsEvent>('fs:remove', (event) => {
          logger.log('[FileWatcher] Remove event:', event.payload);
          onRemoveRef.current?.(event.payload);
        });
        listeners.push(unlisten);
      }

      if (onRenameRef.current) {
        const unlisten = await listen<FsEvent>('fs:rename', (event) => {
          logger.log('[FileWatcher] Rename event:', event.payload);
          onRenameRef.current?.(event.payload);
        });
        listeners.push(unlisten);
      }

      if (onModifyRef.current) {
        const unlisten = await listen<FsEvent>('fs:modify', (event) => {
          logger.log('[FileWatcher] Modify event:', event.payload);
          onModifyRef.current?.(event.payload);
        });
        listeners.push(unlisten);
      }

      unlistenFns.current = listeners;
    };

    setupListeners();
    startWatching(rootPath);

    return () => {
      // 清理事件监听
      unlistenFns.current.forEach(fn => fn());
      unlistenFns.current = [];
      stopWatching();
    };
  }, [rootPath, enabled, startWatching, stopWatching]);

  return {
    isWatching: isWatching.current,
    startWatching,
    stopWatching,
  };
}
