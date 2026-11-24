/**
 * 快捷键配置管理模块
 * 提供快捷键配置的加载、保存、验证和冲突检测功能
 */

import { logger } from './logger';

/**
 * 快捷键动作定义
 */
export interface ShortcutAction {
  /** 动作唯一标识 */
  id: string;
  /** 动作显示名称 */
  name: string;
  /** 动作描述 */
  description: string;
  /** 动作分类 */
  category: 'file' | 'edit' | 'view' | 'format' | 'paragraph' | 'window' | 'help';
  /** 默认快捷键 */
  defaultShortcut: string;
  /** 当前快捷键（null 表示未设置） */
  currentShortcut: string | null;
  /** 是否为内置快捷键（不可编辑） */
  builtIn?: true;
}

/**
 * 快捷键配置
 */
export interface ShortcutsConfig {
  /** 配置版本号 */
  version: number;
  /** 快捷键映射表 */
  shortcuts: Record<string, string | null>;
}

/**
 * 快捷键冲突信息
 */
export interface ShortcutConflict {
  /** 冲突的动作ID */
  actionId: string;
  /** 冲突的动作名称 */
  actionName: string;
  /** 冲突的快捷键 */
  shortcut: string;
}

// 本地存储键名
const SHORTCUTS_STORAGE_KEY = 'texto_shortcuts_config';

// 内存缓存
let shortcutsConfigCache: ShortcutsConfig | null = null;

// 平台无关基础默认值
const BASE_DEFAULTS: Record<string, string> = {
  'new_window': 'Cmd+N',
  'open_file': 'Cmd+O',
  'open_folder': 'Cmd+Shift+O',
  'save_file': 'Cmd+S',
  'open_file_location': 'Cmd+Shift+L',
  'export_pdf': 'Cmd+Shift+S',
  // Cmd+P 已被命令面板占用（硬编码），打印默认用 Cmd+Shift+P
  'print_document': 'Cmd+Shift+P',
  'undo': 'Cmd+Z',
  'redo': 'Cmd+Shift+Z',
  'redo_alt': 'Cmd+Y',
  'select_line': 'Cmd+L',
  'toggle_bold': 'Cmd+B',
  'command_palette': 'Cmd+P',
  'cut': 'Cmd+X',
  'copy': 'Cmd+C',
  'paste': 'Cmd+V',
  'select_all': 'Cmd+A',
  'toggle_sidebar': 'Cmd+T',
  'toggle_edit_mode': 'Cmd+/',
  'toggle_typewriter_mode': 'Cmd+Shift+T',
  'heading_1': 'Cmd+1',
  'heading_2': 'Cmd+2',
  'heading_3': 'Cmd+3',
  'heading_4': 'Cmd+4',
  'heading_5': 'Cmd+5',
  'heading_6': 'Cmd+6',
  'bullet_list': 'Cmd+Shift+7',
  'ordered_list': 'Cmd+Shift+8',
  'task_list': 'Cmd+Shift+9',
  'code_block': 'Cmd+Shift+C',
  'blockquote': 'Cmd+Shift+B',
  'horizontal_rule': 'Cmd+Shift+-',
  'image': 'Cmd+Shift+I',
  'minimize': 'Cmd+M',
  'fullscreen': 'Cmd+Ctrl+F',
  'center': 'Cmd+Opt+C',
};

// 平台特定的快捷键覆盖（仅在快捷键因平台而异时定义）
const PLATFORM_OVERRIDES: Record<string, { mac?: string; windows?: string; linux?: string }> = {
  'fullscreen': { windows: 'F11', linux: 'F11' },
};

function getPlatform(): 'mac' | 'windows' | 'linux' {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('mac')) return 'mac';
  if (platform.includes('win')) return 'windows';
  return 'linux';
}

const CURRENT_PLATFORM = getPlatform();

// 计算当前平台的默认快捷键配置
export const DEFAULT_SHORTCUTS: Record<string, string> = (() => {
  const defaults = { ...BASE_DEFAULTS };
  for (const [key, override] of Object.entries(PLATFORM_OVERRIDES)) {
    const val = override[CURRENT_PLATFORM];
    if (val) defaults[key] = val;
  }
  return defaults;
})();

