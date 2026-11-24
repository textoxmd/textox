import { createContext, useContext, useCallback, useMemo, useRef, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { FileNode } from '@/components/sidebar/file-tree/types';

export interface ShortcutBinding {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  when?: () => boolean;
  handler: (node: FileNode) => void;
  description?: string;
}

interface ShortcutContextValue {
  register: (binding: ShortcutBinding) => () => void;
  matchShortcut: (e: ReactKeyboardEvent, node: FileNode | null) => boolean;
}

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

export function ShortcutProvider({ children }: { children: ReactNode }) {
  const bindingsRef = useRef<ShortcutBinding[]>([]);

  const register = useCallback((binding: ShortcutBinding) => {
    bindingsRef.current.push(binding);
    return () => {
      bindingsRef.current = bindingsRef.current.filter(b => b !== binding);
    };
  }, []);

  const matchShortcut = useCallback((e: ReactKeyboardEvent, node: FileNode | null) => {
    if (!node) return false;
    for (const binding of bindingsRef.current) {
      const mod = e.metaKey || e.ctrlKey;
      if (
        e.key === binding.key &&
        !!mod === !!binding.mod &&
        !!e.shiftKey === !!binding.shift &&
        !!e.altKey === !!binding.alt
      ) {
        if (binding.when && !binding.when()) continue;
        e.preventDefault();
        binding.handler(node);
        return true;
      }
    }
    return false;
  }, []);

  // 同 ContextMenuProvider：value 身份稳定，避免编辑时每键重渲染整棵文件树
  const value = useMemo(() => ({ register, matchShortcut }), [register, matchShortcut]);

  return (
    <ShortcutContext.Provider value={value}>
      {children}
    </ShortcutContext.Provider>
  );
}

export function useTreeNodeShortcuts(): ShortcutContextValue {
  const ctx = useContext(ShortcutContext);
  if (!ctx) throw new Error('useTreeNodeShortcuts must be used within ShortcutProvider');
  return ctx;
}
