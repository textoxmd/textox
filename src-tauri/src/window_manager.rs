use log::{error, info};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

// 退出请求标志 — Cmd+Q 时设置，所有窗口关闭后执行真正退出
pub static QUIT_REQUESTED: AtomicBool = AtomicBool::new(false);
use std::sync::{Arc, Mutex};
use tauri::webview::Color;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// 强制退出标志 — Ctrl+C 时设置，让 CloseRequested 处理器放行窗口关闭
pub static FORCE_EXIT: AtomicBool = AtomicBool::new(false);

/// 编辑器窗口创建互斥锁：串行化“路径查重 + 窗口创建”，
/// 防止同一路径的并发打开请求（如快速连点文件链接）创建出多个重复窗口。
static CREATE_WINDOW_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

use crate::temp_files::TempFileManager;
use crate::AppConfig;

/// 检测系统是否为暗色模式
fn is_system_dark_mode() -> bool {
    #[cfg(desktop)]
    {
        match dark_light::detect() {
            Ok(dark_light::Mode::Dark) => true,
            Ok(dark_light::Mode::Light) => false,
            _ => true, // 默认暗色
        }
    }
    #[cfg(not(desktop))]
    {
        // 移动端窗口背景色由前端主题控制，不依赖系统检测
        false
    }
}

/// 获取窗口背景色（用于防止白闪）
/// 按当前主题取对应的暗色/亮色背景色（与 themes/*.css 的 --background 一致）。
/// 缩放/回弹时露出的原生底色就是建窗时的这个颜色，运行时无法再改，
/// 所以建窗时尽量匹配主题。各主题换算：
///   default: dark oklch(0.176 0.014 258.4) ≈ #0d1117, light #ffffff
///   pastel:  dark oklch(0.15 0.02 350)      ≈ #12080c, light #fff8f7
///   spring:  dark oklch(0.25 0.016 220)     ≈ #192427, light #fefefe
pub fn get_bg_color(app: &impl Manager<tauri::Wry>) -> Color {
    let config = AppConfig::load(app);
    let is_dark = match config.appearance.as_str() {
        "dark" => true,
        "light" => false,
        _ => is_system_dark_mode(),
    };
    // 优先使用前端保存的主题背景色（覆盖第三方/自定义主题）；
    // 为空时回退内置主题映射。
    let stored = if is_dark {
        &config.theme_bg_dark
    } else {
        &config.theme_bg_light
    };
    if let Some((r, g, b)) = parse_rgb(stored) {
        return Color(r, g, b, 255);
    }
    let (r, g, b) = match config.color_theme.as_str() {
        "pastel" if is_dark => (18, 8, 12),  // #12080c
        "pastel" => (255, 248, 247),         // #fff8f7
        "spring" if is_dark => (25, 36, 39), // #192427
        "spring" => (254, 254, 254),         // #fefefe
        _ if is_dark => (13, 17, 23),        // #0d1117
        _ => (255, 255, 255),                // #ffffff
    };
    Color(r, g, b, 255)
}

/// 解析 "r,g,b" 格式的颜色字符串
fn parse_rgb(s: &str) -> Option<(u8, u8, u8)> {
    let mut parts = s.trim().split(',');
    let r = parts.next()?.trim().parse().ok()?;
    let g = parts.next()?.trim().parse().ok()?;
    let b = parts.next()?.trim().parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((r, g, b))
}

/// 窗口信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub id: String,
    pub current_file: Option<String>,
    pub opened_folder: Option<String>,
    pub is_single_file_mode: bool,
    /// 是否为启动时注入的默认工作区窗口（由后端 Reopen/启动创建）
    pub is_launch_workspace: bool,
    pub sidebar_collapsed: bool,
    pub sidebar_show_outline: bool,
}

/// 窗口管理器
pub struct WindowManager {
    windows: Arc<Mutex<HashMap<String, WindowInfo>>>,
    counter: Arc<Mutex<u32>>,
}