// 快捷键动作定义列表
export const SHORTCUT_ACTIONS: ShortcutAction[] = (() => {
  const actions: ShortcutAction[] = [
    { id: 'new_window', name: 'shortcuts.action.newWindow', description: 'shortcuts.action.newWindowDesc', category: 'file', defaultShortcut: 'Cmd+N', currentShortcut: 'Cmd+N' },
    { id: 'open_file', name: 'shortcuts.action.openFile', description: 'shortcuts.action.openFileDesc', category: 'file', defaultShortcut: 'Cmd+O', currentShortcut: 'Cmd+O' },
    { id: 'open_folder', name: 'shortcuts.action.openFolder', description: 'shortcuts.action.openFolderDesc', category: 'file', defaultShortcut: 'Cmd+Shift+O', currentShortcut: 'Cmd+Shift+O' },
    { id: 'save_file', name: 'shortcuts.action.saveFile', description: 'shortcuts.action.saveFileDesc', category: 'file', defaultShortcut: 'Cmd+S', currentShortcut: 'Cmd+S' },
    { id: 'open_file_location', name: 'shortcuts.action.openFileLocation', description: 'shortcuts.action.openFileLocationDesc', category: 'file', defaultShortcut: 'Cmd+Shift+L', currentShortcut: 'Cmd+Shift+L' },
    { id: 'undo', name: 'shortcuts.action.undo', description: 'shortcuts.action.undoDesc', category: 'edit', defaultShortcut: 'Cmd+Z', currentShortcut: 'Cmd+Z', builtIn: true },
    { id: 'redo', name: 'shortcuts.action.redo', description: 'shortcuts.action.redoDesc', category: 'edit', defaultShortcut: 'Cmd+Shift+Z', currentShortcut: 'Cmd+Shift+Z', builtIn: true },
    { id: 'redo_alt', name: 'shortcuts.action.redoAlt', description: 'shortcuts.action.redoAltDesc', category: 'edit', defaultShortcut: 'Cmd+Y', currentShortcut: 'Cmd+Y', builtIn: true },
    { id: 'select_line', name: 'shortcuts.action.selectLine', description: 'shortcuts.action.selectLineDesc', category: 'edit', defaultShortcut: 'Cmd+L', currentShortcut: 'Cmd+L', builtIn: true },
    { id: 'toggle_bold', name: 'shortcuts.action.toggleBold', description: 'shortcuts.action.toggleBoldDesc', category: 'format', defaultShortcut: 'Cmd+B', currentShortcut: 'Cmd+B', builtIn: true },
    { id: 'command_palette', name: 'shortcuts.action.commandPalette', description: 'shortcuts.action.commandPaletteDesc', category: 'edit', defaultShortcut: 'Cmd+P', currentShortcut: 'Cmd+P', builtIn: true },
    { id: 'cut', name: 'shortcuts.action.cut', description: 'shortcuts.action.cutDesc', category: 'edit', defaultShortcut: 'Cmd+X', currentShortcut: 'Cmd+X', builtIn: true },
    { id: 'copy', name: 'shortcuts.action.copy', description: 'shortcuts.action.copyDesc', category: 'edit', defaultShortcut: 'Cmd+C', currentShortcut: 'Cmd+C', builtIn: true },
    { id: 'paste', name: 'shortcuts.action.paste', description: 'shortcuts.action.pasteDesc', category: 'edit', defaultShortcut: 'Cmd+V', currentShortcut: 'Cmd+V', builtIn: true },
    { id: 'select_all', name: 'shortcuts.action.selectAll', description: 'shortcuts.action.selectAllDesc', category: 'edit', defaultShortcut: 'Cmd+A', currentShortcut: 'Cmd+A', builtIn: true },
    { id: 'toggle_sidebar', name: 'shortcuts.action.toggleSidebar', description: 'shortcuts.action.toggleSidebarDesc', category: 'view', defaultShortcut: 'Cmd+T', currentShortcut: 'Cmd+T' },
    { id: 'toggle_edit_mode', name: 'shortcuts.action.toggleEditMode', description: 'shortcuts.action.toggleEditModeDesc', category: 'view', defaultShortcut: 'Cmd+/', currentShortcut: 'Cmd+/' },
    { id: 'toggle_typewriter_mode', name: 'shortcuts.action.toggleTypewriterMode', description: 'shortcuts.action.toggleTypewriterModeDesc', category: 'view', defaultShortcut: 'Cmd+Shift+T', currentShortcut: 'Cmd+Shift+T' },
    { id: 'heading_1', name: 'shortcuts.action.heading1', description: 'shortcuts.action.heading1Desc', category: 'paragraph', defaultShortcut: 'Cmd+1', currentShortcut: 'Cmd+1' },
    { id: 'heading_2', name: 'shortcuts.action.heading2', description: 'shortcuts.action.heading2Desc', category: 'paragraph', defaultShortcut: 'Cmd+2', currentShortcut: 'Cmd+2' },
    { id: 'heading_3', name: 'shortcuts.action.heading3', description: 'shortcuts.action.heading3Desc', category: 'paragraph', defaultShortcut: 'Cmd+3', currentShortcut: 'Cmd+3' },
    { id: 'heading_4', name: 'shortcuts.action.heading4', description: 'shortcuts.action.heading4Desc', category: 'paragraph', defaultShortcut: 'Cmd+4', currentShortcut: 'Cmd+4' },
    { id: 'heading_5', name: 'shortcuts.action.heading5', description: 'shortcuts.action.heading5Desc', category: 'paragraph', defaultShortcut: 'Cmd+5', currentShortcut: 'Cmd+5' },
    { id: 'heading_6', name: 'shortcuts.action.heading6', description: 'shortcuts.action.heading6Desc', category: 'paragraph', defaultShortcut: 'Cmd+6', currentShortcut: 'Cmd+6' },
    { id: 'bullet_list', name: 'shortcuts.action.bulletList', description: 'shortcuts.action.bulletListDesc', category: 'paragraph', defaultShortcut: 'Cmd+Shift+7', currentShortcut: 'Cmd+Shift+7' },
    { id: 'ordered_list', name: 'shortcuts.action.orderedList', description: 'shortcuts.action.orderedListDesc', category: 'paragraph', defaultShortcut: 'Cmd+Shift+8', currentShortcut: 'Cmd+Shift+8' },
    { id: 'task_list', name: 'shortcuts.action.taskList', description: 'shortcuts.action.taskListDesc', category: 'paragraph', defaultShortcut: 'Cmd+Shift+9', currentShortcut: 'Cmd+Shift+9' },
    { id: 'code_block', name: 'shortcuts.action.codeBlock', description: 'shortcuts.action.codeBlockDesc', category: 'paragraph', defaultShortcut: 'Cmd+Shift+C', currentShortcut: 'Cmd+Shift+C' },
    { id: 'blockquote', name: 'shortcuts.action.blockquote', description: 'shortcuts.action.blockquoteDesc', category: 'paragraph', defaultShortcut: 'Cmd+Shift+B', currentShortcut: 'Cmd+Shift+B' },
    { id: 'horizontal_rule', name: 'shortcuts.action.horizontalRule', description: 'shortcuts.action.horizontalRuleDesc', category: 'paragraph', defaultShortcut: 'Cmd+Shift+-', currentShortcut: 'Cmd+Shift+-' },
    { id: 'image', name: 'shortcuts.action.image', description: 'shortcuts.action.imageDesc', category: 'paragraph', defaultShortcut: 'Cmd+Shift+I', currentShortcut: 'Cmd+Shift+I' },
    { id: 'minimize', name: 'shortcuts.action.minimize', description: 'shortcuts.action.minimizeDesc', category: 'window', defaultShortcut: 'Cmd+M', currentShortcut: 'Cmd+M' },
    { id: 'fullscreen', name: 'shortcuts.action.fullscreen', description: 'shortcuts.action.fullscreenDesc', category: 'window', defaultShortcut: 'Cmd+Ctrl+F', currentShortcut: 'Cmd+Ctrl+F' },
    { id: 'center', name: 'shortcuts.action.center', description: 'shortcuts.action.centerDesc', category: 'window', defaultShortcut: 'Cmd+Opt+C', currentShortcut: 'Cmd+Opt+C' },
  ];

  for (const action of actions) {
    const override = PLATFORM_OVERRIDES[action.id];
    if (override) {
      const val = override[CURRENT_PLATFORM];
      if (val) {
        action.defaultShortcut = val;
        action.currentShortcut = val;
      }
    }
  }
  return actions;
})();

