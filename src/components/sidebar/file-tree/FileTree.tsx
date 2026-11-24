import { useRef, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFileTree } from './useFileTree';
import { TreeNode, type TreeNodeMenuHandler } from './TreeNode';
import { CreatingNodeInput } from './TreeNodeInput';
import { BuiltinContextMenuActions } from '@/components/sidebar/context-menu/builtin-actions';
import { BuiltinTreeShortcuts } from '@/components/sidebar/shortcuts/builtin-shortcuts';
import { useTreeNodeShortcuts } from '@/components/sidebar/shortcuts/ShortcutProvider';
import { ScrollEdges, useScrollEdges } from '@/components/sidebar/ScrollEdges';
import { generateUniqueNameWithExisting, findNodeInTree } from './types';
import type { FileNode } from './types';
import { isMobilePlatform } from '@/utils/platform';

interface FileTreeProps {
  rootNode: FileNode | null;
  currentFile: string | null;
  onFileSelect: (path: string) => void;
  onFileClose?: (path: string) => void;
  onCreateFile?: (parentPath: string, name: string) => void;
  onCreateFolder?: (parentPath: string, name: string) => void;
  defaultRenamingPath?: string;
  onCancelRenaming?: () => void;
  onDeleteFiles?: (paths: string[]) => void;
  onRenameFile?: (oldPath: string, newPath: string) => void;
  onOpenInFinder?: (path: string) => void;
  rootPath?: string;
  autoExpandToFile?: boolean;
  openableExtensions?: string[];
  onFocusedPathChange?: (path: string | null) => void;
}

function FileTreeBase({
  rootNode, currentFile, onFileSelect, onFileClose, onCreateFile = () => {},
  onCreateFolder = () => {}, defaultRenamingPath,
  onCancelRenaming = () => {}, onDeleteFiles = () => {},
  onRenameFile = () => {}, onOpenInFinder = () => {},
  rootPath, autoExpandToFile, openableExtensions, onFocusedPathChange,
}: FileTreeProps) {
  const { t } = useTranslation();
  const treeRef = useRef<HTMLDivElement>(null);
  const treeEdges = useScrollEdges<HTMLDivElement>();
  const rootMenuHandlerRef = useRef<TreeNodeMenuHandler | null>(null);
  const registerRootMenuHandler = useCallback((handler: TreeNodeMenuHandler | null) => {
    rootMenuHandlerRef.current = handler;
  }, []);

  const {
    renamingNode, focusedPath, selectedPaths, expandedPaths, creatingNode,
    setFocusedPath, handleToggleExpand, handleToggleSelect,
    handleRenameRequest, handleCancelRenaming, handleCreateFile,
    handleCreateFolder, handleCancelCreate, handleDeleteRequest,
    handleKeyDown, getNodeChildren,
  } = useFileTree({
    rootNode,
    currentFile,
    autoExpandToFile,
    rootPath,
    defaultRenamingPath,
    onCancelRenaming,
    onCreateFile,
    onCreateFolder,
    onRenameFile,
    onDeleteFiles,
    onOpenInFinder,
    onFileSelect,
  });

  const { matchShortcut } = useTreeNodeShortcuts();

  const onContainerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (renamingNode) return;

    handleKeyDown(e);

    if (!e.defaultPrevented && focusedPath && rootNode) {
      const focusedNode = findNodeInTree([rootNode], focusedPath);
      matchShortcut(e, focusedNode ?? null);
    }
  }, [handleKeyDown, matchShortcut, focusedPath, rootNode, renamingNode]);

  const handleTreeContentContextMenu = useCallback(async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.tree-item, input, textarea')) return;
    e.preventDefault();
    e.stopPropagation();
    if (isMobilePlatform()) return;
    await rootMenuHandlerRef.current?.(e.clientX, e.clientY);
  }, []);

  if (!rootNode) return null;

  return (
    <div
      className="directory-tree"
      ref={treeRef}
      tabIndex={0}
      onKeyDown={onContainerKeyDown}
    >
      <BuiltinContextMenuActions
        onCreateFile={handleCreateFile}
        onCreateFolder={handleCreateFolder}
        onRenameRequest={handleRenameRequest}
        onDeleteRequest={handleDeleteRequest}
        onOpenInFinder={onOpenInFinder}
        generateUniqueName={generateUniqueNameWithExisting}
        getNodeChildren={(nodePath) => getNodeChildren(nodePath)}
        t={t}
        selectedPaths={selectedPaths}
        rootPath={rootNode.path}
      />
      <BuiltinTreeShortcuts
        onOpenNode={(path) => onFileSelect(path)}
        onToggleExpand={(path) => handleToggleExpand(path, !expandedPaths.has(path))}
        onDelete={handleDeleteRequest}
        hasSelection={() => selectedPaths.size > 0}
        hasSingleSelection={() => selectedPaths.size === 1}
      />
      <div className="tree-content" ref={treeEdges.ref} onContextMenu={handleTreeContentContextMenu}>
        <TreeNode
          key={rootNode.path}
          node={rootNode}
          currentFile={currentFile}
          selectedPaths={selectedPaths}
          onFileSelect={onFileSelect}
          onFileClose={onFileClose}
          onToggleSelect={handleToggleSelect}
          onCreateFile={handleCreateFile}
          onCreateFolder={handleCreateFolder}
          onRenameRequest={handleRenameRequest}
          onCancelRenaming={handleCancelRenaming}
          onDeleteRequest={handleDeleteRequest}
          onOpenInFinder={onOpenInFinder}
          renamingNode={renamingNode}
          expandedPaths={expandedPaths}
          onToggleExpand={handleToggleExpand}
          isRoot={true}
          openableExtensions={openableExtensions}
          focusedPath={focusedPath}
          onFocusedPathChange={(path) => { setFocusedPath(path); onFocusedPathChange?.(path); }}
          t={t}
          onMenuHandleReady={registerRootMenuHandler}
        />
        {creatingNode && (
          <CreatingNodeInput
            name={creatingNode.name}
            level={0}
            onConfirm={(name) => {
              if (creatingNode.isDirectory) handleCreateFolder(rootNode.path, name);
              else handleCreateFile(rootNode.path, name);
            }}
            onCancel={handleCancelCreate}
          />
        )}
      </div>
      <ScrollEdges
        canScrollUp={treeEdges.canScrollUp}
        canScrollDown={treeEdges.canScrollDown}
      />
    </div>
  );
}

/**
 * 文件树是侧栏里最贵的子树（递归 TreeNode、无虚拟化）。用 memo 隔离宿主
 * 每键一次的 `setCurrentContent` 重渲染：编辑时只要文件树 props 不变就整棵跳过。
 */
export const FileTree = memo(FileTreeBase);