impl WindowManager {
    /// 创建新的窗口管理器
    pub fn new() -> Self {
        Self {
            windows: Arc::new(Mutex::new(HashMap::new())),
            counter: Arc::new(Mutex::new(0)),
        }
    }

    /// 生成新的窗口 ID
    fn generate_window_id(&self) -> String {
        let mut counter = self.counter.lock().unwrap_or_else(|e| e.into_inner());

        // 查找下一个可用的窗口 ID
        loop {
            *counter += 1;
            let window_id = if *counter == 1 {
                "main".to_string()
            } else {
                format!("window-{}", counter)
            };

            // 如果窗口 ID 不存在，则使用它
            let windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
            if !windows.contains_key(&window_id) {
                return window_id;
            }
            // 释放锁，继续循环
            drop(windows);
        }
    }

    /// 创建新窗口
    pub fn create_window(
        &self,
        app: &AppHandle,
        source_window_label: Option<String>,
        file_path: Option<String>,
        folder_path: Option<String>,
    ) -> Result<String, String> {
        // 未指定路径时（空白新窗口）没有查重语义，直接创建
        if file_path.is_none() && folder_path.is_none() {
            return self.create_window_inner(app, source_window_label, file_path, folder_path, None);
        }

        // 指定了文件/目录路径：加锁串行化“查重 + 创建”，避免同一路径被并发打开多次
        let _guard = CREATE_WINDOW_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(target) = file_path.as_deref().or(folder_path.as_deref()) {
            // 已有窗口打开同一文件/目录时直接聚焦复用，不额外创建窗口
            if let Some(existing) = self.find_window_by_path_inner(target) {
                info!(
                    "Path {} already open in window {}, focusing existing window",
                    target, existing
                );
                if focus_window(app, &existing).is_ok() {
                    return Ok(existing);
                }
                // 记录已失效（webview 已销毁但未注销）：清理占位记录后按正常流程新建
                error!(
                    "Window {} for path {} no longer exists, removing stale record",
                    existing, target
                );
                self.remove_window(&existing);
            }
        }
        self.create_window_inner(app, source_window_label, file_path, folder_path, None)
    }

    /// 为「最近项目」创建窗口：路径在窗口开始加载前写入待处理表，
    /// 前端启动时即可确定取到，避免"先建空白文档再补开"的竞态。
    pub fn create_window_for_recent_item(
        &self,
        app: &AppHandle,
        path: &str,
    ) -> Result<String, String> {
        let _guard = CREATE_WINDOW_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        self.create_window_inner(app, None, None, None, Some(path.to_string()))
    }