/**
 * 获取默认快捷键配置
 */
export function getDefaultShortcutsConfig(): ShortcutsConfig {
  return {
    version: 1,
    shortcuts: { ...DEFAULT_SHORTCUTS },
  };
}

/**
 * 从本地存储加载快捷键配置
 */
export function loadShortcutsConfig(): ShortcutsConfig {
  // 如果有缓存，直接返回缓存
  if (shortcutsConfigCache) {
    return shortcutsConfigCache;
  }

  try {
    const stored = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
    if (stored) {
      const config: ShortcutsConfig = JSON.parse(stored);
      // 合并默认配置（处理新增快捷键）
      shortcutsConfigCache = {
        version: config.version,
        shortcuts: {
          ...DEFAULT_SHORTCUTS,
          ...config.shortcuts,
        },
      };
      return shortcutsConfigCache;
    }
  } catch (e) {
    console.error('Failed to load shortcuts config:', e);
  }
  shortcutsConfigCache = getDefaultShortcutsConfig();
  return shortcutsConfigCache;
}

/**
 * 清除快捷键配置缓存（在配置变化时调用）
 */
export function clearShortcutsConfigCache(): void {
  shortcutsConfigCache = null;
}

/**
 * 保存快捷键配置到本地存储和后端
 */
export async function saveShortcutsConfig(config: ShortcutsConfig): Promise<void> {
  try {
    // 清除缓存，确保下次读取最新配置
    clearShortcutsConfigCache();

    // 保存到 localStorage
    localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(config));

    // 同步到后端文件，使系统菜单快捷键生效
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_shortcuts_config', { config });
    } catch (e) {
      // 如果不在 Tauri 环境中，忽略错误
      logger.log('Not in Tauri environment, skipping backend sync');
    }
  } catch (e) {
    console.error('Failed to save shortcuts config:', e);
  }
}

