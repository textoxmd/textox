import { useEffect } from 'react';
import { useTreeNodeShortcuts } from './ShortcutProvider';

interface BuiltinShortcutsProps {
  onOpenNode: (path: string) => void;
  onToggleExpand: (path: string) => void;
  onDelete: (paths: string[]) => void;
  hasSelection: () => boolean;
  hasSingleSelection: () => boolean;
}

export function BuiltinTreeShortcuts(props: BuiltinShortcutsProps) {
  const { register } = useTreeNodeShortcuts();
  const { onOpenNode, onToggleExpand, onDelete, hasSelection, hasSingleSelection } = props;

  useEffect(() => {
    const unreg1 = register({
      key: 'Enter',
      handler: (node) => {
        if (node.isDirectory) {
          onToggleExpand(node.path);
        } else {
          onOpenNode(node.path);
        }
      },
      when: hasSingleSelection,
    });

    const unreg2 = register({
      key: 'Enter',
      mod: true,
      handler: (node) => {
        if (node.isDirectory) {
          onToggleExpand(node.path);
        } else {
          onOpenNode(node.path);
        }
      },
      when: hasSingleSelection,
    });

    const unreg3 = register({
      key: 'Delete',
      handler: (node) => onDelete([node.path]),
      when: hasSelection,
    });

    return () => { unreg1(); unreg2(); unreg3(); };
  }, [register, onOpenNode, onToggleExpand, onDelete, hasSelection, hasSingleSelection]);

  return null;
}