    /// 创建新窗口（无查重逻辑，由 create_window 在锁内调用）
    fn create_window_inner(
        &self,
        app: &AppHandle,
        _source_window_label: Option<String>,
        file_path: Option<String>,
        folder_path: Option<String>,
        pending_recent_item: Option<String>,
    ) -> Result<String, String> {
        // 互斥约束：文件与目录最多指定一个
        debug_assert!(file_path.is_none() || folder_path.is_none());
        let window_id = self.generate_window_id();
        info!("Creating new window with id: {}", window_id);

        // 在 webview 开始加载前写入，前端初始化时必然能取到
        if let Some(ref item) = pending_recent_item {
            store_pending_recent_item(&window_id, item);
        }

        let window_info = WindowInfo {
            id: window_id.clone(),
            current_file: file_path.clone(),
            opened_folder: folder_path.clone(),
            is_single_file_mode: file_path.is_some(),
            // 只有启动注入（setup / Reopen）会显式置位，显式打开文件夹不触发未保存文件分窗口
            is_launch_workspace: false,
            sidebar_collapsed: false,
            sidebar_show_outline: false,
        };

        // 加载配置获取窗口大小
        let config = AppConfig::load(app);
        let window_width = config.window_width.max(1.0);
        let window_height = config.window_height.max(1.0);

        info!(
            "Creating window with size: {}x{}",
            window_width, window_height
        );

        let builder = WebviewWindowBuilder::new(app, &window_id, WebviewUrl::App("/".into()))
            .title("Textox")
            .inner_size(window_width, window_height)
            .devtools(crate::devtools_enabled())
            .visible(false);

        #[cfg(target_os = "macos")]
        let builder = {
            let bg = get_bg_color(app);
            builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .background_color(bg)
        };

        #[cfg(target_os = "windows")]
        let builder = {
            let bg = get_bg_color(app);
            builder.decorations(false).background_color(bg)
        };

        match builder.build() {
            Ok(window) => {
                // 注册窗口
                {
                    let mut windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
                    windows.insert(window_id.clone(), window_info);
                }

                // macOS 的窗口列表 / Dock 菜单只收录有标题的窗口，这里同步原生标题
                // （overlay 标题栏下标题不可见，仅用于窗口菜单）
                if let Some(title) = self.get_window_title(app, &window_id) {
                    let _ = window.set_title(&title);
                }

                // 设置关闭事件处理程序（新窗口需要，因为 setup 只在启动时运行）
                let window_id_clone = window_id.clone();
                let app_handle = app.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // Ctrl+C 强制退出时放行窗口关闭
                        if FORCE_EXIT.load(Ordering::SeqCst) {
                            info!("Force exit: allowing window to close: {}", window_id_clone);
                            return;
                        }
                        info!("Close requested for window: {}", window_id_clone);
                        // 阻止默认关闭行为
                        api.prevent_close();
                        // 发送关闭检查事件到该窗口
                        let _ = app_handle.emit_to(&window_id_clone, "check-close", ());
                    }
                });

                // 同时存入 PENDING_FILES_FOR_WINDOWS 作为前端 window_ready 的 fallback
                if let Some(ref fp) = file_path {
                    store_pending_file_for_window(&window_id, fp);
                }
                if let Some(ref fp) = folder_path {
                    store_pending_file_for_window(&window_id, fp);
                }

                info!("Window {} created successfully", window_id);

                Ok(window_id)
            }
            Err(e) => {
                if pending_recent_item.is_some() {
                    remove_pending_recent_item(&window_id);
                }
                error!("Failed to create window: {}", e);
                Err(format!("Failed to create window: {}", e))
            }
        }
    }

    /// 注册主窗口
    pub fn register_main_window(&self, window_id: &str) {
        let mut windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
        windows.insert(
            window_id.to_string(),
            WindowInfo {
                id: window_id.to_string(),
                current_file: None,
                opened_folder: None,
                is_single_file_mode: false,
                is_launch_workspace: false,
                sidebar_collapsed: false,
                sidebar_show_outline: false,
            },
        );
        info!("Main window registered: {}", window_id);
    }

    /// 更新窗口信息（完整替换）
    pub fn update_window_info(&self, window_id: &str, info: WindowInfo) {
        let mut windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
        windows.insert(window_id.to_string(), info);
    }

    /// 原地更新窗口信息（避免克隆）
    pub fn patch_window_info<F>(&self, window_id: &str, f: F)
    where
        F: FnOnce(&mut WindowInfo),
    {
        let mut windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(info) = windows.get_mut(window_id) {
            f(info);
        }
    }

    /// 获取窗口信息
    pub fn get_window_info(&self, window_id: &str) -> Option<WindowInfo> {
        let windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
        windows.get(window_id).cloned()
    }

    /// 在已注册窗口中查找已打开指定路径（文件或目录）的窗口
    /// 同时检查 `current_file` 和 `opened_folder`，因为后端 `create_window`
    /// 将路径存在 `current_file` 中，前端随后会同步到 `opened_folder`。
    /// 比较前统一归一化路径分隔符，保证链接（`/`）与系统对话框（`\`）路径可互相命中。
    fn find_window_by_path_inner(&self, path: &str) -> Option<String> {
        let normalize = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_string();
        let path = normalize(path);
        let windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
        windows
            .iter()
            .find(|(_, info)| {
                info.opened_folder.as_deref().map(normalize).as_deref() == Some(path.as_str())
                    || info.current_file.as_deref().map(normalize).as_deref() == Some(path.as_str())
            })
            .map(|(label, _)| label.clone())
    }

    /// 移除窗口
    pub fn remove_window(&self, window_id: &str) {
        {
            let mut windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
            windows.remove(window_id);
        }
        // 窗口可能在消费待处理路径前就被关闭/重载：这里清理，避免条目永久滞留
        {
            let mut pending_files = PENDING_FILES_FOR_WINDOWS
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            pending_files.remove(window_id);
        }
        remove_pending_recent_item(window_id);
        info!("Window removed: {}", window_id);
    }

    /// 获取所有窗口 ID
    pub fn get_all_window_ids(&self) -> Vec<String> {
        let windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
        windows.keys().cloned().collect()
    }

    /// 获取窗口显示标题
    pub fn get_window_title(&self, app: &AppHandle, label: &str) -> Option<String> {
        let info = self.get_window_info(label)?;
        if let Some(ref file) = info.current_file {
            // 临时文件（未保存文档）不显示 UUID 文件名，与前端标题栏的 Untitled.md 保持一致
            if TempFileManager::is_temp_path(app, file) {
                return Some("Untitled.md".to_string());
            }
            let name = std::path::Path::new(file)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            Some(truncate_title(name))
        } else if let Some(ref folder) = info.opened_folder {
            let name = std::path::Path::new(folder)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            Some(truncate_title(name))
        } else {
            Some(crate::i18n::translate("unsavedChanges.untitledFile"))
        }
    }

    /// 广播消息到所有窗口（除发送者外）
    pub fn broadcast_to_others(
        &self,
        app: &AppHandle,
        sender_id: &str,
        event: &str,
        payload: impl serde::Serialize + Clone,
    ) {
        let window_ids = self.get_all_window_ids();
        for window_id in window_ids {
            if window_id != sender_id {
                let _ = app.emit_to(&window_id, event, payload.clone());
            }
        }
    }
}