/**
 * 更新单个快捷键
 */
export function updateShortcut(
  config: ShortcutsConfig,
  actionId: string,
  shortcut: string | null
): ShortcutsConfig {
  return {
    ...config,
    shortcuts: {
      ...config.shortcuts,
      [actionId]: shortcut,
    },
  };
}

/**
 * 重置所有快捷键为默认值
 */
export function resetShortcutsToDefault(): ShortcutsConfig {
  return getDefaultShortcutsConfig();
}

/**
 * 获取指定动作的默认快捷键
 */
export function getDefaultShortcut(actionId: string): string | null {
  return DEFAULT_SHORTCUTS[actionId] || null;
}

/**
 * 验证快捷键格式是否有效
 */
export function isValidShortcut(shortcut: string): boolean {
  if (!shortcut || shortcut.trim() === '') {
    return false;
  }

  // 支持的修饰键
  const modifiers = ['Cmd', 'Ctrl', 'Alt', 'Shift', 'Option'];
  // 支持的功能键
  const functionKeys = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];
  // 支持的特殊键
  const specialKeys = ['Enter', 'Return', 'Tab', 'Space', 'Backspace', 'Delete', 'Escape', 'Esc', 'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right'];

  const parts = shortcut.split('+').map(p => p.trim());

  if (parts.length === 0) {
    return false;
  }

  // 检查是否至少有一个有效键
  let hasKey = false;

  for (const part of parts) {
    if (modifiers.includes(part)) {
      // 修饰键，继续检查
    } else if (functionKeys.includes(part)) {
      hasKey = true;
    } else if (specialKeys.includes(part)) {
      hasKey = true;
    } else if (part.length === 1) {
      // 单字符键（字母、数字、符号）
      hasKey = true;
    }
  }

  // 快捷键必须包含至少一个键
  return hasKey;
}

/**
 * 检测快捷键冲突
 */
export function detectConflicts(config: ShortcutsConfig): Map<string, ShortcutConflict[]> {
  const conflicts = new Map<string, ShortcutConflict[]>();
  const shortcutMap = new Map<string, string[]>();

  // 收集所有快捷键及其对应的动作
  for (const [actionId, shortcut] of Object.entries(config.shortcuts)) {
    if (shortcut) {
      const actions = shortcutMap.get(shortcut) || [];
      actions.push(actionId);
      shortcutMap.set(shortcut, actions);
    }
  }

  // 找出冲突（同一个快捷键对应多个动作）
  for (const [shortcut, actionIds] of shortcutMap.entries()) {
    if (actionIds.length > 1) {
      const conflictList: ShortcutConflict[] = actionIds.map(id => {
        const action = SHORTCUT_ACTIONS.find(a => a.id === id);
        return {
          actionId: id,
          actionName: action?.name || id,
          shortcut,
        };
      });

      // 为每个冲突的动作记录冲突信息
      for (const conflict of conflictList) {
        const others = conflictList.filter(c => c.actionId !== conflict.actionId);
        conflicts.set(conflict.actionId, others);
      }
    }
  }

  return conflicts;
}

