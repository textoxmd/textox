import { useEffect } from 'react';
import { useContextMenu, type ContextMenuAction } from './ContextMenuProvider';
import { getPathRelativeToRoot } from '@/components/sidebar/file-tree/relativePath';

interface BuiltinActionsProps {
  onCreateFile: (parentPath: string, name: string) => void;
  onCreateFolder: (parentPath: string, name: string) => void;
  onRenameRequest: (path: string, newName: string) => void;
  onDeleteRequest: (paths: string[]) => void;
  onOpenInFinder: (path: string) => void;
  generateUniqueName: (existingNames: Set<string>, baseName: string, isDirectory: boolean) => string;
  getNodeChildren: (nodePath: string) => { name: string }[];
  t: (key: string) => string;
  selectedPaths: Set<string>;
  rootPath: string;
}

export function BuiltinContextMenuActions(props: BuiltinActionsProps) {
  const { registerAction } = useContextMenu();
  const {
    onCreateFile, onCreateFolder, onRenameRequest, onDeleteRequest,
    onOpenInFinder, generateUniqueName, getNodeChildren, t, selectedPaths, rootPath,
  } = props;

  useEffect(() => {
    const actions: ContextMenuAction[] = [];

    actions.push({
      id: 'rename',
      text: t('directoryTree.rename'),
      visible: (node) => node.path !== rootPath,
      execute: (node) => onRenameRequest(node.path, ''),
    });

    actions.push({ id: 'sep-1', separator: true, text: '', execute: () => {} });

    actions.push({
      id: 'show-in-finder',
      text: t('directoryTree.showInFinder'),
      visible: (node) => node.path !== rootPath,
      execute: (node) => onOpenInFinder(node.path),
    });

    actions.push({
      id: 'copy-path',
      text: t('directoryTree.copyPath'),
      execute: (node) => {
        navigator.clipboard.writeText(node.path).catch(console.error);
      },
    });

    actions.push({
      id: 'copy-relative-path',
      text: t('directoryTree.copyRelativePath'),
      execute: (node) => {
        navigator.clipboard.writeText(getPathRelativeToRoot(rootPath, node.path)).catch(console.error);
      },
    });

    actions.push({ id: 'sep-2', separator: true, text: '', execute: () => {} });

    actions.push({
      id: 'delete',
      text: t('directoryTree.delete'),
      visible: (node) => node.path !== rootPath,
      execute: (node) => {
        const paths = selectedPaths.size > 0 ? Array.from(selectedPaths) : [node.path];
        onDeleteRequest(paths);
      },
    });

    const unregisters = actions.map(a => registerAction(a));
    return () => unregisters.forEach(u => u());
  }, [onCreateFile, onCreateFolder, onRenameRequest, onDeleteRequest, onOpenInFinder, generateUniqueName, getNodeChildren, t, selectedPaths, registerAction, rootPath]);

  return null;
}