/// 判断窗口标签是否为编辑器窗口（非辅助窗口）
pub fn is_editor_label(label: &str) -> bool {
    label == "main" || label.starts_with("window-")
}

/// 同步窗口原生标题（macOS 窗口列表 / Dock 菜单只收录有标题的窗口）
/// overlay 标题栏下原生标题不可见，仅用于窗口菜单，不影响自定义 UI。
fn sync_window_title(window: &tauri::WebviewWindow) {
    if !is_editor_label(window.label()) {
        return;
    }
    if let Some(title) = WINDOW_MANAGER.get_window_title(window.app_handle(), window.label()) {
        let _ = window.set_title(&title);
    }
}

/// 在已注册窗口中查找已打开指定路径（文件或目录）的窗口
pub fn find_window_by_path(path: &str) -> Option<String> {
    WINDOW_MANAGER.find_window_by_path_inner(path)
}

/// 截断标题到最大长度（40 字符）
pub fn truncate_title(title: String) -> String {
    if title.len() > 40 {
        let mut truncated: String = title.chars().take(37).collect();
        truncated.push_str("...");
        truncated
    } else {
        title
    }
}

/// 聚焦指定窗口（按 label）
pub fn focus_window(app: &AppHandle, label: &str) -> Result<(), String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("Window '{}' not found", label))?;
    let _ = window.show();
    window
        .set_focus()
        .map_err(|e| format!("Failed to focus window: {}", e))
}

impl Default for WindowManager {
    fn default() -> Self {
        Self::new()
    }
}

// 全局窗口管理器实例
pub static WINDOW_MANAGER: Lazy<WindowManager> = Lazy::new(WindowManager::new);

/// 创建新窗口的命令
#[tauri::command]
pub async fn create_new_window(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    file_path: Option<String>,
) -> Result<String, String> {
    let source_label = window.label().to_string();
    WINDOW_MANAGER.create_window(&app, Some(source_label), file_path, None)
}