/**
 * 获取某个动作的冲突信息
 */
export function getConflictsForAction(
  config: ShortcutsConfig,
  actionId: string
): ShortcutConflict[] {
  const allConflicts = detectConflicts(config);
  return allConflicts.get(actionId) || [];
}

/**
 * 获取所有存在冲突的快捷键
 */
export function getAllConflicts(config: ShortcutsConfig): Map<string, ShortcutConflict[]> {
  return detectConflicts(config);
}

/**
 * 检测指定快捷键与已有配置的冲突
 * @param config 当前配置
 * @param shortcut 要检测的快捷键
 * @param excludeActionId 排除的动作ID（编辑自己的时候不把自己算冲突）
 * @returns 冲突列表
 */
export function findConflictsForShortcut(
  config: ShortcutsConfig,
  shortcut: string,
  excludeActionId?: string
): ShortcutConflict[] {
  const conflicts: ShortcutConflict[] = [];

  for (const [actionId, value] of Object.entries(config.shortcuts)) {
    if (value === shortcut && actionId !== excludeActionId) {
      const action = SHORTCUT_ACTIONS.find(a => a.id === actionId);
      conflicts.push({
        actionId,
        actionName: action?.name || actionId,
        shortcut,
      });
    }
  }

  return conflicts;
}

/**
 * 将快捷键转换为显示格式（根据操作系统显示相应符号）
 */
export function formatShortcutDisplay(shortcut: string | null): string {
  if (!shortcut) return '未设置';

  const platform = getPlatform();
  const parts = shortcut.split('+').map(p => p.trim());

  // macOS 修饰键顺序：Control (⌃) → Option (⌥) → Shift (⇧) → Command (⌘)
  const macModifierOrder = ['Ctrl', 'Alt', 'Option', 'Opt', 'Shift', 'Cmd'];
  // Windows/Linux 修饰键顺序：Ctrl → Alt → Shift → Win
  const winModifierOrder = ['Ctrl', 'Alt', 'Option', 'Opt', 'Shift', 'Cmd'];

  const modifierOrder = platform === 'mac' ? macModifierOrder : winModifierOrder;

  // 分离修饰键和普通键
  const modifiers: string[] = [];
  const keys: string[] = [];

  for (const part of parts) {
    if (modifierOrder.includes(part)) {
      modifiers.push(part);
    } else {
      keys.push(part);
    }
  }

  // 按标准顺序排序修饰键
  modifiers.sort((a, b) => modifierOrder.indexOf(a) - modifierOrder.indexOf(b));

  // 转换符号
  const formatPart = (part: string): string => {
    if (platform === 'mac') {
      switch (part) {
        case 'Cmd':
          return '⌘';
        case 'Ctrl':
          return '⌃';
        case 'Alt':
        case 'Option':
        case 'Opt':
          return '⌥';
        case 'Shift':
          return '⇧';
        case 'Enter':
        case 'Return':
          return '↩';
        case 'Tab':
          return '⇥';
        case 'Backspace':
          return '⌫';
        case 'Delete':
          return '⌦';
        case 'Escape':
        case 'Esc':
          return '⎋';
        case 'Up':
          return '↑';
        case 'Down':
          return '↓';
        case 'Left':
          return '←';
        case 'Right':
          return '→';
        case '/':
          return '/';
        default:
          // 单字母大写显示
          if (part.length === 1 && /[a-zA-Z]/.test(part)) {
            return part.toUpperCase();
          }
          return part;
      }
    }

    // Windows/Linux 显示
    switch (part) {
      case 'Cmd':
        return 'Ctrl';
      case 'Alt':
      case 'Option':
      case 'Opt':
        return 'Alt';
      case 'Enter':
      case 'Return':
        return 'Enter';
      case 'Escape':
      case 'Esc':
        return 'Esc';
      case 'Up':
        return '↑';
      case 'Down':
        return '↓';
      case 'Left':
        return '←';
      case 'Right':
        return '→';
      default:
        if (part.length === 1 && /[a-zA-Z]/.test(part)) {
          return part.toUpperCase();
        }
        return part;
    }
  };

  const formattedModifiers = modifiers.map(formatPart);
  const formattedKeys = keys.map(formatPart);

  if (platform === 'mac') {
    return [...formattedModifiers, ...formattedKeys].join('');
  } else {
    return [...formattedModifiers, ...formattedKeys].join('+');
  }
}

