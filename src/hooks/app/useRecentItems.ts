import { useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { normalizeRecentPath } from '@/utils/recentPath';
import { RECENT_ITEMS_KEY } from '@/app/constants';

/**
 * 最近访问记录（最多 5 个）。
 * 状态 + 镜像 ref 内部持有，对外只暴露操作方法，避免持久化逻辑散落在 App。
 */
export function useRecentItems() {
  const [recentItems, setRecentItems] = useState<string[]>(() => {
    const saved = localStorage.getItem(RECENT_ITEMS_KEY);
    return saved ? (JSON.parse(saved) as string[]).map(normalizeRecentPath) : [];
  });
  const recentItemsRef = useRef(recentItems);
  recentItemsRef.current = recentItems;

  // 添加到最近访问记录（最多5个，跳过临时/未保存文件）
  const addToRecentItems = useCallback(async (itemPath: string) => {
    const normalized = normalizeRecentPath(itemPath);
    const isTemp = await invoke<boolean>('is_temp_path', { path: normalized });
    if (isTemp) return;

    const prev = recentItemsRef.current;
    const newList = [normalized, ...prev.filter(p => p !== normalized)].slice(0, 5);
    setRecentItems(newList);
    localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(newList));
    // 同步到后端保存
    invoke('save_recent_items', { items: newList }).catch(err => {
      console.error('Failed to save recent items:', err);
    });
  }, []);

  const clearRecentItems = useCallback(() => {
    setRecentItems([]);
    localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify([]));
    invoke('save_recent_items', { items: [] }).catch(err => {
      console.error('Failed to save recent items:', err);
    });
  }, []);

  const updateRecentItemPath = useCallback((oldPath: string, newPath: string) => {
    const prevRecent = recentItemsRef.current;
    const idx = prevRecent.indexOf(oldPath);
    if (idx === -1) return;
    const newRecent = [...prevRecent];
    newRecent[idx] = newPath;
    setRecentItems(newRecent);
    localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(newRecent));
    invoke('save_recent_items', { items: newRecent }).catch(err => {
      console.error('Failed to update recent items after rename:', err);
    });
  }, []);

  // 从最近记录中移除不存在/失效的路径
  const removeRecentItem = useCallback((item: string) => {
    const newList = recentItemsRef.current.filter(p => p !== item);
    setRecentItems(newList);
    localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(newList));
    invoke('save_recent_items', { items: newList }).catch(err => {
      console.error('Failed to save recent items:', err);
    });
  }, []);

  return { recentItems, addToRecentItems, clearRecentItems, updateRecentItemPath, removeRecentItem };
}