/// 获取当前窗口信息
#[tauri::command]
pub fn get_window_info_command(window: tauri::WebviewWindow) -> Result<WindowInfo, String> {
    WINDOW_MANAGER
        .get_window_info(window.label())
        .ok_or_else(|| "Window not found".to_string())
}

/// 更新窗口当前文件
#[tauri::command]
pub fn update_window_file(window: tauri::WebviewWindow, file_path: Option<String>) {
    WINDOW_MANAGER.patch_window_info(window.label(), |info| info.current_file = file_path);
    sync_window_title(&window);
}

/// 更新窗口打开的文件夹
#[tauri::command]
pub fn update_window_folder(window: tauri::WebviewWindow, folder_path: Option<String>) {
    WINDOW_MANAGER.patch_window_info(window.label(), |info| info.opened_folder = folder_path);
    sync_window_title(&window);
}

/// 清除启动工作区标记（前端恢复默认工作区后调用，
/// 避免页面刷新时重复执行"未保存文件分窗口恢复"）
#[tauri::command]
pub fn clear_launch_workspace_flag(window: tauri::WebviewWindow) {
    WINDOW_MANAGER.patch_window_info(window.label(), |info| info.is_launch_workspace = false);
}

/// 更新窗口单文件模式
#[tauri::command]
pub fn update_window_mode(window: tauri::WebviewWindow, is_single_file: bool) {
    WINDOW_MANAGER.patch_window_info(window.label(), |info| {
        info.is_single_file_mode = is_single_file
    });
}

/// 更新窗口侧边栏折叠状态
#[tauri::command]
pub fn update_window_sidebar_collapsed(window: tauri::WebviewWindow, collapsed: bool) {
    WINDOW_MANAGER.patch_window_info(window.label(), |info| info.sidebar_collapsed = collapsed);
}

/// 更新窗口侧边栏视图状态（目录/大纲）
#[tauri::command]
pub fn update_window_sidebar_view(window: tauri::WebviewWindow, show_outline: bool) {
    WINDOW_MANAGER.patch_window_info(window.label(), |info| {
        info.sidebar_show_outline = show_outline
    });
}

/// 获取所有窗口 ID
#[tauri::command]
pub fn get_all_windows() -> Vec<String> {
    WINDOW_MANAGER.get_all_window_ids()
}

/// 辅助窗口创建锁：串行化"存在性检查 + 创建"，防止并发请求（如菜单事件被重复派发）
/// 同时创建同一 id 的窗口，导致出现多个设置/鸣谢/隐私窗口。
static AUXILIARY_WINDOW_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

/// 辅助窗口的原生标题（macOS 窗口列表 / Dock 菜单只显示有标题的窗口）
fn auxiliary_window_title(window_id: &str) -> String {
    match window_id {
        "settings" => crate::i18n::translate("menu.preferences"),
        "acknowledgments" => crate::i18n::translate("menu.acknowledgments"),
        "privacy" => crate::i18n::translate("menu.privacy"),
        "onboarding" => crate::i18n::translate("menu.onboarding_wizard"),
        _ => "Textox".to_string(),
    }
}