/**
 * 将快捷键转换为按键数组（用于 tag 显示）
 */
export function formatShortcutToTags(shortcut: string | null): string[] {
  if (!shortcut) return [];

  const platform = getPlatform();
  const parts = shortcut.split('+').map(p => p.trim());

  // macOS 修饰键顺序：Control (⌃) → Option (⌥) → Shift (⇧) → Command (⌘)
  const macModifierOrder = ['Ctrl', 'Alt', 'Option', 'Shift', 'Cmd'];
  // Windows/Linux 修饰键顺序：Ctrl → Alt → Shift → Win
  const winModifierOrder = ['Ctrl', 'Alt', 'Option', 'Shift', 'Cmd'];

  const modifierOrder = platform === 'mac' ? macModifierOrder : winModifierOrder;

  // 分离修饰键和普通键
  const modifiers: string[] = [];
  const keys: string[] = [];

  for (const part of parts) {
    if (modifierOrder.includes(part)) {
      modifiers.push(part);
    } else {
      keys.push(part);
    }
  }

  // 按标准顺序排序修饰键
  modifiers.sort((a, b) => modifierOrder.indexOf(a) - modifierOrder.indexOf(b));

  // 转换符号
  const formatPart = (part: string): string => {
    if (platform === 'mac') {
      switch (part) {
        case 'Cmd':
          return '⌘';
        case 'Ctrl':
          return '⌃';
        case 'Alt':
        case 'Option':
        case 'Opt':
          return '⌥';
        case 'Shift':
          return '⇧';
        case 'Enter':
        case 'Return':
          return '↩';
        case 'Tab':
          return '⇥';
        case 'Backspace':
          return '⌫';
        case 'Delete':
          return '⌦';
        case 'Escape':
        case 'Esc':
          return '⎋';
        case 'Up':
          return '↑';
        case 'Down':
          return '↓';
        case 'Left':
          return '←';
        case 'Right':
          return '→';
        case '/':
          return '/';
        default:
          // 单字母大写显示
          if (part.length === 1 && /[a-zA-Z]/.test(part)) {
            return part.toUpperCase();
          }
          return part;
      }
    }

    // Windows/Linux 显示
    switch (part) {
      case 'Cmd':
        return 'Ctrl';
      case 'Alt':
      case 'Option':
      case 'Opt':
        return 'Alt';
      case 'Ctrl':
        return 'Ctrl';
      case 'Shift':
        return 'Shift';
      case 'Enter':
      case 'Return':
        return 'Enter';
      case 'Tab':
        return 'Tab';
      case 'Backspace':
        return 'Backspace';
      case 'Delete':
        return 'Delete';
      case 'Escape':
      case 'Esc':
        return 'Esc';
      case 'Up':
        return '↑';
      case 'Down':
        return '↓';
      case 'Left':
        return '←';
      case 'Right':
        return '→';
      default:
        if (part.length === 1 && /[a-zA-Z]/.test(part)) {
          return part.toUpperCase();
        }
        return part;
    }
  };

  const formattedModifiers = modifiers.map(formatPart);
  const formattedKeys = keys.map(formatPart);

  return [...formattedModifiers, ...formattedKeys];
}

/**
 * 将快捷键转换为 Tauri 加速器格式
 */
export function toTauriAccelerator(shortcut: string): string {
  // Tauri 使用 Command 而不是 Cmd，Option 而不是 Opt
  return shortcut
    .replace('Cmd', 'Command')
    .replace('Opt', 'Option');
}

// 修饰键识别表
const MODIFIER_KEYS = new Set(['Cmd', 'Ctrl', 'Alt', 'Shift', 'Option', 'Opt']);

/**
 * 解析快捷键字符串，提取修饰键和主键
 */
