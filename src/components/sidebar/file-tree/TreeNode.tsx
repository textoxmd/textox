import { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Menu, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { LogicalPosition } from '@tauri-apps/api/window';
import { Loader2, ChevronRight, Circle, X } from 'lucide-react';
import { useHeightAnimation } from '@/hooks/useHeightAnimation';
import { useContextMenu } from '@/components/sidebar/context-menu/ContextMenuProvider';
import { buildTagColorSubmenu } from '@/components/sidebar/context-menu/tag-colors';
import { RenameInput, CreatingNodeInput } from './TreeNodeInput';
import type { FileNode } from './types';
import { getFileNameWithoutExt, getFileExt, generateUniqueNameWithExisting } from './types';
import { listFileEditors } from '@/plugins/registry';
import { isMobilePlatform } from '@/utils/platform';

interface TreeNodeProps {
  node: FileNode;
  currentFile: string | null;
  selectedPaths: Set<string>;
  onFileSelect: (path: string) => void;
  onToggleSelect: (path: string) => void;
  onRenameRequest: (path: string, newName: string) => void;
  onCancelRenaming: () => void;
  onCreateFile: (parentPath: string, name: string) => void;
  onCreateFolder: (parentPath: string, name: string) => void;
  renamingNode: { path: string; name: string } | null;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string, expanded: boolean) => void;
  onDeleteRequest: (paths: string[]) => void;
  onOpenInFinder: (path: string) => void;
  level?: number;
  isRoot?: boolean;
  openableExtensions?: string[];
  focusedPath?: string | null;
  onFocusedPathChange?: (path: string) => void;
  onFileClose?: (path: string) => void;
  t: (key: string) => string;
  onMenuHandleReady?: (handler: TreeNodeMenuHandler | null) => void;
}

export type TreeNodeMenuHandler = (x: number, y: number) => Promise<void>;

function ExpandArrow({
  isExpanded, hasChildren, tagColor,
}: {
  isExpanded: boolean;
  hasChildren: boolean;
  tagColor?: string | null;
}) {
  if (!hasChildren) {
    return (
      <span
        className={`expand-arrow dot cursor-default text-muted-foreground/60 ${tagColor ? 'tagged' : ''}`}
        data-tag-color={tagColor ?? undefined}
      >
        <Circle size={6} fill="currentColor" />
      </span>
    );
  }
  return (
    <span
      className={`expand-arrow ${isExpanded ? 'expanded' : ''}`}
      data-tag-color={tagColor ?? undefined}
    >
      <ChevronRight size={12} />
    </span>
  );
}

