/** 所有可配置快捷键的 action ID 列表，用于前缀匹配分派 */
export const SHORTCUT_IDS = [
  'toggle_sidebar',
  'toggle_edit_mode',
  'toggle_typewriter_mode',
  'new_window',
  'open_file',
  'export_pdf',
  'print_document',
  'save_file',
  'open_folder',
  'open_file_location',
  'minimize',
  'fullscreen',
  'center',
  'heading_1',
  'heading_2',
  'heading_3',
  'heading_4',
  'heading_5',
  'heading_6',
  'bullet_list',
  'ordered_list',
  'task_list',
  'code_block',
  'blockquote',
  'horizontal_rule',
  'image',
];

export const RECENT_ITEMS_KEY = 'texto:recent-items';
export const OPENED_FOLDER_KEY = 'texto:opened-folder';
export const EDITOR_MODE_KEY = 'texto:editor-mode';
export const LOCK_KEY = 'texto:editor-locked';

// 移动端断点：窗口宽度小于此值时启用移动端布局
export const MOBILE_BREAKPOINT = 768;

// iCloud 同步宽限期（毫秒）：在此时间内文件修改事件被视为 iCloud 同步而非外部修改
export const ICLOUD_GRACE_DURATION = 10_000;

export const isFreeVersion = import.meta.env.VITE_FREE_VERSION === "true";