function parseShortcut(shortcut: string): { modifiers: string[]; mainKey: string | null } {
  const parts = shortcut.split('+').map(p => p.trim());
  const modifiers = parts.filter(p => MODIFIER_KEYS.has(p));
  const mainKey = parts.find(p => !MODIFIER_KEYS.has(p)) || null;
  return { modifiers, mainKey };
}

/**
 * 计算快捷键的特异性（修饰键数量越多越具体）
 */
function shortcutSpecificity(shortcut: string): number {
  const { modifiers } = parseShortcut(shortcut);
  return modifiers.length;
}

/**
 * 宽松匹配键盘事件与快捷键字符串
 * 只检查快捷键要求的修饰键是否按下，不拒多余的修饰键
 */
function looseMatch(shortcut: string, event: KeyboardEvent): boolean {
  const { modifiers, mainKey } = parseShortcut(shortcut);

  if (!mainKey) return false;

  const needsCmd = modifiers.includes('Cmd');
  const needsCtrl = modifiers.includes('Ctrl');
  const needsAlt = modifiers.includes('Alt') || modifiers.includes('Option') || modifiers.includes('Opt');
  const needsShift = modifiers.includes('Shift');

  if (needsCmd) {
    if (getPlatform() === 'mac') {
      if (!event.metaKey) return false;
    } else {
      if (!event.ctrlKey) return false;
    }
  }
  if (needsCtrl && !event.ctrlKey) return false;
  if (needsAlt && !event.altKey) return false;
  if (needsShift && !event.shiftKey) return false;

  const key = event.key;
  if (mainKey.length === 1) {
    return key.toLowerCase() === mainKey.toLowerCase();
  }
  return key === mainKey || event.code === mainKey;
}

/**
 * 匹配键盘事件与快捷键配置
 */
export function matchShortcut(event: KeyboardEvent, actionId: string, config?: ShortcutsConfig): boolean {
  const shortcutsConfig = config || loadShortcutsConfig();
  const shortcut = shortcutsConfig.shortcuts[actionId];
  if (!shortcut) return false;
  return looseMatch(shortcut, event);
}

/**
 * 从一组快捷键候选中找出与事件最匹配的 actionId
 *
 * 采用前缀匹配（最长优先）策略：
 * 1. 找出所有宽松匹配的快捷键
 * 2. 按特异性（修饰键数量）降序排列
 * 3. 最具体的（修饰键最多）胜出
 *
 * 这样可以避免 Cmd+S 误拦截 Cmd+Shift+S，无需依赖注册顺序或负向匹配。
 */
export function resolveBestShortcut(
  event: KeyboardEvent,
  actionIds: string[],
  config?: ShortcutsConfig
): string | null {
  const shortcutsConfig = config || loadShortcutsConfig();
  const matched: { actionId: string; specificity: number }[] = [];

  for (const actionId of actionIds) {
    const shortcut = shortcutsConfig.shortcuts[actionId];
    if (shortcut && looseMatch(shortcut, event)) {
      matched.push({ actionId, specificity: shortcutSpecificity(shortcut) });
    }
  }

  if (matched.length === 0) return null;

  // 按特异性降序排列，修饰键最多的排前面
  matched.sort((a, b) => b.specificity - a.specificity);

  // 相同特异性时，第一个注册的胜出（稳定排序）
  return matched[0].actionId;
}

/**
 * 获取动作的当前快捷键
 */
export function getActionShortcut(actionId: string, config?: ShortcutsConfig): string | null {
  const shortcutsConfig = config || loadShortcutsConfig();
  return shortcutsConfig.shortcuts[actionId] || null;
}

/**
 * 监听快捷键配置变化（来自后端广播）
 * @param callback 配置变化时的回调函数
 * @returns 取消监听的函数
 */
export function listenShortcutsConfigChanges(
  callback: (config: ShortcutsConfig) => void
): () => void {
  let unlisten: (() => void) | undefined;

  // 尝试监听 Tauri 事件
  const setupListener = async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<ShortcutsConfig>('shortcuts-config-changed', (event) => {
        // 清除缓存，确保下次读取最新配置
        clearShortcutsConfigCache();
        // 更新本地存储
        localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(event.payload));
        // 调用回调
        callback(event.payload);
      });
    } catch (e) {
      logger.log('Not in Tauri environment, skipping shortcuts config listener');
    }
  };

  setupListener();

  // 返回取消监听的函数
  return () => {
    if (unlisten) {
      unlisten();
    }
  };
}
