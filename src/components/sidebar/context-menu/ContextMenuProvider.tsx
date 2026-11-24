import { createContext, useContext, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { Menu, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { LogicalPosition } from '@tauri-apps/api/window';
import type { FileNode } from '@/components/sidebar/file-tree/types';
import { isMobilePlatform } from '@/utils/platform';

export interface ContextMenuAction {
  id: string;
  text: string;
  separator?: boolean;
  disabled?: boolean | ((node: FileNode) => boolean);
  visible?: (node: FileNode) => boolean;
  execute: (node: FileNode) => void;
}

interface ContextMenuContextValue {
  registerAction: (action: ContextMenuAction) => () => void;
  showMenu: (node: FileNode, x: number, y: number) => Promise<void>;
  buildMenuItems: (node: FileNode) => Promise<any[]>;
}

const ContextMenuContext = createContext<ContextMenuContextValue | null>(null);

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const actionsRef = useRef<ContextMenuAction[]>([]);

  const registerAction = useCallback((action: ContextMenuAction) => {
    actionsRef.current.push(action);
    return () => {
      actionsRef.current = actionsRef.current.filter(a => a.id !== action.id);
    };
  }, []);

  const buildMenuItems = useCallback(async (node: FileNode): Promise<any[]> => {
    let actions = actionsRef.current.filter(
      (a) => a.separator || !a.visible || a.visible(node),
    );
    actions = actions.filter((a, i) => !a.separator || (i > 0 && !actions[i - 1].separator));
    const tauriItems: any[] = [];

    for (const action of actions) {
      if (action.separator) {
        const sep = await PredefinedMenuItem.new({ item: 'Separator' });
        tauriItems.push(sep);
      } else {
        const disabled = typeof action.disabled === 'function' ? action.disabled(node) : action.disabled;
        tauriItems.push({
          id: action.id,
          text: action.text,
          enabled: !disabled,
          action: () => action.execute(node),
        });
      }
    }
    return tauriItems;
  }, []);

  const showMenu = useCallback(async (node: FileNode, x: number, y: number) => {
    // 移动端没有原生右键菜单（iOS 长按菜单另行处理）
    if (isMobilePlatform()) return;
    try {
      const items = await buildMenuItems(node);
      const menu = await Menu.new({ items });
      await menu.popup(new LogicalPosition(x + 1, y + 1));
    } catch (err) {
      console.error('Failed to show context menu:', err);
    }
  }, [buildMenuItems]);

  // context value 必须在渲染之间保持身份：否则父组件每次重渲染（如编辑时每键
  // 一次）都会把所有消费节点（整棵文件树）一起重渲染。
  const value = useMemo(
    () => ({ registerAction, showMenu, buildMenuItems }),
    [registerAction, showMenu, buildMenuItems],
  );

  return (
    <ContextMenuContext.Provider value={value}>
      {children}
    </ContextMenuContext.Provider>
  );
}

export function useContextMenu(): ContextMenuContextValue {
  const ctx = useContext(ContextMenuContext);
  if (!ctx) throw new Error('useContextMenu must be used within ContextMenuProvider');
  return ctx;
}
