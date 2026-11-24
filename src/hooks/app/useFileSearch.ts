import { useState, useCallback, useEffect, useRef, type RefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { SearchResult } from '@/components/sidebar/file-tree/search';

/**
 * 工作区文件搜索：查询状态、防抖搜索 effect、结果与开关。
 * rootPath 变化时清空搜索状态；实际搜索读取 rootPathRef 的实时值。
 */
export function useFileSearch(rootPath: string | null, rootPathRef: RefObject<string | null>) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRequestIdRef = useRef(0);
  const prevSearchRootPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevSearchRootPathRef.current !== rootPath) {
      prevSearchRootPathRef.current = rootPath;
      searchRequestIdRef.current += 1;
      setSearchQuery('');
      setSearchResults([]);
      setIsSearching(false);
      setSearchOpen(false);
      return;
    }

    const query = searchQuery.trim();
    const currentRootPath = rootPathRef.current;
    const requestId = ++searchRequestIdRef.current;

    if (!query || !currentRootPath) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const result = await invoke<SearchResult[]>('search_files', {
          path: currentRootPath,
          query,
        });
        if (requestId !== searchRequestIdRef.current) return;
        setSearchResults(result);
      } catch (error) {
        console.error('[App] File search failed:', error);
        if (requestId !== searchRequestIdRef.current) return;
        setSearchResults([]);
      } finally {
        if (requestId === searchRequestIdRef.current) setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, rootPath]);

  const handleToggleSearch = useCallback(() => {
    setSearchOpen(true);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setIsSearching(false);
    setSearchOpen(false);
  }, []);

  return {
    searchQuery,
    searchResults,
    isSearching,
    searchOpen,
    setSearchQuery,
    handleToggleSearch,
    handleClearSearch,
  };
}