/// 通用辅助窗口创建
/// `no_decorations`: true = 全平台无装饰；false = OS 特定风格（macOS overlay, Windows 无装饰）
#[allow(clippy::too_many_arguments)]
fn create_auxiliary_window(
    app: &tauri::AppHandle,
    window_id: &str,
    url_path: &str,
    width: f64,
    height: f64,
    position_base: (f64, f64),
    offset_range: u32,
    fixed_size: bool,
    no_decorations: bool,
    center: bool,
) -> Result<String, String> {
    if let Some(window) = app.get_webview_window(window_id) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(window_id.to_string());
    }

    // 加锁后二次检查并创建：若两个并发请求同时进入（先于任一 build 完成），
    // 后到者在锁内会发现窗口已存在，仅聚焦复用，避免重复创建。
    let _guard = AUXILIARY_WINDOW_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(window) = app.get_webview_window(window_id) {
        info!(
            "Auxiliary window {} already exists, focusing existing",
            window_id
        );
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(window_id.to_string());
    }

    let info = WindowInfo {
        id: window_id.to_string(),
        current_file: None,
        opened_folder: None,
        is_single_file_mode: false,
        is_launch_workspace: false,
        sidebar_collapsed: false,
        sidebar_show_outline: false,
    };

    let offset_x = (rand::random::<u32>() % offset_range.max(1)) as f64;
    let offset_y = (rand::random::<u32>() % offset_range.max(1)) as f64;

    // 与主窗口一致的启动时序：先隐藏创建，由前端在主题应用、内容渲染完成后
    // 主动 show()，避免暗色模式下窗口先以白色空白态亮相。
    let mut builder = WebviewWindowBuilder::new(app, window_id, WebviewUrl::App(url_path.into()))
        .title(auxiliary_window_title(window_id))
        .inner_size(width, height)
        .resizable(false)
        .visible(false);

    // 显式设置 devtools：tauri 编译进 devtools feature 时未指定默认为 true，
    // release 下必须显式关闭（见 lib.rs devtools_enabled）
    #[cfg(desktop)]
    {
        builder = builder.devtools(crate::devtools_enabled());
    }

    // 移动端窗口固定占满屏幕，无 maximizable 概念
    #[cfg(desktop)]
    {
        builder = builder.maximizable(false);
    }

    // 居中窗口与主窗口一致使用 builder 的 center()（隐藏状态下 post-build
    // 再调用 center() 在部分平台不可靠）；其余窗口沿用偏移定位。
    if center {
        #[cfg(desktop)]
        {
            builder = builder.center();
        }
    } else {
        builder = builder.position(position_base.0 + offset_x, position_base.1 + offset_y);
    }

    if fixed_size {
        builder = builder
            .min_inner_size(width, height)
            .max_inner_size(width, height);
    }

    if no_decorations {
        #[cfg(desktop)]
        {
            let bg = get_bg_color(app);
            builder = builder.decorations(false).background_color(bg);
        }
    } else {
        #[cfg(target_os = "macos")]
        {
            let bg = get_bg_color(app);
            builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .background_color(bg);
        }
        #[cfg(target_os = "windows")]
        {
            let bg = get_bg_color(app);
            builder = builder.decorations(false).background_color(bg);
        }
    }

    match builder.build() {
        Ok(new_window) => {
            let mut windows = WINDOW_MANAGER
                .windows
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            windows.insert(window_id.to_string(), info);
            let _ = new_window.set_focus();
            info!("Auxiliary window {} created successfully", window_id);
            Ok(window_id.to_string())
        }
        Err(e) => {
            error!("Failed to create auxiliary window {}: {}", window_id, e);
            Err(format!("Failed to create window: {}", e))
        }
    }
}

/// 内部创建设置窗口（不依赖 source window）
pub fn create_settings_window_internal(app: &tauri::AppHandle) -> Result<String, String> {
    create_auxiliary_window(
        app,
        "settings",
        "/settings",
        800.0,
        600.0,
        (100.0, 100.0),
        100,
        false,
        false,
        false,
    )
}

