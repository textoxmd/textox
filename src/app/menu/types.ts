/** 预定义菜单项（映射到 Rust 的 PredefinedMenuItem）。C1 未使用，供 C2 扩展。 */
export type PredefinedName =
  | 'copy' | 'cut' | 'paste' | 'select_all' | 'undo' | 'redo'
  | 'about' | 'services' | 'hide' | 'hide_others' | 'show_all' | 'quit';

export type MenuItemSpec =
  | {
      kind: 'item';
      id: string;
      labelKey: string;
      /** 已翻译的文案。插件文案只在 WebView 的 i18next 里，Rust 侧翻不出来。 */
      label?: string;
      acceleratorAction?: string;
      enabled?: boolean;
    }
  | {
      kind: 'check';
      id: string;
      labelKey: string;
      label?: string;
      checked: boolean;
      acceleratorAction?: string;
      enabled?: boolean;
    }
  | { kind: 'separator' }
  | { kind: 'predefined'; name: PredefinedName };

export interface SubmenuSpec {
  /** 目标子菜单的 id（如 'export_submenu'）。 */
  id: string;
  labelKey: string;
  items: MenuItemSpec[];
}