export function TreeNode({
  node, currentFile, selectedPaths, onFileSelect, onToggleSelect,
  onRenameRequest, onCancelRenaming, onCreateFile, onCreateFolder,
  renamingNode, expandedPaths, onToggleExpand, onDeleteRequest, onOpenInFinder,
  level = 0, isRoot = false, openableExtensions, focusedPath, onFocusedPathChange, onFileClose, t,
  onMenuHandleReady,
}: TreeNodeProps) {
  const isExpanded = expandedPaths ? expandedPaths.has(node.path) : isRoot;
  const [isLoading, setIsLoading] = useState(false);
  const [children, setChildren] = useState<FileNode[] | null>(node.children ?? null);
  const childrenRef = useRef(children);
  childrenRef.current = children;
  const [creatingNode, setCreatingNode] = useState<{ name: string; isDirectory: boolean } | null>(null);
  const treeChildrenRef = useHeightAnimation(isExpanded, { noAnimation: true });
  const { buildMenuItems } = useContextMenu();

  const loadChildren = useCallback(async (force = false, silent = false) => {
    if (!force && childrenRef.current !== null) return;
    if (!silent) setIsLoading(true);
    try {
      const result = await invoke<FileNode[]>('read_directory', { path: node.path });
      setChildren(result);
    } catch {
      setChildren([]);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [node.path]);

  const loadChildrenRef = useRef(loadChildren);
  loadChildrenRef.current = loadChildren;
  const nodeRef = useRef(node);
  const nodeChildrenRef = useRef(node.children);

  useEffect(() => {
    const nodeChanged = node !== nodeRef.current;
    nodeRef.current = node;
    const childrenChanged = node.children !== nodeChildrenRef.current;
    nodeChildrenRef.current = node.children;

    if (node.children !== undefined && node.children !== null && childrenChanged) {
      setChildren(node.children);
    } else if (isExpanded && (node.children === null || node.children === undefined) && nodeChanged) {
      loadChildrenRef.current(true, true);
    }
  }, [node, isExpanded]);

  const isSelected = node.path === currentFile;
  const isChecked = selectedPaths.has(node.path);
  const isFocused = focusedPath === node.path;
  const isRenamingHere = renamingNode?.path === node.path;
  // 右键改过颜色后先用本地值，等目录重新读取后再用后端返回的颜色
  const [tagColorOverride, setTagColorOverride] = useState<string | null | undefined>(undefined);
  const tagColor = tagColorOverride !== undefined ? tagColorOverride : (node.tagColor ?? null);
  const fileExt = getFileExt(node.name);
  const isOpenable = node.isDirectory || !openableExtensions || openableExtensions.length === 0 || openableExtensions.includes(fileExt);
  const extDisabled = !node.isDirectory && !isOpenable;

  // 目录重新读取后 node.tagColor 变化，此时以文件系统为准
  useEffect(() => {
    setTagColorOverride(undefined);
  }, [node.tagColor]);

  const handleClick = async (e: React.MouseEvent) => {
    if (isRenamingHere) return;
    if (extDisabled) return;
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      onToggleSelect(node.path);
    } else if (node.isDirectory) {
      if (!isExpanded && (children === null || children === undefined)) await loadChildren();
      onToggleExpand(node.path, !isExpanded);
    } else {
      onFileSelect(node.path);
    }
    if (!(e.ctrlKey || e.metaKey)) onFocusedPathChange?.(node.path);
  };

  const showMenuAt = async (x: number, y: number) => {
    if (isMobilePlatform()) return;
    if (node.isDirectory && (children === null || children === undefined)) await loadChildren();

    const items: any[] = [];

    const startCreateFile = (baseName: string) => {
      const existingNames = new Set((childrenRef.current ?? []).map((c) => c.name));
      const newName = generateUniqueNameWithExisting(existingNames, baseName, false);
      setCreatingNode({ name: newName, isDirectory: false });
      if (!isExpanded) {
        onToggleExpand(node.path, true);
      }
    };

    if (node.isDirectory) {
      items.push({
        id: 'new-file-markdown',
        text: t('directoryTree.newFileMarkdown'),
        action: () => startCreateFile(t('directoryTree.newFileDefaultName')),
      });
      // 其他文件类型由各自的文件编辑器贡献提供"新建 <类型>"项
      for (const editor of listFileEditors()) {
        const newFile = editor.newFile;
        if (!newFile) continue;
        items.push({
          id: `new-file-${editor.id}`,
          text: t(newFile.labelKey),
          action: () => startCreateFile(t(newFile.defaultFileNameKey)),
        });
      }
      items.push(await PredefinedMenuItem.new({ item: 'Separator' }));
      items.push({
        id: 'new-folder',
        text: t('directoryTree.newFolder'),
        action: () => {
          const existingNames = new Set((childrenRef.current ?? []).map((c) => c.name));
          const newName = generateUniqueNameWithExisting(existingNames, t('directoryTree.newFolderDefaultName'), true);
          setCreatingNode({ name: newName, isDirectory: true });
          if (!isExpanded) {
            onToggleExpand(node.path, true);
          }
        },
      });
    }

    const builtinItems = await buildMenuItems(node);
    if (builtinItems.length > 0) {
      if (items.length > 0) {
        items.push(await PredefinedMenuItem.new({ item: 'Separator' }));
      }
      items.push(...builtinItems);
    }

    // 颜色子菜单（仅 macOS，非 macOS 返回 null）
    // 根节点是打开的文件夹本身，颜色无处展示，因此不提供
    const colorSubmenu = isRoot
      ? null
      : await buildTagColorSubmenu(
          tagColor,
          { title: t('directoryTree.tagColor'), none: t('directoryTree.tagColorNone') },
          (color) => {
            invoke('set_file_tag_color', { path: node.path, color })
              .then(() => setTagColorOverride(color))
              .catch((err) => console.error('Failed to set file tag color:', err));
          },
        );
    if (colorSubmenu) {
      const block: any[] = items.length > 0
        ? [await PredefinedMenuItem.new({ item: 'Separator' }), colorSubmenu]
        : [colorSubmenu];
      // 放在"删除"之前：破坏性操作后面不跟子菜单
      const deleteIndex = items.findIndex((item: any) => item?.id === 'delete');
      const insertAt = deleteIndex > 0 && items[deleteIndex - 1]?.kind === 'Predefined'
        ? deleteIndex - 1
        : deleteIndex;
      if (insertAt >= 0) items.splice(insertAt, 0, ...block);
      else items.push(...block);
    }

    try {
      const menu = await Menu.new({ items });
      await menu.popup(new LogicalPosition(x + 1, y + 1));
    } catch (err) {
      console.error('Failed to show context menu:', err);
    }
  };

  const showMenuAtRef = useRef(showMenuAt);
  showMenuAtRef.current = showMenuAt;

  useEffect(() => {
    if (!onMenuHandleReady) return;
    const handler: TreeNodeMenuHandler = (x, y) => showMenuAtRef.current(x, y);
    onMenuHandleReady(handler);
    return () => onMenuHandleReady(null);
  }, [onMenuHandleReady]);

  const handleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await showMenuAt(e.clientX, e.clientY);
  };

  const handleConfirmRename = (newName: string) => {
    onRenameRequest(node.path, newName);
    onCancelRenaming();
  };

  const handleConfirmCreate = (newName: string) => {
    if (creatingNode) {
      if (creatingNode.isDirectory) onCreateFolder(node.path, newName);
      else onCreateFile(node.path, newName);
      setCreatingNode(null);
    }
  };

  const handleCancelCreate = () => setCreatingNode(null);

  const hasChildren = node.isDirectory;
  const indentWidth = 15;
  const guideLineOffset = 14.5;
  const basePadding = 8;
  const paddingValue = level * indentWidth + basePadding;

  return (
    <div className="tree-node">
      <div
        className={`tree-item ${isSelected ? 'selected' : ''} ${isChecked ? 'checked' : ''} ${extDisabled ? 'tree-item-disabled' : ''} ${isFocused ? 'focused' : ''}`}
        style={{ paddingLeft: `${paddingValue}px` }}
        data-tree-level={level}
        data-path={node.path}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        title={extDisabled ? t('directoryTree.notOpenable') : undefined}
      >
        {Array.from({ length: level }).map((_, i) => (
          <span key={i} className="tree-indent" style={{ left: `${i * indentWidth + guideLineOffset}px` }} />
        ))}
        {node.isDirectory ? (
          <ExpandArrow isExpanded={isExpanded} hasChildren={!!hasChildren} tagColor={tagColor} />
        ) : (
          <span
            className={`expand-arrow dot cursor-default text-muted-foreground/60 ${tagColor ? 'tagged' : ''}`}
            data-tag-color={tagColor ?? undefined}
          >
            <Circle size={6} fill="currentColor" />
          </span>
        )}
        {isLoading && <Loader2 className="file-icon" size={16} />}
        {isRenamingHere ? (
          <RenameInput initialName={node.name} onConfirm={handleConfirmRename} onCancel={onCancelRenaming} />
        ) : (
          <span className="file-name">
            {node.isDirectory ? node.name : (
              <>
                {getFileNameWithoutExt(node.name)}
                {getFileExt(node.name) && <span className="file-ext-tag">{getFileExt(node.name)}</span>}
              </>
            )}
          </span>
        )}
        {isSelected && !node.isDirectory && !isRenamingHere && (
          <button
            className="tree-item-close-btn"
            onClick={(e) => {
              e.stopPropagation();
              onFileClose?.(node.path);
            }}
            title={t('directoryTree.closeFile')}
          >
            <X size={12} />
          </button>
        )}
      </div>
      {node.isDirectory && (
        <div ref={treeChildrenRef} className="tree-children" onContextMenu={async (e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          e.stopPropagation();
          await showMenuAt(e.clientX, e.clientY);
        }}>
          {isLoading ? (
            <div style={{ paddingLeft: '8px', color: 'var(--muted-foreground)', fontSize: '11px' }}>
              {t('directoryTree.loading')}
            </div>
          ) : (
            <div className="tree-children-content">
              {creatingNode && (
                <CreatingNodeInput
                  name={creatingNode.name}
                  level={level + 1}
                  onConfirm={handleConfirmCreate}
                  onCancel={handleCancelCreate}
                />
              )}
              {children?.map((child) => (
                <TreeNode
                  key={child.path}
                  node={child}
                  currentFile={currentFile}
                  selectedPaths={selectedPaths}
                  onFileSelect={onFileSelect}
                  onToggleSelect={onToggleSelect}
                  onRenameRequest={onRenameRequest}
                  onCancelRenaming={onCancelRenaming}
                  onCreateFile={onCreateFile}
                  onCreateFolder={onCreateFolder}
                  renamingNode={renamingNode}
                  expandedPaths={expandedPaths}
                  onToggleExpand={onToggleExpand}
                  onDeleteRequest={onDeleteRequest}
                  onOpenInFinder={onOpenInFinder}
                  onFileClose={onFileClose}
                  level={level + 1}
                  openableExtensions={openableExtensions}
                  focusedPath={focusedPath}
                  onFocusedPathChange={onFocusedPathChange}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
