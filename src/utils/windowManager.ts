import { invoke } from '@tauri-apps/api/core';
import { Event } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isMobilePlatform } from '@/utils/platform';

export interface WindowInfo {
  id: string;
  current_file: string | null;
  opened_folder: string | null;
  is_single_file_mode: boolean;
  is_launch_workspace: boolean;
  sidebar_collapsed: boolean;
  sidebar_show_outline: boolean;
}

export async function getCurrentWindowId(): Promise<string> {
  const window = getCurrentWindow();
  return window.label;
}

export async function isMainWindow(): Promise<boolean> {
  const windowId = await getCurrentWindowId();
  return windowId === 'main';
}

// 创建新窗口
export async function createNewWindow(filePath?: string): Promise<string> {
  if (isMobilePlatform()) {
    // iPadOS 单窗口模型：新窗口操作退化为复用当前窗口
    return getCurrentWindowId();
  }
  return await invoke('create_new_window', { filePath });
}

// 获取当前窗口信息
export async function getWindowInfo(): Promise<WindowInfo | null> {
  return await invoke('get_window_info_command');
}

// 更新窗口当前文件
export async function updateWindowFile(filePath: string | null): Promise<void> {
  await invoke('update_window_file', { filePath });
}

// 更新窗口打开的文件夹
export async function updateWindowFolder(folderPath: string | null): Promise<void> {
  await invoke('update_window_folder', { folderPath });
}

// 清除启动工作区标记（恢复默认工作区后调用，防止刷新时重复处理未保存文件）
export async function clearLaunchWorkspaceFlag(): Promise<void> {
  await invoke('clear_launch_workspace_flag');
}

// 更新窗口单文件模式
export async function updateWindowMode(isSingleFile: boolean): Promise<void> {
  await invoke('update_window_mode', { isSingleFile });
}

// 更新图片菜单启用状态（单文件模式下禁用）
export async function updateImageMenu(enabled: boolean): Promise<void> {
  await invoke('update_image_menu', { enabled });
}

// 更新窗口侧边栏折叠状态
export async function updateWindowSidebarCollapsed(collapsed: boolean): Promise<void> {
  await invoke('update_window_sidebar_collapsed', { collapsed });
}

// 更新窗口侧边栏视图状态（目录/大纲）
export async function updateWindowSidebarView(showOutline: boolean): Promise<void> {
  await invoke('update_window_sidebar_view', { showOutline });
}


// 获取所有窗口 ID
export async function getAllWindows(): Promise<string[]> {
  return await invoke('get_all_windows');
}

// 监听打开文件事件（从后端发送给当前窗口）
export async function listenToOpenFile(callback: (filePath: string) => void): Promise<() => void> {
  const window = getCurrentWindow();
  return await window.listen('open-file', (event: Event<string>) => {
    callback(event.payload);
  });
}

// 监听新建窗口事件
export async function listenToNewWindow(callback: () => void): Promise<() => void> {
  const window = getCurrentWindow();
  return await window.listen('new-window', () => {
    callback();
  });
}

// 创建设置窗口
// 并发去重：同一时刻多次调用（如菜单事件重复派发）只发送一次 invoke，
// 避免后端并发创建出多个设置窗口。
let settingsOpenPromise: Promise<string> | null = null;

export function createSettingsWindow(): Promise<string> {
  if (settingsOpenPromise) {
    return settingsOpenPromise;
  }
  const opening = invoke<string>('create_settings_window').finally(() => {
    settingsOpenPromise = null;
  });
  settingsOpenPromise = opening;
  return opening;
}

// 通知后端窗口已就绪，返回待打开的文件路径（如果有）
export async function notifyWindowReady(): Promise<string | null> {
  return await invoke<string | null>('window_ready');
}

// 取出后端为该窗口暂存的待打开最近项目（目录或文件）
export async function takePendingRecentItem(): Promise<string | null> {
  return await invoke<string | null>('take_pending_recent_item');
}

/** showWindowIfHidden 依赖的最小窗口能力（便于测试注入替身）。 */
export interface ShowableWindow {
  isVisible(): Promise<boolean>;
  show(): Promise<void>;
}

/**
 * 幂等显示窗口：仅在窗口当前不可见时调用 show()，返回是否执行了显示。
 *
 * 页面重载（如插件启用变更后的 `window.location.reload()`）会重新执行启动逻辑，
 * 此时窗口本就可见；再次 show() 在 macOS 上会触发 makeKeyAndOrderFront，
 * 把窗口重新置顶并抢焦点（表现为编辑器跳到设置窗口前面），因此这里做可见性守卫。
 */
export async function showWindowIfHidden(win: ShowableWindow): Promise<boolean> {
  if (await win.isVisible()) return false;
  await win.show();
  return true;
}

// ===== 窗口控制（Windows 自定义标题栏） =====

// 最小化窗口
export async function minimizeWindow(): Promise<void> {
  await getCurrentWindow().minimize();
}

// 切换最大化/还原
export async function toggleMaximizeWindow(): Promise<void> {
  await getCurrentWindow().toggleMaximize();
}

// 关闭窗口
export async function closeWindow(): Promise<void> {
  await getCurrentWindow().close();
}

// 检查窗口是否最大化
export async function isWindowMaximized(): Promise<boolean> {
  return await getCurrentWindow().isMaximized();
}

// 监听窗口大小变化（用于更新最大化按钮图标）
export async function onWindowResized(
  callback: (maximized: boolean) => void,
): Promise<() => void> {
  const window = getCurrentWindow();
  const unlisten = await window.onResized(async () => {
    const maximized = await window.isMaximized();
    callback(maximized);
  });
  return unlisten;
}

// 检测当前平台是否为 Windows（同步，在模块加载时确定）
export const IS_WINDOWS = navigator.userAgent.includes('Windows');
export function isWindowsPlatform(): boolean {
  return IS_WINDOWS;
}

// 检测当前平台是否为 macOS（同步，在模块加载时确定）。
// 原生打印（print_webview）仅在 macOS 实现，前端据此隐藏入口。
// 排除移动端：iPadOS 的桌面版 Safari UA 也含 "Mac"，但其不支持该方法。
export const IS_MAC = !IS_WINDOWS && !isMobilePlatform() && navigator.userAgent.includes('Mac');