/// 创建设置窗口
#[tauri::command]
pub async fn create_settings_window(
    _window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<String, String> {
    create_settings_window_internal(&app)
}

/// 存储待发送的文件路径（窗口标签 -> 文件路径）
use std::collections::HashMap as StdHashMap;
static PENDING_FILES_FOR_WINDOWS: Lazy<Mutex<StdHashMap<String, String>>> =
    Lazy::new(|| Mutex::new(StdHashMap::new()));

/// 存储待发送的最近项目路径（需经前端处理以避免沙盒权限问题）
static PENDING_RECENT_ITEMS: Lazy<Mutex<StdHashMap<String, String>>> =
    Lazy::new(|| Mutex::new(StdHashMap::new()));

/// 取出并移除指定窗口的待打开最近项目。
/// 新窗口启动时先消费它，避免在最近目录到达前先创建空白未保存文档。
#[tauri::command]
pub fn take_pending_recent_item(window: tauri::WebviewWindow) -> Option<String> {
    let window_id = window.label().to_string();
    let mut guard = PENDING_RECENT_ITEMS
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let item = guard.remove(&window_id);
    if let Some(ref path) = item {
        info!("Taking pending recent item for window {}: {}", window_id, path);
    }
    item
}

/// 窗口就绪通知 - 前端初始化完成后调用，返回待打开的文件路径（如果有）
#[tauri::command]
pub fn window_ready(window: tauri::WebviewWindow) -> Option<String> {
    let window_id = window.label().to_string();
    info!("Window ready: {}", window_id);

    // 检查是否有待发送的文件路径
    let pending_file = {
        let mut guard = PENDING_FILES_FOR_WINDOWS
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        guard.remove(&window_id)
    };

    if let Some(ref file_path) = pending_file {
        info!(
            "Returning pending file for window {}: {}",
            window_id, file_path
        );
    }

    // 窗口就绪时重新启用菜单（之前可能被 disable_window_dependent_menus 禁用）
    #[cfg(desktop)]
    {
        let app = window.app_handle();
        if let Some(menu) = app.menu() {
            // 文件菜单 - save_file 总应可用，open_file_location/export 交给前端 update 命令管理
            if let Some(file_menu_item) = menu.get("file") {
                if let Some(file_submenu) = file_menu_item.as_submenu() {
                    if let Some(menu_item) = file_submenu.get("save_file") {
                        if let Some(item) = menu_item.as_menuitem() {
                            let _ = item.set_enabled(true);
                        }
                    }
                }
            }
            // 段落菜单交给前端 update_paragraph_menu 管理，不需在此启用
            // 视图菜单：大纲样式（关闭/文字/迷你地图）始终可用，无启用态管理
            if let Some(view_menu_item) = menu.get("view") {
                if let Some(view_submenu) = view_menu_item.as_submenu() {
                    for id in [
                        "toggle_sidebar",
                        "toggle_edit_mode",
                        "toggle_typewriter_mode",
                        "toggle_readable_line_length",
                        "toggle_editor_toolbar",
                        "toggle_inline_format_toolbar",
                    ] {
                        if let Some(menu_item) = view_submenu.get(id) {
                            if let Some(item) = menu_item.as_check_menuitem() {
                                let _ = item.set_enabled(true);
                            }
                        }
                    }
                }
            }
            // 窗口菜单
            if let Some(window_menu_item) = menu.get("__tauri_window_menu__") {
                if let Some(window_submenu) = window_menu_item.as_submenu() {
                    for id in ["minimize", "zoom", "center", "fullscreen"] {
                        if let Some(menu_item) = window_submenu.get(id) {
                            if let Some(item) = menu_item.as_menuitem() {
                                let _ = item.set_enabled(true);
                            }
                        }
                    }
                }
            }
        }
    }

    pending_file
}

/// 存储待发送的文件路径（供 create_window 使用）
pub fn store_pending_file_for_window(window_id: &str, file_path: &str) {
    let mut guard = PENDING_FILES_FOR_WINDOWS
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    guard.insert(window_id.to_string(), file_path.to_string());
    info!(
        "Stored pending file for window {}: {}",
        window_id, file_path
    );
}

/// 存储待发送的最近项目路径（新窗口创建时写入，供前端启动时消费）
pub fn store_pending_recent_item(window_id: &str, path: &str) {
    let mut guard = PENDING_RECENT_ITEMS
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    guard.insert(window_id.to_string(), path.to_string());
    info!(
        "Stored pending recent item for window {}: {}",
        window_id, path
    );
}

/// 窗口创建失败时清理已写入的待处理最近项目
fn remove_pending_recent_item(window_id: &str) {
    let mut guard = PENDING_RECENT_ITEMS
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    guard.remove(window_id);
}

/// Reopen 事件创建的窗口，供 dock 菜单重用
static REOPEN_WINDOW: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

/// 记录 Reopen 事件创建的窗口
pub fn store_reopen_window(window_id: &str) {
    let mut guard = REOPEN_WINDOW.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(window_id.to_string());
    info!("Stored reopen window: {}", window_id);
}

/// 取出并返回 Reopen 事件创建的窗口标签（如果存在）
pub fn take_reopen_window() -> Option<String> {
    let mut guard = REOPEN_WINDOW.lock().unwrap_or_else(|e| e.into_inner());
    guard.take()
}

/// 内部创建鸣谢窗口（不依赖 source window）
pub fn create_acknowledgments_window_internal(app: &tauri::AppHandle) -> Result<String, String> {
    create_auxiliary_window(
        app,
        "acknowledgments",
        "/acknowledgments",
        350.0,
        500.0,
        (200.0, 100.0),
        50,
        true,
        true,
        false,
    )
}

/// 创建鸣谢窗口
#[tauri::command]
pub async fn create_acknowledgments_window(
    _window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<String, String> {
    create_acknowledgments_window_internal(&app)
}

/// 内部创建隐私窗口（不依赖 source window）
pub fn create_privacy_window_internal(app: &tauri::AppHandle) -> Result<String, String> {
    create_auxiliary_window(
        app,
        "privacy",
        "/privacy",
        350.0,
        500.0,
        (200.0, 100.0),
        50,
        true,
        true,
        false,
    )
}

/// 内部创建设置向导窗口（不依赖 source window）
pub fn create_onboarding_window_internal(app: &tauri::AppHandle) -> Result<String, String> {
    let window_id = create_auxiliary_window(
        app,
        "onboarding",
        "/onboarding",
        // 与编辑器默认窗口大小一致（AppConfig 默认 960×700）
        960.0,
        700.0,
        (0.0, 0.0),
        0,
        true,
        false,
        true,
    )?;
    // 向导窗口始终置顶（最高优先级），并确保位于编辑器窗口前面
    if let Some(window) = app.get_webview_window("onboarding") {
        #[cfg(desktop)]
        {
            let _ = window.set_always_on_top(true);
        }
        let _ = window.set_focus();
    }
    Ok(window_id)
}

/// 创建设置向导窗口
#[tauri::command]
pub async fn create_onboarding_window(
    _window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<String, String> {
    create_onboarding_window_internal(&app)
}

/// 创建隐私政策窗口
#[tauri::command]
pub async fn create_privacy_window(
    _window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<String, String> {
    create_privacy_window_internal(&app)
}

/// 取消退出请求（用户在保存对话框中取消时调用）
#[tauri::command]
pub fn cancel_quit() {
    info!("Cancel quit: resetting QUIT_REQUESTED flag");
    QUIT_REQUESTED.store(false, Ordering::SeqCst);
}

/// 注销窗口（在窗口关闭前调用）
#[tauri::command]
pub fn unregister_window(window: tauri::WebviewWindow) {
    let window_id = window.label().to_string();
    WINDOW_MANAGER.remove_window(&window_id);

    let remaining = WINDOW_MANAGER.get_all_window_ids();
    if remaining.is_empty() {
        let app = window.app_handle();
        if QUIT_REQUESTED.load(Ordering::SeqCst) {
            info!("All windows closed after quit request, exiting");
            app.exit(0);
        } else {
            #[cfg(desktop)]
            crate::disable_window_dependent_menus(app);
        }
    }
}

/// 在标题栏区域右键时显示应用菜单
/// 仅在 Windows 上使用（macOS 通过系统菜单栏显示）
#[tauri::command]
pub fn show_titlebar_menu(window: tauri::WebviewWindow, app: tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    {
        if let Some(menu) = app.menu() {
            if let Err(e) = window.popup_menu(&menu) {
                error!("Failed to popup menu: {}", e);
            }
        }
    }
    // macOS 上不需要此功能，菜单在系统菜单栏中
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (&window, &app);
    }
}
