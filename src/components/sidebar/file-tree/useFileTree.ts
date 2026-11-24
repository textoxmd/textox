import { useState, useRef, useCallback, useEffect } from 'react';
import type { FileNode, RenamingNode } from './types';
import { findNodeInTree } from './types';
import { findAdjacentVisible } from './findAdjacentVisible';

const EXPANDED_PATHS_KEY = 'texto:sidebar-tree-expanded';

interface UseFileTreeOptions {
  rootNode: FileNode | null;
  currentFile: string | null;
  autoExpandToFile?: boolean;
  rootPath?: string;
  defaultRenamingPath?: string;
  onCancelRenaming?: () => void;
  onCreateFile: (parentPath: string, name: string) => void;
  onCreateFolder: (parentPath: string, name: string) => void;
  onRenameFile: (oldPath: string, newPath: string) => void;
  onDeleteFiles: (paths: string[]) => void;
  onOpenInFinder?: (path: string) => void;
  onFileSelect?: (path: string) => void;
}

export function useFileTree(options: UseFileTreeOptions) {
  const { rootNode, currentFile, autoExpandToFile, rootPath, defaultRenamingPath, onCancelRenaming, onCreateFile, onCreateFolder, onRenameFile, onDeleteFiles, onFileSelect } = options;

  const [renamingNode, setRenamingNode] = useState<RenamingNode | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [creatingNode, setCreatingNode] = useState<{ name: string; isDirectory: boolean } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevRootPathRef = useRef<string | undefined>(undefined);

  const saveExpandedPaths = useCallback((paths: Set<string>) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      localStorage.setItem(EXPANDED_PATHS_KEY, JSON.stringify(Array.from(paths)));
    }, 300);
  }, []);

  useEffect(() => {
    const currentRootPath = rootNode?.path;
    if (currentRootPath !== prevRootPathRef.current) {
      prevRootPathRef.current = currentRootPath;
      setFocusedPath(null);
      if (rootNode) {
        const newExpanded = new Set<string>([rootNode.path]);
        try {
          const saved = localStorage.getItem(EXPANDED_PATHS_KEY);
          if (saved) {
            const parsed: string[] = JSON.parse(saved);
            parsed.forEach(p => { if (p.startsWith(rootNode.path)) newExpanded.add(p); });
          }
        } catch { /* ignore */ }
        setExpandedPaths(newExpanded);
      } else {
        setExpandedPaths(new Set());
      }
    }
  }, [rootNode?.path]);

  useEffect(() => {
    if (!autoExpandToFile || !currentFile || !rootPath) return;
    const separator = currentFile.includes('\\') ? '\\' : '/';
    const parentPath = currentFile.substring(0, currentFile.lastIndexOf(separator));
    const pathsToExpand: string[] = [];
    let current = parentPath;
    while (current && current !== rootPath && current.length > rootPath.length) {
      pathsToExpand.push(current);
      const lastSep = current.lastIndexOf(separator);
      if (lastSep <= 0) break;
      current = current.substring(0, lastSep);
    }
    if (pathsToExpand.length > 0) {
      setExpandedPaths(prev => {
        const newSet = new Set(prev);
        pathsToExpand.forEach(p => newSet.add(p));
        return newSet;
      });
    }
  }, [currentFile, autoExpandToFile, rootPath]);

  useEffect(() => {
    if (defaultRenamingPath && rootNode) {
      const findName = (nodes: FileNode[], targetPath: string): string | null => {
        for (const n of nodes) {
          if (n.path === targetPath) return n.name;
          if (n.children) {
            const found = findName(n.children, targetPath);
            if (found) return found;
          }
        }
        return null;
      };
      const name = findName([rootNode], defaultRenamingPath);
      if (name) setRenamingNode({ path: defaultRenamingPath, name });
    }
  }, [defaultRenamingPath, rootNode]);

  useEffect(() => {
    if (!focusedPath) return;
    const el = document.querySelector(`[data-path="${CSS.escape(focusedPath)}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, [focusedPath]);

  const handleToggleExpand = useCallback((path: string, expanded: boolean) => {
    if (!expanded && focusedPath && focusedPath.startsWith(path + '/')) {
      setFocusedPath(null);
    }
    setExpandedPaths(prev => {
      const newSet = new Set(prev);
      if (expanded) newSet.add(path);
      else newSet.delete(path);
      saveExpandedPaths(newSet);
      return newSet;
    });
  }, [focusedPath, saveExpandedPaths]);

  const handleToggleSelect = useCallback((path: string) => {
    setSelectedPaths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) newSet.delete(path);
      else newSet.add(path);
      return newSet;
    });
  }, []);

  const handleRenameRequest = useCallback((path: string, newName: string) => {
    if (newName === '') {
      const name = path.split(/[\\/]/).pop() || '';
      setRenamingNode({ path, name });
    } else {
      const separator = path.includes('\\') ? '\\' : '/';
      const lastSepIndex = path.lastIndexOf(separator);
      const parentPath = lastSepIndex >= 0 ? path.substring(0, lastSepIndex + 1) : '';
      const newPath = parentPath + newName;
      onRenameFile(path, newPath);
      setRenamingNode(null);
    }
  }, [onRenameFile]);

  const handleCancelRenaming = useCallback(() => {
    setRenamingNode(null);
    onCancelRenaming?.();
  }, [onCancelRenaming]);

  const handleCreateFile = useCallback((parentPath: string, name: string) => {
    onCreateFile(parentPath, name);
    setCreatingNode(null);
  }, [onCreateFile]);

  const handleCreateFolder = useCallback((parentPath: string, name: string) => {
    onCreateFolder(parentPath, name);
    setCreatingNode(null);
  }, [onCreateFolder]);

  const handleCancelCreate = useCallback(() => setCreatingNode(null), []);

  const handleDeleteRequest = useCallback((paths: string[]) => {
    onDeleteFiles(paths);
    setSelectedPaths(new Set());
  }, [onDeleteFiles]);

  const clearSelection = useCallback(() => setSelectedPaths(new Set()), []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!rootNode) return;

    type Binding = {
      key: string;
      mod?: boolean;
      when?: () => boolean;
      handler: () => void;
    };

    const bindings: Binding[] = [
      {
        key: 'ArrowDown',
        when: () => !renamingNode,
        handler: () => {
          const next = findAdjacentVisible([rootNode], expandedPaths, focusedPath, 'down');
          if (next) setFocusedPath(next);
        },
      },
      {
        key: 'ArrowUp',
        when: () => !renamingNode,
        handler: () => {
          const next = findAdjacentVisible([rootNode], expandedPaths, focusedPath, 'up');
          if (next) setFocusedPath(next);
        },
      },
      {
        key: 'Enter',
        handler: () => {
          if (!focusedPath) return;
          const node = findNodeInTree([rootNode], focusedPath);
          if (!node) return;
          if (node.isDirectory) {
            handleToggleExpand(focusedPath, !expandedPaths.has(focusedPath));
          } else {
            handleRenameRequest(focusedPath, '');
          }
        },
      },
      {
        key: 'Enter',
        mod: true,
        handler: () => {
          if (!focusedPath) return;
          const node = findNodeInTree([rootNode], focusedPath);
          if (!node) return;
          if (node.isDirectory) {
            handleToggleExpand(focusedPath, !expandedPaths.has(focusedPath));
          } else {
            onFileSelect?.(focusedPath);
          }
        },
      },
    ];

    const mod = e.metaKey || e.ctrlKey;
    for (const b of bindings) {
      if (e.key === b.key && !!mod === !!b.mod) {
        if (b.when && !b.when()) return;
        e.preventDefault();
        b.handler();
        return;
      }
    }
  }, [rootNode, expandedPaths, focusedPath, renamingNode, handleToggleExpand, handleRenameRequest, onFileSelect]);

  const getNodeChildren = useCallback((nodePath: string): FileNode[] => {
    if (!rootNode) return [];
    const node = findNodeInTree([rootNode], nodePath);
    return node?.children ?? [];
  }, [rootNode]);

  return {
    renamingNode,
    focusedPath,
    selectedPaths,
    expandedPaths,
    creatingNode,
    setFocusedPath,
    handleToggleExpand,
    handleToggleSelect,
    handleRenameRequest,
    handleCancelRenaming,
    handleCreateFile,
    handleCreateFolder,
    handleCancelCreate,
    handleDeleteRequest,
    clearSelection,
    handleKeyDown,
    getNodeChildren,
    setCreatingNode,
  };
}
