#![allow(unexpected_cfgs)]

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use log::{error, info};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::collections::HashSet;
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::command;
#[cfg(all(not(feature = "free-version"), desktop))]
use tauri::menu::Menu;
#[cfg(desktop)]
use tauri::menu::{
    AboutMetadata, CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItem, MenuItemBuilder,
    PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::StoreExt;

// 引入翻译模块
mod i18n;

// 引入窗口管理模块
pub mod window_manager;
pub use window_manager::WINDOW_MANAGER;

// 引入临时文件管理模块
mod temp_files;

// 引入文档打开模块（冷启动一次 IPC 完成 temp 判定 + 类型判定 + 读取）
mod document;

// 引入待打开文件模块
mod pending_file;

// 引入文件监听模块
pub mod file_watcher;

// 引入 macOS 文件系统模块
mod macos_fs;

// 引入 macOS Finder 标签（文件颜色）模块
mod macos_tags;

// 引入安全域书签模块 (macOS App Sandbox)
mod bookmark_manager;

// 引入字体模块
mod fonts;

// 引入原生对话框模块
mod native_dialog;

// 引入 macOS 程序坞菜单模块
#[cfg(target_os = "macos")]
mod dock_menu;

// 引入 macOS 菜单栏增强模块
#[cfg(target_os = "macos")]
mod macos_menu;

// 引入 macOS 打印会话模块（WKWebView 打印的 sheet + 完成回调）
#[cfg(target_os = "macos")]
mod print_session;

// 引入原生 macOS PNG 长图导出模块（分块截图 + 拼接编码）
#[cfg(target_os = "macos")]
mod png_export;

// 引入应用内评分模块
mod store_review;

// 引入商店地区解析模块（按地区决定可用的 AI provider）
mod store_region;

// 引入主题引擎模块
#[cfg(not(feature = "free-version"))]
mod theme_converter;
mod theme_manager;

// 引入插件运行时模块（目录/id 校验、目录扫描、启用状态）
// pub 仅为 plugin-cli（src/bin/plugin-cli.rs）复用；不是对外 API
pub mod plugins;

// 引入 MCP 服务端原型（本机回环，供外部 AI 客户端调用应用内能力）
mod mcp;

// 存储待打开的文件路径队列（用于应用启动时通过右键打开多个文件的场景）
use once_cell::sync::Lazy;
static PENDING_OPEN_FILES: Lazy<Mutex<Vec<String>>> = Lazy::new(|| Mutex::new(Vec::new()));

/// 添加待打开的文件路径
pub fn add_pending_open_file(path: String) {
    info!("Adding pending open file: {}", path);
    let mut guard = PENDING_OPEN_FILES.lock().unwrap_or_else(|e| e.into_inner());
    guard.push(path);
}

/// 获取并清除第一个待打开的文件路径（给主窗口使用）
pub fn take_first_pending_open_file() -> Option<String> {
    let mut guard = PENDING_OPEN_FILES.lock().unwrap_or_else(|e| e.into_inner());
    if !guard.is_empty() {
        Some(guard.remove(0))
    } else {
        None
    }
}

/// iOS：为从"文件"App 就地打开的文件建立安全作用域访问。
/// 未声明访问时，后续读取该文件会失败（权限被系统拦截）。
#[cfg(target_os = "ios")]
fn start_ios_scoped_access(path: &str) {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send, MainThreadMarker};
    use objc2_foundation::NSString;
    if let Some(_mtm) = MainThreadMarker::new() {
        let ns_path = NSString::from_str(path);
        let nsurl: *mut AnyObject = unsafe { msg_send![class!(NSURL), fileURLWithPath: &*ns_path] };
        if !nsurl.is_null() {
            let _: objc2::runtime::Bool =
                unsafe { msg_send![nsurl, startAccessingSecurityScopedResource] };
        }
    }
}

/// 获取所有待打开的文件路径（用于创建新窗口）
pub fn take_all_pending_open_files() -> Vec<String> {
    let mut guard = PENDING_OPEN_FILES.lock().unwrap_or_else(|e| e.into_inner());
    std::mem::take(&mut *guard)
}

// 图片存储方式
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "snake_case")]
pub enum ImageStorageMode {
    /// 存储在文档同级目录
    #[default]
    AlongsideDocument,
    /// 存储在指定目录（通过对话框选择）
    CustomPath,
    /// 通过 PicGo 图床 API 上传
    Picgo,
}

// 图片聚合方式
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "snake_case")]
pub enum ImageAggregationMode {
    /// 不聚合，所有图片放在同一目录
    #[default]
    None,
    /// 按文档文件名聚合
    ByDocumentName,
    /// 按日期聚合
    ByDate,
}

// 界面字体族 - 支持预设值或任意系统字体名称
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(untagged)]
pub enum FontFamily {
    /// 预设字体
    Preset(PresetFontFamily),
    /// 自定义系统字体（任意字体族名）
    Custom(String),
}

// 预设界面字体
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub enum PresetFontFamily {
    /// 系统默认字体
    System,
}

impl Default for FontFamily {
    fn default() -> Self {
        FontFamily::Preset(PresetFontFamily::System)
    }
}

// 编辑器字体族
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(untagged)]
pub enum EditorFontFamily {
    /// 预设字体
    Preset(PresetEditorFontFamily),
    /// 自定义系统字体
    Custom(String),
}

// 预设编辑器字体
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub enum PresetEditorFontFamily {
    /// 系统默认字体
    System,
    /// 等宽字体
    Mono,
}

impl Default for EditorFontFamily {
    fn default() -> Self {
        EditorFontFamily::Preset(PresetEditorFontFamily::System)
    }
}

/// 启动行为
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum StartupBehavior {
    /// 空白文档（默认，与旧版本行为一致）
    #[serde(rename = "blank")]
    #[default]
    BlankDocument,
    /// 打开默认工作区目录
    #[serde(rename = "workspace")]
    Workspace,
}

/// 单个 AI 模型配置（一个 provider 可有多条）
///
/// 容器 `AppConfig` 上的 `#[serde(default)]` 不作用于 `Vec` 元素，
/// 故此处必须自带 `Default` + `#[serde(default)]`：单条 profile 缺字段时补默认值，
/// 避免整份配置反序列化失败被 `AppConfig::load` 静默重置为默认值。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(default)]
pub struct AgentModelProfile {
    /// 稳定 id（创建后不变，由前端生成）；唯一性由前端保证
    pub id: String,
    pub name: String,
    /// provider id，取值以 src/agent/providers-catalog.ts 为准；未知值原样保留（不校验、不改写）
    pub provider: String,
    pub model: String,
    /// API Key（明文存储，后续可迁 keychain；打印配置时勿整包输出）
    pub api_key: String,
    /// 仅 custom 使用
    pub base_url: String,
    /// 是否出现在插件配置下拉里（不影响已绑定插件的调用）
    pub enabled: bool,
}

/// AI 功能全局同意记录（打开总开关时写入）
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(default)]
pub struct AgentConsentRecord {
    /// 同意文本版本；与前端 AI_CONSENT_VERSION 对应，版本不匹配即视为未同意
    pub version: u32,
    /// ISO-8601 UTC
    pub accepted_at: String,
    /// 同意时覆盖的 provider 集合（子集判定用）
    pub providers: Vec<String>,
}

// 应用配置
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(default)]
pub struct AppConfig {
    pub auto_save: bool,
    pub sync_editor_bg: bool,
    pub language: String,
    pub custom_lang_hash: String,
    pub color_theme: String,
    pub appearance: String,
    /// 前端在主题应用后保存的亮/暗背景色（"r,g,b"），供建窗时兜底
    /// （第三方主题 Rust 无法预知，只能由前端解析主题 CSS 后写入）
    pub theme_bg_light: String,
    pub theme_bg_dark: String,
    pub font_family: FontFamily,
    pub editor_font_family: EditorFontFamily,
    pub editor_font_size: i32,
    /// 源码模式（SV）独立字体大小
    pub source_font_size: i32,
    pub image_storage_mode: ImageStorageMode,
    pub image_folder_name: String,
    /// 自定义图片存储路径（用户通过对话框选择）
    pub image_custom_path: Option<String>,
    /// 图片聚合方式
    pub image_aggregation_mode: ImageAggregationMode,
    /// 按日期聚合时的日期格式
    pub image_date_format: String,
    /// PicGo 图床服务器地址
    pub picgo_server_url: String,
    /// 窗口宽度
    pub window_width: f64,
    /// 窗口高度
    pub window_height: f64,
    /// 是否启用外部文件修改监听
    pub watch_external_file_changes: bool,
    /// 是否静默处理外部文件修改（不弹窗，默认直接编辑）
    pub silent_external_file_changes: bool,
    /// 代码块是否启用自动换行
    pub code_block_word_wrap: bool,
    /// 源码编辑器是否显示行号
    pub show_line_numbers: bool,
    /// 是否启用自动首字母大写（macOS 系统行为）
    pub auto_capitalize: bool,
    /// 是否显示字数统计
    pub show_word_count: bool,
    /// 可打开的文件扩展名列表
    pub openable_extensions: Vec<String>,
    /// 是否显示编辑器工具栏
    pub show_editor_toolbar: bool,
    /// 是否显示悬浮行内格式工具栏
    pub show_inline_format_toolbar: bool,
    /// 是否启用打字机模式（全局偏好）
    pub typewriter_enabled: bool,
    /// IR 模式是否限制正文最大宽度并居中（关闭则铺满编辑区）
    pub editor_readable_line_length: bool,
    /// 大纲样式：off（关闭）、text（文字树）或 minimap（迷你地图）
    pub outline_style: String,
    /// 启动行为：空白文档（默认）或打开工作区
    pub startup_behavior: StartupBehavior,
    /// 默认工作区目录（startup_behavior = workspace 时生效）
    pub workspace_folder: Option<String>,
    /// AI 功能总开关
    pub agent_enabled: bool,
    /// 模型配置列表（一个 provider 可有多条）
    pub agent_profiles: Vec<AgentModelProfile>,
    /// 全局同意记录（打开总开关时写入）
    pub agent_consent: Option<AgentConsentRecord>,
    /// 结果显示位置：floating / sidebar
    pub agent_result_surface: String,
    /// 上一次运行时的应用版本（启动时由前端写回当前版本）。空串 = 无记录（全新安装）。
    /// 用于设置向导的「版本区间门控」：判断用户是从哪个版本升级上来的。
    pub last_run_version: String,
    /// 是否启用 MCP 服务端（本机回环 HTTP，供外部 agent 调用）
    #[serde(default)]
    pub mcp_enabled: bool,
    /// MCP 服务端监听端口（默认 38471；环境变量 `TEXTO_MCP_PORT` 可临时覆盖）
    #[serde(default = "default_mcp_port")]
    pub mcp_port: u16,
}

/// 旧配置里没有 `mcp_port` 时回落到默认端口，避免整份配置解析失败被重置。
fn default_mcp_port() -> u16 {
    mcp::DEFAULT_PORT
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            auto_save: false,
            sync_editor_bg: false,
            language: String::from(""),
            custom_lang_hash: String::new(),
            color_theme: String::from("default"),
            appearance: String::from("system"),
            theme_bg_light: String::new(),
            theme_bg_dark: String::new(),
            font_family: FontFamily::default(),
            editor_font_family: EditorFontFamily::default(),
            editor_font_size: 15,
            source_font_size: 13,
            image_storage_mode: ImageStorageMode::AlongsideDocument,
            image_folder_name: String::from("assets"),
            image_custom_path: None,
            image_aggregation_mode: ImageAggregationMode::None,
            image_date_format: String::from("YYYY-MM"),
            picgo_server_url: String::from("http://127.0.0.1:36677"),
            window_width: 960.0,
            window_height: 700.0,
            watch_external_file_changes: true,
            silent_external_file_changes: false,
            code_block_word_wrap: true,
            show_line_numbers: true,
            auto_capitalize: false,
            show_word_count: false,
            openable_extensions: vec![
                String::from("md"),
                String::from("markdown"),
                String::from("txt"),
            ],
            show_editor_toolbar: cfg!(target_os = "windows"),
            show_inline_format_toolbar: true,
            typewriter_enabled: false,
            editor_readable_line_length: true,
            outline_style: String::from("off"),
            startup_behavior: StartupBehavior::BlankDocument,
            workspace_folder: None,
            agent_enabled: false,
            agent_profiles: Vec::new(),
            agent_consent: None,
            agent_result_surface: String::from("floating"),
            last_run_version: String::new(),
            mcp_enabled: false,
            mcp_port: mcp::DEFAULT_PORT,
        }
    }
}

/// 由插件提供的文件扩展名。历史版本把它们写进了 AppConfig 默认值，
/// 现在只在启用对应插件时才可打开（前端按插件清单合并），加载配置时清理残留。
const LEGACY_PLUGIN_EXTENSIONS: &[&str] = &["excalidraw"];

impl AppConfig {
    const STORE_KEY: &'static str = "app_config";

    pub fn load(app: &impl tauri::Manager<tauri::Wry>) -> Self {
        let mut config: Self = app
            .store("app_config.bin")
            .ok()
            .and_then(|store| store.get(Self::STORE_KEY))
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default();
        // 兜底：旧配置可能缺少新加入的默认扩展名，
        // 加载时确保默认可打开的扩展名始终存在。
        config.openable_extensions = Self::strip_legacy_plugin_extensions(
            Self::ensure_default_openable_extensions(config.openable_extensions),
        );
        config
    }

    /// 将默认可打开的扩展名合并进给定列表（保持已有项，追加缺失项）
    fn ensure_default_openable_extensions(mut extensions: Vec<String>) -> Vec<String> {
        for ext in Self::default().openable_extensions {
            if !extensions.iter().any(|e| e == &ext) {
                extensions.push(ext);
            }
        }
        extensions
    }

    /// 移除由插件提供的扩展名（历史版本曾把它们自动注入用户配置）。
    /// 插件启用后由前端按插件清单合并回可打开列表，不再写死在配置里。
    fn strip_legacy_plugin_extensions(extensions: Vec<String>) -> Vec<String> {
        extensions
            .into_iter()
            .filter(|ext| {
                let normalized = ext.trim().trim_start_matches('.').to_ascii_lowercase();
                !LEGACY_PLUGIN_EXTENSIONS.contains(&normalized.as_str())
            })
            .collect()
    }

    pub fn save(&self, app: &impl tauri::Manager<tauri::Wry>) -> Result<(), String> {
        let store = app.store("app_config.bin").map_err(|e| e.to_string())?;
        let value = serde_json::to_value(self).map_err(|e| e.to_string())?;
        store.set(Self::STORE_KEY, value);
        store.save().map_err(|e| e.to_string())?;
        Ok(())
    }
}

// 快捷键配置
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(default)]
pub struct ShortcutsConfig {
    pub version: i32,
    pub shortcuts: std::collections::HashMap<String, Option<String>>,
}

impl Default for ShortcutsConfig {
    fn default() -> Self {
        let mut shortcuts = std::collections::HashMap::new();
        let mod_key = if cfg!(target_os = "macos") {
            "Cmd"
        } else {
            "Ctrl"
        };
        // 文件操作
        shortcuts.insert("new_window".to_string(), Some(format!("{}+N", mod_key)));
        shortcuts.insert("open_file".to_string(), Some(format!("{}+O", mod_key)));
        shortcuts.insert("open_folder".to_string(), None);
        shortcuts.insert("save_file".to_string(), Some(format!("{}+S", mod_key)));
        shortcuts.insert("toggle_sidebar".to_string(), Some(format!("{}+T", mod_key)));
        shortcuts.insert(
            "toggle_edit_mode".to_string(),
            Some(format!("{}+/", mod_key)),
        );

        Self {
            version: 1,
            shortcuts,
        }
    }
}

impl ShortcutsConfig {
    const STORE_KEY: &'static str = "shortcuts_config";

    pub fn load(app: &impl tauri::Manager<tauri::Wry>) -> Self {
        let mut config: Self = app
            .store("app_config.bin")
            .ok()
            .and_then(|store| store.get(Self::STORE_KEY))
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default();

        // 合并默认配置（处理新增快捷键）
        let defaults = Self::default();
        for (key, value) in defaults.shortcuts {
            config.shortcuts.entry(key).or_insert(value);
        }

        config
    }

    pub fn save(&self, app: &impl tauri::Manager<tauri::Wry>) -> Result<(), String> {
        let store = app.store("app_config.bin").map_err(|e| e.to_string())?;
        let value = serde_json::to_value(self).map_err(|e| e.to_string())?;
        store.set(Self::STORE_KEY, value);
        store.save().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 获取指定动作的快捷键
    pub fn get_shortcut(&self, action_id: &str) -> Option<String> {
        self.shortcuts.get(action_id).cloned().flatten()
    }
}

/// 可配置快捷键的菜单项状态
/// 保存这些 MenuItem 的引用，用于在快捷键配置变化时动态更新 accelerator
#[cfg(desktop)]
pub struct AppMenuState {
    pub items: HashMap<String, MenuItem<tauri::Wry>>,
}

/// 外观菜单项状态（用于维护选中态）
#[cfg(desktop)]
pub struct AppearanceMenuState {
    pub light: CheckMenuItem<tauri::Wry>,
    pub dark: CheckMenuItem<tauri::Wry>,
    pub system: CheckMenuItem<tauri::Wry>,
}

/// 视图菜单项状态（用于维护选中态）
#[cfg(desktop)]
pub struct ViewMenuState {
    pub sidebar: CheckMenuItem<tauri::Wry>,
    pub edit_mode: CheckMenuItem<tauri::Wry>,
    pub typewriter: CheckMenuItem<tauri::Wry>,
    pub readable_line_length: CheckMenuItem<tauri::Wry>,
    pub toolbar: CheckMenuItem<tauri::Wry>,
    pub inline_format_toolbar: CheckMenuItem<tauri::Wry>,
    pub outline_style_off: CheckMenuItem<tauri::Wry>,
    pub outline_style_text: CheckMenuItem<tauri::Wry>,
    pub outline_style_minimap: CheckMenuItem<tauri::Wry>,
}

/// devtools 是否启用：debug 构建，或编译时设置了非空 TEXTO_DEVTOOLS（见 build.rs）
pub(crate) fn devtools_enabled() -> bool {
    cfg!(debug_assertions) || cfg!(devtools)
}

#[cfg(desktop)]
pub struct ThemeMenuState {
    pub default: CheckMenuItem<tauri::Wry>,
    pub pastel: CheckMenuItem<tauri::Wry>,
    pub spring: CheckMenuItem<tauri::Wry>,
    pub user_themes: HashMap<String, CheckMenuItem<tauri::Wry>>,
}

/// 将前端快捷键格式转换为 Tauri 的 accelerator 格式
fn to_tauri_accelerator(shortcut: &str) -> String {
    if cfg!(target_os = "macos") {
        shortcut.replace("Cmd", "Command").replace("Opt", "Option")
    } else {
        shortcut.replace("Cmd", "Ctrl").replace("Opt", "Alt")
    }
}

/// 插件 id 仅允许小写 ASCII 字母数字、`_`、`-`，长度 1..=64（防路径穿越/大小写错配）。
fn is_valid_plugin_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

/// 打开指定插件的独立配置 store（`plugin_config.<id>.json`）。
fn plugin_config_store(
    app: &tauri::AppHandle,
    plugin_id: &str,
) -> Result<std::sync::Arc<tauri_plugin_store::Store<tauri::Wry>>, String> {
    if !is_valid_plugin_id(plugin_id) {
        return Err(format!("invalid plugin id: {plugin_id}"));
    }
    app.store(format!("plugin_config.{plugin_id}.json"))
        .map_err(|e| e.to_string())
}

const PLUGIN_CONFIG_KEY: &str = "config";

#[command]
async fn get_plugin_config(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<serde_json::Value, String> {
    let store = plugin_config_store(&app, &plugin_id)?;
    Ok(store
        .get(PLUGIN_CONFIG_KEY)
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| serde_json::Value::Object(Default::default())))
}

/// 批量读取插件配置（启动预热用）：一次 IPC 取回全部插件配置，
/// 避免前端按插件数逐个往返。非法 id 跳过；未配置的插件返回空对象。
#[command]
async fn get_plugin_configs(
    app: tauri::AppHandle,
    plugin_ids: Vec<String>,
) -> Result<HashMap<String, serde_json::Value>, String> {
    let mut out = HashMap::new();
    for plugin_id in plugin_ids {
        let Ok(store) = plugin_config_store(&app, &plugin_id) else {
            continue;
        };
        let value = store
            .get(PLUGIN_CONFIG_KEY)
            .filter(serde_json::Value::is_object)
            .unwrap_or_else(|| serde_json::Value::Object(Default::default()));
        out.insert(plugin_id, value);
    }
    Ok(out)
}

#[command]
async fn set_plugin_config(
    app: tauri::AppHandle,
    plugin_id: String,
    config: serde_json::Value,
) -> Result<(), String> {
    let store = plugin_config_store(&app, &plugin_id)?;
    store.set(PLUGIN_CONFIG_KEY, config);
    store.save().map_err(|e| e.to_string())
}

#[command]
async fn get_config(app: tauri::AppHandle) -> Result<AppConfig, String> {
    Ok(AppConfig::load(&app))
}

#[command]
async fn get_default_config() -> Result<AppConfig, String> {
    Ok(AppConfig::default())
}

#[command]
fn get_mcp_status(app: tauri::AppHandle) -> mcp::McpStatus {
    mcp::status(&app)
}

#[command]
async fn get_app_version(app: tauri::AppHandle) -> Result<String, String> {
    Ok(app.package_info().version.to_string())
}

#[command]
async fn set_config(app: tauri::AppHandle, mut config: AppConfig) -> Result<(), String> {
    // theme_bg_* 由 set_theme_bg 单独维护：换主题流程的 get_config → set_config
    // 快照可能包含旧的/空的 theme_bg，直接覆盖保存会丢掉刚捕获的主题背景色，
    // 导致下次建窗时用错底色。这里用当前存储值保护这两个字段。
    let current = AppConfig::load(&app);
    config.theme_bg_light = current.theme_bg_light;
    config.theme_bg_dark = current.theme_bg_dark;
    config.save(&app)?;
    // MCP 开关即时生效：开→起监听，关→停监听（失败原因由 get_mcp_status 返回）
    mcp::apply(&app, config.mcp_enabled);
    // 打字机/工具栏勾选是全局设置：按落盘值直接校准原生菜单，
    // 不再依赖某个窗口的前端 state 回推
    #[cfg(desktop)]
    sync_global_view_menu_checks(&app, &config);
    // 广播配置变化到所有窗口
    let _ = app.emit("config-changed", config);
    Ok(())
}

#[command]
fn set_theme_bg(app: tauri::AppHandle, light: String, dark: String) -> Result<(), String> {
    let mut config = AppConfig::load(&app);
    config.theme_bg_light = light;
    config.theme_bg_dark = dark;
    config.save(&app)
}

#[command]
async fn get_shortcuts_config(app: tauri::AppHandle) -> Result<ShortcutsConfig, String> {
    Ok(ShortcutsConfig::load(&app))
}

/// 同步主题菜单的选中态（从前端调用）
#[cfg(desktop)]
#[command]
async fn sync_theme_menu(app: tauri::AppHandle, theme: String) -> Result<(), String> {
    if let Some(state) = app.try_state::<ThemeMenuState>() {
        state
            .default
            .set_checked(theme == "default")
            .map_err(|e| e.to_string())?;
        state
            .pastel
            .set_checked(theme == "pastel")
            .map_err(|e| e.to_string())?;
        state
            .spring
            .set_checked(theme == "spring")
            .map_err(|e| e.to_string())?;
        for (tid, item) in state.user_themes.iter() {
            item.set_checked(tid == &theme).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 同步外观菜单的选中态（从前端调用，当通过设置窗口切换外观时）
#[cfg(desktop)]
#[command]
async fn sync_appearance_menu(app: tauri::AppHandle, appearance: String) -> Result<(), String> {
    if let Some(state) = app.try_state::<AppearanceMenuState>() {
        state
            .light
            .set_checked(appearance == "light")
            .map_err(|e| e.to_string())?;
        state
            .dark
            .set_checked(appearance == "dark")
            .map_err(|e| e.to_string())?;
        state
            .system
            .set_checked(appearance == "system")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 同步视图菜单的窗口级勾选状态（从前端调用；这些状态随窗口变化）
#[cfg(desktop)]
#[command]
async fn sync_view_menu(
    app: tauri::AppHandle,
    sidebar_visible: bool,
    edit_mode: bool,
) -> Result<(), String> {
    if let Some(state) = app.try_state::<ViewMenuState>() {
        state
            .sidebar
            .set_checked(sidebar_visible)
            .map_err(|e| e.to_string())?;
        state
            .edit_mode
            .set_checked(edit_mode)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 按持久化配置同步「全局视图设置」勾选项（打字机/工具栏，不随聚焦窗口变化）。
/// 所有写配置的入口（set_config / 菜单翻转）保存后都应调用，保证原生菜单
/// 勾选与 app_config.bin 的单一数据源一致，避免被某个窗口的本地旧状态覆盖。
#[cfg(desktop)]
fn sync_global_view_menu_checks(app: &tauri::AppHandle, config: &AppConfig) {
    if let Some(state) = app.try_state::<ViewMenuState>() {
        let _ = state.typewriter.set_checked(config.typewriter_enabled);
        let _ = state
            .readable_line_length
            .set_checked(config.editor_readable_line_length);
        let _ = state.toolbar.set_checked(config.show_editor_toolbar);
        let _ = state
            .inline_format_toolbar
            .set_checked(config.show_inline_format_toolbar);
        let _ = state
            .outline_style_off
            .set_checked(config.outline_style == "off");
        let _ = state
            .outline_style_text
            .set_checked(config.outline_style == "text");
        let _ = state
            .outline_style_minimap
            .set_checked(config.outline_style == "minimap");
    }
}

#[command]
async fn set_shortcuts_config(
    app: tauri::AppHandle,
    config: ShortcutsConfig,
) -> Result<(), String> {
    config.save(&app)?;

    // 同步更新系统菜单的 accelerator，否则旧快捷键仍会触发菜单事件
    #[cfg(desktop)]
    {
        if let Some(state) = app.try_state::<AppMenuState>() {
            for (action_id, item) in &state.items {
                let accelerator = config
                    .get_shortcut(action_id)
                    .map(|s| to_tauri_accelerator(&s));
                if let Err(e) = item.set_accelerator(accelerator.as_deref()) {
                    error!("更新菜单快捷键 [{}] 失败: {}", action_id, e);
                }
            }
        }

        // 视图菜单的勾选项（CheckMenuItem）同样需要同步 accelerator
        if let Some(state) = app.try_state::<ViewMenuState>() {
            for (action_id, item) in [
                ("toggle_sidebar", &state.sidebar),
                ("toggle_edit_mode", &state.edit_mode),
                ("toggle_typewriter_mode", &state.typewriter),
            ] {
                let accelerator = config
                    .get_shortcut(action_id)
                    .map(|s| to_tauri_accelerator(&s));
                if let Err(e) = item.set_accelerator(accelerator.as_deref()) {
                    error!("更新菜单快捷键 [{}] 失败: {}", action_id, e);
                }
            }
        }
    }

    // 导出子菜单项在启动后可能已被前端 `sync_submenu` 重建，`AppMenuState` 里的
    // 旧句柄已脱离菜单。这里按 id 从当前实时菜单重新解析，保证运行时改快捷键
    // 仍能更新导出项（尤其 export_pdf）的加速键。
    #[cfg(all(not(feature = "free-version"), desktop))]
    if let Some(menu) = app.menu() {
        if let Some(export_submenu) = find_submenu(&menu, "export_submenu") {
            for &item_id in EXPORT_MENU_IDS {
                let Some(item_kind) = export_submenu.get(item_id) else {
                    continue;
                };
                let Some(item) = item_kind.as_menuitem() else {
                    continue;
                };
                let accelerator = config
                    .get_shortcut(item_id)
                    .map(|s| to_tauri_accelerator(&s));
                if let Err(e) = item.set_accelerator(accelerator.as_deref()) {
                    error!("更新菜单快捷键 [{}] 失败: {}", item_id, e);
                }
            }
        }
    }

    // 广播快捷键配置变化到所有窗口
    let _ = app.emit("shortcuts-config-changed", config);
    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileNode {
    name: String,
    path: String,
    #[serde(rename = "isDirectory")]
    is_directory: bool,
    children: Option<Vec<FileNode>>,
    #[serde(default, rename = "hasChildren")]
    pub has_children: bool,
    /// Finder 标签颜色键（仅 macOS 有值）
    #[serde(default, rename = "tagColor", skip_serializing_if = "Option::is_none")]
    pub tag_color: Option<String>,
}

const SEARCH_RESULT_LIMIT: usize = 200;
const SEARCH_MAX_DEPTH: usize = 64;

#[derive(Serialize, Clone, Debug)]
pub struct SearchResult {
    pub name: String,
    pub path: String,
}

fn search_files_sync(path: &Path, query: &str) -> Result<Vec<SearchResult>, String> {
    let query_lower = query.trim().to_lowercase();
    if query_lower.is_empty() {
        return Ok(Vec::new());
    }
    let mut results = Vec::new();
    search_files_recursive(path, &query_lower, &mut results, 0)?;
    results.sort_by_key(|a| a.name.to_lowercase());
    Ok(results)
}

fn search_files_recursive(
    path: &Path,
    query_lower: &str,
    results: &mut Vec<SearchResult>,
    depth: usize,
) -> Result<(), String> {
    if depth > SEARCH_MAX_DEPTH {
        return Ok(());
    }
    let entries = read_search_entries(path)?;
    for (name, item_path, is_directory) in entries {
        if results.len() >= SEARCH_RESULT_LIMIT {
            return Ok(());
        }
        if !is_directory && name.to_lowercase().contains(query_lower) {
            results.push(SearchResult {
                name: name.clone(),
                path: item_path.clone(),
            });
        }
        if is_directory {
            let _ = search_files_recursive(Path::new(&item_path), query_lower, results, depth + 1);
        }
    }
    Ok(())
}

fn read_search_entries(path: &Path) -> Result<Vec<(String, String, bool)>, String> {
    #[cfg(target_os = "macos")]
    {
        let path_str = path.to_string_lossy().to_string();
        if let Ok(items) = macos_fs::read_directory_ns(&path_str) {
            return Ok(items);
        }
    }
    let mut entries = Vec::new();
    let dir = std::fs::read_dir(path).map_err(|e| e.to_string())?;
    for entry in dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".DS_Store" || name.starts_with('.') {
            continue;
        }
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let is_directory = metadata.is_dir();
        let item_path = entry.path().to_string_lossy().to_string();
        entries.push((name, item_path, is_directory));
    }
    Ok(entries)
}

#[command]
async fn search_files(path: String, query: String) -> Result<Vec<SearchResult>, String> {
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || search_files_sync(&path, &query))
        .await
        .map_err(|e| e.to_string())?
}

#[command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn read_directory_with_depth(path: &Path, depth: usize) -> Result<Vec<FileNode>, String> {
    #[cfg(target_os = "macos")]
    {
        let path_str = path.to_string_lossy().to_string();
        if let Ok(items) = macos_fs::read_directory_ns(&path_str) {
            let mut entries = Vec::new();
            for (name, item_path, is_directory) in items {
                let children = if is_directory && depth > 0 {
                    read_directory_with_depth(Path::new(&item_path), depth - 1).ok()
                } else {
                    None
                };

                let has_children = match &children {
                    Some(c) => !c.is_empty(),
                    None if is_directory => macos_fs::read_directory_ns(&item_path)
                        .map(|sub| !sub.is_empty())
                        .unwrap_or(false),
                    _ => false,
                };

                let tag_color = macos_tags::read_color(&item_path);

                let node = FileNode {
                    name,
                    path: item_path,
                    is_directory,
                    children,
                    has_children,
                    tag_color,
                };
                entries.push(node);
            }
            return Ok(entries);
        }
    }

    let mut entries = Vec::new();
    let dir = std::fs::read_dir(path).map_err(|e| e.to_string())?;

    for entry in dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if name == ".DS_Store" || name.starts_with('.') {
            continue;
        }

        let is_directory = metadata.is_dir();

        let has_children = if is_directory {
            std::fs::read_dir(&entry_path)
                .map(|mut d| d.next().is_some())
                .unwrap_or(false)
        } else {
            false
        };

        let children = if is_directory && depth > 0 && has_children {
            read_directory_with_depth(&entry_path, depth - 1).ok()
        } else {
            None
        };

        let node = FileNode {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_directory,
            children,
            has_children,
            tag_color: None,
        };

        entries.push(node);
    }

    entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

fn read_directory_lazy_sync(path: &Path) -> Result<Vec<FileNode>, String> {
    read_directory_with_depth(path, 0)
}

#[command]
async fn read_directory(path: String) -> Result<Vec<FileNode>, String> {
    let path = PathBuf::from(path);
    // 预加载2层目录，避免创建文件时的同名冲突
    tokio::task::spawn_blocking(move || read_directory_with_depth(&path, 1))
        .await
        .map_err(|e| e.to_string())?
}

#[command]
async fn read_subdirectory(path: String) -> Result<Vec<FileNode>, String> {
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || read_directory_lazy_sync(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// Finder 标签颜色选项（仅 macOS 返回非空，其它平台前端不显示颜色菜单）
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TagColorOption {
    /// 颜色键：red / orange / yellow / green / blue / purple / gray
    pub key: String,
    /// 当前系统语言下的标签名，例如"红色"
    pub name: String,
}

#[command]
fn get_file_tag_colors() -> Vec<TagColorOption> {
    macos_tags::color_options()
        .into_iter()
        .map(|(key, name)| TagColorOption { key, name })
        .collect()
}

/// 设置文件颜色；color 传 null 表示清除颜色
#[command]
async fn set_file_tag_color(path: String, color: Option<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || macos_tags::write_color(&path, color.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[command]
async fn read_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileMetadata {
    size: u64,
    mtime_ms: Option<i64>,
}

#[command]
async fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| e.to_string())?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);
    Ok(FileMetadata {
        size: meta.len(),
        mtime_ms,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileContentStatus {
    changed: bool,
    size: u64,
    mtime_ms: Option<i64>,
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

/// 比较磁盘内容与前端已知内容的哈希，只返回结果，避免大文件内容经过 IPC 传输
#[command]
async fn compare_file_content(
    path: String,
    expected_hashes: Vec<String>,
) -> Result<FileContentStatus, String> {
    let content = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    let mtime_ms = tokio::fs::metadata(&path)
        .await
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);
    let digest = bytes_to_hex(&Sha256::digest(&content));
    Ok(FileContentStatus {
        changed: !expected_hashes.iter().any(|h| h == &digest),
        size: content.len() as u64,
        mtime_ms,
    })
}

#[command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| e.to_string())
}

#[command]
async fn create_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos_fs::create_file_ns(&path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        tokio::fs::File::create(&path)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[command]
async fn create_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos_fs::create_folder_ns(&path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        tokio::fs::create_dir(&path)
            .await
            .map_err(|e| e.to_string())
    }
}

#[command]
async fn path_exists(path: String) -> Result<bool, String> {
    Ok(tokio::fs::try_exists(&path).await.unwrap_or(false))
}

#[command]
fn is_icloud_file(path: String) -> Result<macos_fs::ICloudFileStatus, String> {
    macos_fs::is_icloud_file(&path)
}

/// 将文件或文件夹移到废纸篓（macOS 使用 NsFileManager 以支持 iCloud 文件）
#[cfg(not(target_os = "ios"))]
fn trash_delete(path: &str) -> Result<(), trash::Error> {
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        let mut ctx = trash::TrashContext::new();
        ctx.set_delete_method(DeleteMethod::NsFileManager);
        ctx.delete(path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        trash::delete(path)
    }
}

/// iOS 上没有废纸篓概念，直接返回错误让调用方执行物理删除
#[cfg(target_os = "ios")]
fn trash_delete(path: &str) -> Result<(), String> {
    Err(format!("trash is not supported on iOS: {path}"))
}

#[command]
async fn delete_file(path: String) -> Result<(), String> {
    match trash_delete(&path) {
        Ok(_) => Ok(()),
        Err(_) => {
            // 如果移到废纸篓失败，则直接删除
            tokio::fs::remove_file(&path)
                .await
                .map_err(|e| e.to_string())
        }
    }
}

#[command]
async fn delete_folder(path: String) -> Result<(), String> {
    match trash_delete(&path) {
        Ok(_) => Ok(()),
        Err(_) => {
            // 如果移到废纸篓失败，则直接删除
            tokio::fs::remove_dir_all(&path)
                .await
                .map_err(|e| e.to_string())
        }
    }
}

#[command]
async fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos_fs::rename_file_ns(&old_path, &new_path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        tokio::fs::rename(&old_path, &new_path)
            .await
            .map_err(|e| e.to_string())
    }
}

#[command]
async fn check_path_type(path: String) -> Result<String, String> {
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| e.to_string())?;
    if metadata.is_dir() {
        Ok("directory".to_string())
    } else if metadata.is_file() {
        Ok("file".to_string())
    } else {
        Ok("unknown".to_string())
    }
}

#[command]
fn get_temp_dir() -> Result<String, String> {
    Ok(std::env::temp_dir().to_string_lossy().to_string())
}

#[command]
fn save_pdf_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &data).map_err(|e| format!("Failed to save PDF: {}", e))?;
    Ok(())
}

/// 保存二进制导出产物（PNG / EPUB）。前端以 base64 传入，与 `save_image` 约定一致。
/// 用 async + tokio::fs：长图 PNG 可能几十 MB，同步写在主线程会造成可见卡顿。
#[command]
async fn save_binary_file(path: String, base64_data: String) -> Result<(), String> {
    let data = BASE64
        .decode(&base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;
    tokio::fs::write(&path, &data)
        .await
        .map_err(|e| format!("Failed to save file: {}", e))?;
    Ok(())
}

/// 单次远程媒体下载上限（100 MiB）。
const MAX_REMOTE_MEDIA_BYTES: u64 = 100 * 1024 * 1024;

const TOO_LARGE: &str = "File is too large to download";

fn validate_remote_media_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|e| format!("Invalid URL: {}", e))?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        other => Err(format!("Unsupported URL scheme: {}", other)),
    }
}

/// 远程图片下载兜底：webview 的 fetch 受 CORS 限制时，由 Rust 侧直接拉取。
/// 只允许 http/https；按块流式读取并在增量上校验大小，避免把任意大文件读进内存。
#[command]
async fn download_remote_file(url: String) -> Result<String, String> {
    let parsed = validate_remote_media_url(&url)?;
    let client = reqwest::Client::builder()
        .user_agent(concat!("Textox/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(10))
        .read_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| format!("Failed to download file: {}", e))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Download failed with HTTP {}", status));
    }
    if let Some(length) = response.content_length() {
        if length > MAX_REMOTE_MEDIA_BYTES {
            return Err(TOO_LARGE.into());
        }
    }

    let mut buffer = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or(0)
            .min(MAX_REMOTE_MEDIA_BYTES) as usize,
    );
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?
    {
        if buffer.len() as u64 + chunk.len() as u64 > MAX_REMOTE_MEDIA_BYTES {
            return Err(TOO_LARGE.into());
        }
        buffer.extend_from_slice(&chunk);
    }
    if buffer.is_empty() {
        return Err("Downloaded file is empty".into());
    }
    Ok(BASE64.encode(&buffer))
}

/// PDF 捕获区域，对应 `WKPDFConfiguration.rect`，单位为 web page 坐标（CSS 像素）。
///
/// 由前端按导出内容在文档中的位置计算：内容被挂在应用界面之后的文档流中
/// （位于视口下方），因此这里只截取该区域即可导出纯内容 PDF，
/// 无需在导出期间隐藏侧边栏/顶栏等任何界面组件。
#[cfg(target_os = "macos")]
#[derive(Debug, serde::Deserialize)]
struct PdfCaptureRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn export_pdf(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    save_path: String,
    rect: Option<PdfCaptureRect>,
) -> Result<(), String> {
    use std::sync::{Arc, Mutex};
    use tokio::sync::oneshot;

    // 导出当前 focus 的编辑器窗口：优先使用发起调用的窗口，
    // 非编辑器窗口（设置等）回退到主窗口。
    let window = if crate::window_manager::is_editor_label(window.label()) {
        window
    } else {
        app.get_webview_window("main")
            .ok_or("Main window not found")?
    };
    let (tx, rx) = oneshot::channel();
    let tx = Arc::new(Mutex::new(Some(tx)));

    window
        .with_webview(move |webview| {
            let result = unsafe { export_pdf_on_main(webview, tx.clone(), rect) };
            if let Err(e) = result {
                if let Some(tx) = tx.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    let _ = tx.send(Err(e));
                }
            }
        })
        .map_err(|e| e.to_string())?;

    let data = rx
        .await
        .map_err(|_| "PDF export callback not invoked".to_string())??;

    // 沙盒环境下确保对该路径有访问权限：当前打开的目录已存有书签，
    // 通过 pick_pdf_save_path 选择的目录已在面板返回时持有 security-scoped 访问。
    if let Some(bm) = app.try_state::<bookmark_manager::BookmarkManager>() {
        let _ = bm.start_access(&save_path);
    }

    std::fs::write(&save_path, data).map_err(|e| format!("Failed to save PDF: {}", e))?;
    Ok(())
}

#[cfg(target_os = "macos")]
#[allow(clippy::type_complexity)]
unsafe fn export_pdf_on_main(
    webview: tauri::webview::PlatformWebview,
    tx: std::sync::Arc<
        std::sync::Mutex<Option<tokio::sync::oneshot::Sender<Result<Vec<u8>, String>>>>,
    >,
    rect: Option<PdfCaptureRect>,
) -> Result<(), String> {
    use block2::RcBlock;
    use objc2::{class, msg_send};

    let view = webview.inner() as *mut objc2::runtime::NSObject;

    let config: *mut objc2::runtime::NSObject = msg_send![class!(WKPDFConfiguration), new];
    if config.is_null() {
        return Err("Failed to create WKPDFConfiguration".into());
    }

    // 只捕获内容区域：不设置 rect 时 WKWebView 会捕获整个页面（含侧边栏/顶栏），
    // 这也是旧实现必须先隐藏界面才能导出纯内容的原因。
    // 尺寸钳制到至少 1pt：零/负数尺寸等同于 null rect，会回退成整页捕获。
    if let Some(r) = rect {
        let capture = objc2_foundation::NSRect::new(
            objc2_foundation::NSPoint::new(r.x, r.y),
            objc2_foundation::NSSize::new(r.width.max(1.0), r.height.max(1.0)),
        );
        let _: () = msg_send![config, setRect: capture];
    }

    let handler = RcBlock::new(
        move |pdf_data: *mut objc2::runtime::NSObject, error: *mut objc2::runtime::NSObject| {
            let tx = tx.lock().unwrap_or_else(|e| e.into_inner()).take();
            if let Some(tx) = tx {
                if !error.is_null() {
                    let desc: *mut objc2::runtime::NSObject =
                        msg_send![error, localizedDescription];
                    let s = if !desc.is_null() {
                        let cstr: *const std::os::raw::c_char = msg_send![desc, UTF8String];
                        if !cstr.is_null() {
                            std::ffi::CStr::from_ptr(cstr)
                                .to_string_lossy()
                                .into_owned()
                        } else {
                            "Unknown error".into()
                        }
                    } else {
                        "Unknown error".into()
                    };
                    let _ = tx.send(Err(s));
                } else if !pdf_data.is_null() {
                    let bytes: *const std::ffi::c_void = msg_send![pdf_data, bytes];
                    let len: usize = msg_send![pdf_data, length];
                    if bytes.is_null() {
                        let _ = tx.send(Err("PDF data has no backing buffer".into()));
                    } else {
                        // pdf_data 在回调期间保持有效，bytes 指向其内部缓冲区；
                        // 立即 to_vec() 拷贝，避免指针在回调返回后悬垂。
                        let vec = std::slice::from_raw_parts(bytes as *const u8, len).to_vec();
                        let _ = tx.send(Ok(vec));
                    }
                } else {
                    let _ = tx.send(Err("No PDF data received".into()));
                }
            }
        },
    );

    let _: () = msg_send![view, createPDFWithConfiguration: config, completionHandler: &*handler];
    Ok(())
}

/// 打印页边距（单位 pt），由前端按编辑器内容区自身的内边距测量后传入。
///
/// 打印时克隆体的内边距会被清零（见 print.css 的 `html.texto-printing`），
/// 纸张边距在这里统一提供，因此纸张留白与编辑器看到的留白一致；若在编辑器
/// 内边距之上再叠一层固定边距，左右会比上下宽出一截（编辑器左右 60px、上下 40px）。
#[cfg(target_os = "macos")]
#[derive(Debug, serde::Deserialize)]
struct PrintMargins {
    top: f64,
    bottom: f64,
    left: f64,
    right: f64,
}

/// 原生打印当前窗口内容（macOS 系统打印面板，含「存储为 PDF」）。
///
/// 走 WKWebView 自带的 `printOperationWithPrintInfo:`：WebKit 按系统纸张
/// 正常分页，文字保持原尺寸，打印面板提供打印机/份数/页码范围等选项。
///
/// 关键点：打印只影响**打印渲染**。`@media print` 规则（见
/// `src/components/styles/components/print.css`）在打印渲染中隐藏应用界面、
/// 只显示 `#texto-print-overlay`（前端挂载的导出克隆体），屏幕上的侧边栏、
/// 顶栏、编辑器不会被隐藏或改动。`runOperation` 返回后前端才移除克隆体，
/// 保证打印期间内容始终存在。
#[cfg(target_os = "macos")]
#[tauri::command]
async fn print_webview(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    job_name: Option<String>,
    margins: Option<PrintMargins>,
) -> Result<(), String> {
    use std::sync::{Arc, Mutex};
    use tokio::sync::oneshot;

    // 与 export_pdf 一致：优先使用发起调用的编辑器窗口，非编辑器窗口回退到主窗口
    let window = if crate::window_manager::is_editor_label(window.label()) {
        window
    } else {
        app.get_webview_window("main")
            .ok_or("Main window not found")?
    };
    let (tx, rx) = oneshot::channel();
    let tx = Arc::new(Mutex::new(Some(tx)));

    info!("Showing print panel for job: {:?}", job_name);

    window
        .with_webview(move |webview| {
            let result = unsafe { print_webview_on_main(webview, tx.clone(), job_name, margins) };
            if let Err(e) = result {
                if let Some(tx) = tx.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    let _ = tx.send(Err(e));
                }
            }
        })
        .map_err(|e| e.to_string())?;

    rx.await
        .map_err(|_| "Print callback not invoked".to_string())?
}

#[cfg(target_os = "macos")]
#[allow(clippy::type_complexity)]
unsafe fn print_webview_on_main(
    webview: tauri::webview::PlatformWebview,
    tx: std::sync::Arc<std::sync::Mutex<Option<tokio::sync::oneshot::Sender<Result<(), String>>>>>,
    job_name: Option<String>,
    margins: Option<PrintMargins>,
) -> Result<(), String> {
    use objc2::{class, msg_send};

    let view = webview.inner() as *mut objc2::runtime::NSObject;

    let info: *mut objc2::runtime::NSObject = msg_send![class!(NSPrintInfo), sharedPrintInfo];
    if info.is_null() {
        return Err("Failed to create NSPrintInfo".into());
    }

    // 页边距取编辑器内容区自身的内边距（前端测量后传入），未传时用编辑器默认值
    // （--page-padding-y 40px、--page-padding-x 60px，即 30pt / 45pt）。
    // 下限 12pt：多页时第 2 页起没有内容区自身的内边距兜底，不能顶到不可打印区。
    let margins = margins.unwrap_or(PrintMargins {
        top: 30.0,
        bottom: 30.0,
        left: 45.0,
        right: 45.0,
    });
    let min_margin = 12.0_f64;
    let _: () = msg_send![info, setTopMargin: margins.top.max(min_margin)];
    let _: () = msg_send![info, setBottomMargin: margins.bottom.max(min_margin)];
    let _: () = msg_send![info, setLeftMargin: margins.left.max(min_margin)];
    let _: () = msg_send![info, setRightMargin: margins.right.max(min_margin)];

    let dict: *mut objc2::runtime::NSObject = msg_send![info, dictionary];
    if !dict.is_null() {
        // 不打印页眉页脚（URL / 日期），只输出文档内容
        let header_key = objc2_foundation::NSString::from_str("NSPrintHeaderAndFooter");
        let no: *mut objc2::runtime::NSObject = msg_send![class!(NSNumber), numberWithBool: false];
        let _: () = msg_send![dict, setObject: no, forKey: &*header_key];

        // 打印队列/面板里显示当前文档名，而不是应用名
        if let Some(name) = job_name.as_deref().filter(|n| !n.is_empty()) {
            let name_key = objc2_foundation::NSString::from_str("NSPrintJobName");
            let name_value = objc2_foundation::NSString::from_str(name);
            let _: () = msg_send![dict, setObject: &*name_value, forKey: &*name_key];
        }
    }

    let operation: *mut objc2::runtime::NSObject =
        msg_send![view, printOperationWithPrintInfo: info];
    if operation.is_null() {
        return Err("Failed to create print operation".into());
    }
    let _: () = msg_send![operation, setShowsPrintPanel: true];
    let _: () = msg_send![operation, setShowsProgressPanel: true];

    // 交给打印会话：打开 webView 背景（wry 为透明窗口关掉了它，保持关闭会输出空白），
    // 再用 sheet + 委托回调运行 —— WKWebView 的打印是异步绘制的，直接 runOperation
    // 会在内容画出来之前返回，表现为「预览正常、保存为 PDF 是空白」。
    let Some(sender) = tx.lock().unwrap_or_else(|e| e.into_inner()).take() else {
        return Ok(());
    };
    crate::print_session::start(
        operation as *mut objc2::runtime::AnyObject,
        view as *mut objc2::runtime::AnyObject,
        sender,
    );
    Ok(())
}

// 格式化路径显示：将 home 目录替换为 ~，过长时智能截断
pub(crate) fn format_path_for_display(path: &str, max_len: usize) -> String {
    // 获取 home 目录
    let home_dir = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    // 替换 home 目录为 ~
    let display_path = if !home_dir.is_empty() && path.starts_with(&home_dir) {
        format!("~{}", &path[home_dir.len()..])
    } else {
        path.to_string()
    };

    // 确保 max_len 至少为 3，避免后续减法下溢
    let max_len = max_len.max(3);

    // 如果长度符合要求，直接返回
    if display_path.len() <= max_len {
        return display_path;
    }

    // 智能截断：保留最后两级目录
    let parts: Vec<&str> = display_path.split(std::path::MAIN_SEPARATOR).collect();
    if parts.len() <= 2 {
        // 目录层级太少，直接截断字符串（按字符边界，避免 UTF-8 切片 panic）
        return truncate_path_tail(&display_path, max_len);
    }

    // 尝试保留最后两级
    let last_two = parts[parts.len() - 2..].join(std::path::MAIN_SEPARATOR_STR);
    if last_two.len() + 4 <= max_len {
        return format!("...{}", last_two);
    }

    // 只保留最后一级
    let last_one = parts[parts.len() - 1];
    if last_one.len() + 4 <= max_len {
        return format!("...{}", last_one);
    }

    // 最后一级也太长，强制截断
    truncate_path_tail(last_one, max_len)
}

/// 截取字符串尾部并加上 "..." 前缀，保证总长度不超过 `max_len` 字节。
/// 从字符串末尾按字符累加，天然落在 UTF-8 字符边界上，
/// 避免对多字节字符（中文/日文等）的中间字节切片导致 panic。
fn truncate_path_tail(s: &str, max_len: usize) -> String {
    // 保留 "..." 的 3 个字节，尾部最多展示 max_len - 3 字节
    let budget = max_len - 3;
    if s.len() <= budget {
        return format!("...{}", s);
    }
    let mut start = s.len();
    let mut taken = 0usize;
    for (idx, ch) in s.char_indices().rev() {
        let byte_len = ch.len_utf8();
        if taken + byte_len > budget {
            break;
        }
        taken += byte_len;
        start = idx;
    }
    format!("...{}", &s[start..])
}

// 最近文件存储管理
pub struct RecentFilesStore;

/// 归一化最近项目路径：去除末尾路径分隔符（/ 和 \），避免同一目录
/// 因末尾斜杠差异被重复记录。macOS 从 Finder/Dock 打开目录时路径可能
/// 带末尾斜杠（file:///.../Documents/），而目录选择对话框返回的路径不带。
fn normalize_recent_path(path: &str) -> String {
    let trimmed = path.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() || (trimmed.len() == 2 && trimmed.ends_with(':')) {
        path.to_string()
    } else {
        trimmed.to_string()
    }
}

impl RecentFilesStore {
    const STORE_NAME: &'static str = "recent_items.bin";
    const KEY: &'static str = "items";

    pub fn load(app: &impl tauri::Manager<tauri::Wry>) -> Vec<String> {
        app.store(Self::STORE_NAME)
            .ok()
            .and_then(|store| store.get(Self::KEY))
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default()
    }

    pub fn save(app: &impl tauri::Manager<tauri::Wry>, items: &[String]) -> Result<(), String> {
        let store = app.store(Self::STORE_NAME).map_err(|e| e.to_string())?;
        store.set(
            Self::KEY,
            serde_json::to_value(items).map_err(|e| e.to_string())?,
        );
        store.save().map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[command]
async fn save_recent_items(items: Vec<String>, app_handle: tauri::AppHandle) -> Result<(), String> {
    // 归一化路径并过滤掉未保存文件（临时文件），同时去重
    let mut seen = HashSet::new();
    let items: Vec<String> = items
        .into_iter()
        .map(|path| normalize_recent_path(&path))
        .filter(|path| !temp_files::TempFileManager::is_temp_path(&app_handle, path))
        .filter(|path| seen.insert(path.clone()))
        .collect();

    // 使用 store 保存最近文件列表
    RecentFilesStore::save(&app_handle, &items)?;

    // 更新菜单中的最近项目列表
    #[cfg(desktop)]
    {
        update_recent_menu(&app_handle, &items).map_err(|e| e.to_string())?;
    }

    // macOS: 向 Launch Services 注册所有最近文档（使关闭应用后 Dock 右键也能显示全部）
    #[cfg(target_os = "macos")]
    {
        let _ = app_handle.run_on_main_thread(move || {
            for path in &items {
                dock_menu::register_recent_document(path);
            }
        });
    }

    Ok(())
}

/// 更新菜单中的最近项目列表
#[cfg(desktop)]
fn update_recent_menu(app_handle: &tauri::AppHandle, items: &[String]) -> tauri::Result<()> {
    info!("Updating recent menu with {} items", items.len());

    let Some(menu) = app_handle.menu() else {
        info!("No menu found");
        return Ok(());
    };

    let t = |key: &str| -> String { i18n::translate(key) };

    // 找到文件菜单
    if let Some(file_menu) = menu.get("file") {
        let Some(file_submenu) = file_menu.as_submenu() else {
            return Ok(());
        };

        // 找到"打开最近的项目"子菜单
        if let Some(open_recent) = file_submenu.get("open_recent") {
            let Some(open_recent_submenu) = open_recent.as_submenu() else {
                return Ok(());
            };

            // 获取当前菜单项
            let current_items = open_recent_submenu.items()?;
            info!("Current menu items count: {}", current_items.len());

            // 检查当前菜单项是否已经与目标列表一致
            // 收集当前菜单中的最近项目路径
            let mut current_paths: Vec<String> = Vec::new();
            for item in &current_items {
                let id = item.id().as_ref();
                if id.starts_with("recent_item_") {
                    // 解码 base64 路径
                    if let Some(encoded) = id.strip_prefix("recent_item_") {
                        if let Ok(decoded) = BASE64.decode(encoded) {
                            if let Ok(path) = String::from_utf8(decoded) {
                                current_paths.push(path);
                            }
                        }
                    }
                }
            }

            // 如果当前菜单项与目标列表一致，则不需要更新
            if current_paths == items {
                info!("Menu items already up to date, skipping update");
                return Ok(());
            }

            info!("Current paths in menu: {:?}", current_paths);
            info!("Target paths: {:?}", items);

            // 从后向前移除所有菜单项（除了最后两个：分隔符和清除按钮）
            let mut remove_indices = Vec::new();
            for (idx, item) in current_items.iter().enumerate() {
                let id = item.id().as_ref();
                // 只移除最近项目项（以 recent_item_ 开头或 no_recent）
                if id.starts_with("recent_item_") || id == "no_recent" {
                    remove_indices.push(idx);
                }
            }

            info!("Indices to remove: {:?}", remove_indices);

            // 从后向前移除，避免索引变化
            for &idx in remove_indices.iter().rev() {
                info!("Removing menu item at index: {}", idx);
                let _ = open_recent_submenu.remove_at(idx);
            }

            // 如果没有最近项目，添加提示项
            if items.is_empty() {
                info!("Adding no_recent item");
                let no_recent = MenuItemBuilder::new(t("menu.no_recent"))
                    .id("no_recent")
                    .enabled(false)
                    .build(app_handle)?;
                // 插入到最前面
                open_recent_submenu.insert(&no_recent, 0)?;
            } else {
                // 添加新的最近项目菜单项
                info!("Adding {} recent items", items.len());
                for (index, item_path) in items.iter().take(5).enumerate() {
                    let display_path = format_path_for_display(item_path, 50);

                    let item_id = format!("recent_item_{}", BASE64.encode(item_path));
                    info!("Adding menu item: {} at index {}", item_id, index);
                    let menu_item = MenuItemBuilder::new(display_path.clone())
                        .id(&item_id)
                        .build(app_handle)?;
                    // 插入到指定位置
                    open_recent_submenu.insert(&menu_item, index)?;
                }
            }
        }
    }

    Ok(())
}

/// 更新"打开文件位置"菜单项的启用状态
#[cfg(desktop)]
#[command]
fn update_open_file_location_menu(
    enabled: bool,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    info!(
        "Updating open_file_location menu enabled state: {}",
        enabled
    );

    let Some(menu) = app_handle.menu() else {
        info!("No menu found");
        return Ok(());
    };

    // 获取文件菜单
    if let Some(file_menu_item) = menu.get("file") {
        if let Some(file_submenu) = file_menu_item.as_submenu() {
            // 获取"打开文件位置"菜单项
            if let Some(menu_item) = file_submenu.get("open_file_location") {
                if let Some(item) = menu_item.as_menuitem() {
                    if let Err(e) = item.set_enabled(enabled) {
                        error!("Failed to set open_file_location enabled state: {}", e);
                        return Err(format!("{:?}", e));
                    }
                    info!(
                        "Successfully set open_file_location enabled to: {}",
                        enabled
                    );
                }
            }
        }
    }

    Ok(())
}

/// 打开 App Store 升级页面
#[cfg(target_os = "macos")]
#[command]
fn open_app_store() {
    let url = "macappstore://apps.apple.com/cn/app/texto-markdown-%E7%BC%96%E8%BE%91%E5%99%A8/id6762083180?mt=12";
    std::process::Command::new("open").arg(url).spawn().ok();
}

/// 打开 App Store 升级页面（Windows）
#[cfg(target_os = "windows")]
#[command]
fn open_app_store() {
    let url = "ms-windows-store://pdp/?productid=9PM13WBD5SSC";
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", url])
        .spawn();
}

/// 打开 App Store 升级页面（其他平台 - 空操作）
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[command]
fn open_app_store() {
    // No app store available on this platform
}

/// 打开作者小红书主页（关注作者）
#[command]
fn open_follow_author(app: tauri::AppHandle) -> Result<(), String> {
    let url = "https://www.xiaohongshu.com/user/profile/695d161b000000000b039adb";
    if let Err(e) = app.opener().open_url(url, None::<&str>) {
        error!("Failed to open author profile: {}", e);
        return Err(format!("Failed to open author profile: {}", e));
    }
    Ok(())
}

/// 更新图片菜单项的启用状态（单文件模式下禁用）
#[cfg(desktop)]
#[command]
fn update_image_menu(enabled: bool, app_handle: tauri::AppHandle) -> Result<(), String> {
    info!("Updating image menu enabled state: {}", enabled);

    let Some(menu) = app_handle.menu() else {
        info!("No menu found");
        return Ok(());
    };

    if let Some(paragraph_menu_item) = menu.get("paragraph") {
        if let Some(paragraph_submenu) = paragraph_menu_item.as_submenu() {
            if let Some(menu_item) = paragraph_submenu.get("image") {
                if let Some(item) = menu_item.as_menuitem() {
                    if let Err(e) = item.set_enabled(enabled) {
                        error!("Failed to set image enabled state: {}", e);
                        return Err(format!("{:?}", e));
                    }
                    info!("Successfully set image enabled to: {}", enabled);
                }
            }
        }
    }

    Ok(())
}

/// 「导出」子菜单内静态导出项的 id（完整版）。
///
/// 注意：这几项位于文件菜单的嵌套子菜单 `export_submenu` 之下，而
/// `Menu::get` / `Submenu::get` 只做**非递归**查找（仅匹配直接子项），
/// 因此不能直接 `file_submenu.get("export_pdf")`，必须先取到 `export_submenu`。
#[cfg(all(not(feature = "free-version"), desktop))]
const EXPORT_MENU_IDS: &[&str] = &["export_html", "export_png", "export_pdf"];

/// TS → Rust 的菜单项声明（与前端 `src/app/menu/types.ts` 对齐，serde tag = kind）。
///
/// 枚举变体用 snake_case（item/check/separator/predefined），变体内字段用 camelCase
/// （`labelKey`/`acceleratorAction`）——需要 serde ≥ 1.0.180 的 `rename_all_fields`。
#[cfg(all(not(feature = "free-version"), desktop))]
#[derive(serde::Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum MenuItemSpec {
    Item {
        id: String,
        label_key: String,
        /// 前端已翻译好的文案（插件文案只在 WebView 的 i18next 里）。
        #[serde(default)]
        label: Option<String>,
        #[serde(default)]
        accelerator_action: Option<String>,
        #[serde(default)]
        enabled: Option<bool>,
    },
    Check {
        id: String,
        label_key: String,
        #[serde(default)]
        label: Option<String>,
        checked: bool,
        #[serde(default)]
        accelerator_action: Option<String>,
        #[serde(default)]
        enabled: Option<bool>,
    },
    Separator,
    Predefined {
        name: String,
    },
}

/// 一个子菜单的声明：目标 id + 标题 i18n key + 有序菜单项。
#[cfg(all(not(feature = "free-version"), desktop))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmenuSpec {
    id: String,
    /// C1 保留未用（子菜单标题沿用既有构建）；C2 迁移任意子菜单时启用。
    #[allow(dead_code)]
    label_key: String,
    items: Vec<MenuItemSpec>,
}

/// 对「导出」子菜单四项 + 文件菜单下的 `print_document` 逐项调用 `f`。
///
/// `update_export_menu` 与 `disable_window_dependent_menus` 共用此函数，保证
/// 「启停导出菜单」与「无文档时禁用」两处遍历的是同一组菜单项（否则无文档时
/// 导出四项仍然可点）。
///
/// **首个 `Err` 会立即中断遍历**，因此「尽力而为、不因单项失败而中断」的调用方
/// 需在闭包内自行吞错。
#[cfg(all(not(feature = "free-version"), desktop))]
fn for_each_export_menu_item<F>(
    menu: &tauri::menu::Menu<tauri::Wry>,
    mut f: F,
) -> Result<(), String>
where
    F: FnMut(&str, &MenuItem<tauri::Wry>) -> Result<(), String>,
{
    let Some(file_menu_item) = menu.get("file") else {
        return Ok(());
    };
    let Some(file_submenu) = file_menu_item.as_submenu() else {
        return Ok(());
    };

    if let Some(export_menu_item) = file_submenu.get("export_submenu") {
        if let Some(export_submenu) = export_menu_item.as_submenu() {
            for &item_id in EXPORT_MENU_IDS {
                if let Some(menu_item) = export_submenu.get(item_id) {
                    if let Some(item) = menu_item.as_menuitem() {
                        f(item_id, item)?;
                    }
                }
            }
        }
    }

    // 打印项仍在文件子菜单下（仅 macOS 构建，其他平台查不到即跳过）。
    if let Some(menu_item) = file_submenu.get("print_document") {
        if let Some(item) = menu_item.as_menuitem() {
            f("print_document", item)?;
        }
    }

    Ok(())
}

/// 递归按 id 查找子菜单（`Menu::get`/`Submenu::get` 只做非递归查找）。
#[cfg(all(not(feature = "free-version"), desktop))]
fn find_submenu(menu: &Menu<tauri::Wry>, id: &str) -> Option<Submenu<tauri::Wry>> {
    for item in menu.items().ok()? {
        if let tauri::menu::MenuItemKind::Submenu(sub) = item {
            if sub.id().as_ref() == id {
                return Some(sub);
            }
            if let Some(found) = find_submenu_in(&sub, id) {
                return Some(found);
            }
        }
    }
    None
}

#[cfg(all(not(feature = "free-version"), desktop))]
fn find_submenu_in(menu: &Submenu<tauri::Wry>, id: &str) -> Option<Submenu<tauri::Wry>> {
    for item in menu.items().ok()? {
        if let tauri::menu::MenuItemKind::Submenu(sub) = item {
            if sub.id().as_ref() == id {
                return Some(sub);
            }
            if let Some(found) = find_submenu_in(&sub, id) {
                return Some(found);
            }
        }
    }
    None
}

/// 按 TS 声明重建指定子菜单：清空现有项 → 依 `spec.items` 顺序追加。
///
/// 初始 `enabled` 缺省为 `false`：导出项的「有无文档」启用态随后由既有
/// `update_export_menu` 接管（前端按其调用顺序保证先同步、再置启用态）。
#[cfg(all(not(feature = "free-version"), desktop))]
#[command]
fn sync_submenu(spec: SubmenuSpec, app_handle: tauri::AppHandle) -> Result<(), String> {
    let Some(menu) = app_handle.menu() else {
        return Ok(());
    };
    let Some(submenu) = find_submenu(&menu, &spec.id) else {
        return Ok(());
    };

    // 清空现有项
    for item in submenu.items().map_err(|e| e.to_string())? {
        submenu.remove(&item).map_err(|e| e.to_string())?;
    }

    if spec.items.is_empty() {
        return Ok(());
    }

    let shortcuts = ShortcutsConfig::load(&app_handle);

    for item in spec.items {
        let kind = match item {
            MenuItemSpec::Item {
                id,
                label_key,
                label,
                accelerator_action,
                enabled,
            } => {
                let text = label.unwrap_or_else(|| i18n::translate(&label_key));
                let mut b = MenuItemBuilder::new(text).id(&id);
                if let Some(action) = accelerator_action {
                    if let Some(acc) = shortcuts.get_shortcut(&action) {
                        b = b.accelerator(to_tauri_accelerator(&acc));
                    }
                }
                b = b.enabled(enabled.unwrap_or(false));
                tauri::menu::MenuItemKind::MenuItem(
                    b.build(&app_handle).map_err(|e| e.to_string())?,
                )
            }
            MenuItemSpec::Check {
                id,
                label_key,
                label,
                checked,
                accelerator_action,
                enabled,
            } => {
                let text = label.unwrap_or_else(|| i18n::translate(&label_key));
                let mut b = CheckMenuItemBuilder::new(text)
                    .id(&id)
                    .checked(checked)
                    .enabled(enabled.unwrap_or(false));
                if let Some(action) = accelerator_action {
                    if let Some(acc) = shortcuts.get_shortcut(&action) {
                        b = b.accelerator(to_tauri_accelerator(&acc));
                    }
                }
                tauri::menu::MenuItemKind::Check(b.build(&app_handle).map_err(|e| e.to_string())?)
            }
            MenuItemSpec::Separator => tauri::menu::MenuItemKind::Predefined(
                PredefinedMenuItem::separator(&app_handle).map_err(|e| e.to_string())?,
            ),
            MenuItemSpec::Predefined { name } => {
                return Err(format!("C1 未支持 predefined 菜单项：{name}"));
            }
        };
        submenu.append(&kind).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 更新"导出/打印"菜单项的启用状态
#[cfg(all(not(feature = "free-version"), desktop))]
#[command]
fn update_export_menu(enabled: bool, app_handle: tauri::AppHandle) -> Result<(), String> {
    info!("Updating export menu enabled state: {}", enabled);

    let Some(menu) = app_handle.menu() else {
        info!("No menu found");
        return Ok(());
    };

    for_each_export_menu_item(&menu, |item_id, item| {
        // 原生 PNG 仅 macOS 实现：其他平台保持置灰，不随“有文档”启用。
        if item_id == "export_png" && !cfg!(target_os = "macos") {
            item.set_enabled(false).map_err(|e| {
                error!("Failed to keep {} disabled: {}", item_id, e);
                format!("{:?}", e)
            })?;
            return Ok(());
        }
        item.set_enabled(enabled).map_err(|e| {
            error!("Failed to set {} enabled state: {}", item_id, e);
            format!("{:?}", e)
        })?;
        info!("Successfully set {} enabled to: {}", item_id, enabled);
        Ok(())
    })
}

const PARAGRAPH_MENU_IDS: &[&str] = &[
    "heading_1",
    "heading_2",
    "heading_3",
    "heading_4",
    "heading_5",
    "heading_6",
    "bullet_list",
    "ordered_list",
    "task_list",
    "code_block",
    "math_block",
    "blockquote",
    "horizontal_rule",
    "table",
    "mermaid",
    "image",
];

/// 根据编辑器模式更新段落菜单项的启用状态
#[cfg(desktop)]
#[command]
fn update_paragraph_menu(enabled: bool, app_handle: tauri::AppHandle) -> Result<(), String> {
    info!("Updating paragraph menu enabled state: {}", enabled);

    let Some(menu) = app_handle.menu() else {
        info!("No menu found");
        return Ok(());
    };

    if let Some(paragraph_menu_item) = menu.get("paragraph") {
        if let Some(paragraph_submenu) = paragraph_menu_item.as_submenu() {
            for &item_id in PARAGRAPH_MENU_IDS {
                if let Some(menu_item) = paragraph_submenu.get(item_id) {
                    if let Some(item) = menu_item.as_menuitem() {
                        if let Err(e) = item.set_enabled(enabled) {
                            error!("Failed to set {} enabled state: {}", item_id, e);
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SaveImageResult {
    pub path: String,
    pub filename: String,
    pub relative_path: String,
}

/// 扩展 asset 协议 scope，允许从指定目录读取文件。
///
/// 通过书签/最近项目打开目录或文件时不经过系统对话框，dialog 插件的
/// `allow_directory`/`allow_file` 不会被调用，导致 `convertFileSrc` 加载
/// 图片时被 asset 协议 403 拦截。此命令在打开目录/文件后显式扩权。
fn extend_asset_scope_impl(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri::Manager;
    let scopes = app.state::<tauri::scope::Scopes>();
    let p = std::path::PathBuf::from(&path);
    // 沙盒下对“仅授权了单个文件”的父目录做 is_dir 可能返回 false，
    // 不能依赖它判断类型。直接放行文件本身 + 目录（或父目录）递归：
    // - 目录：递归放行目录自身
    // - 文件：递归放行父目录，覆盖同目录/子目录的资源引用
    let _ = scopes.allow_file(&p);
    let dir = if p.is_dir() {
        p
    } else {
        p.parent().map(|d| d.to_path_buf()).unwrap_or(p)
    };
    scopes
        .allow_directory(&dir, true)
        .map_err(|e| e.to_string())
}

/// 前端命令薄包装。
///
/// `#[command]` 会在定义处生成 `__cmd__*` 宏；放在子模块里再由 `generate_handler!`
/// 按完整路径解析，避免 crate 根出现同名宏（`extend_asset_scope` 曾被重复导出）。
pub mod asset_scope_command {
    #[tauri::command]
    pub fn extend_asset_scope(app: tauri::AppHandle, path: String) -> Result<(), String> {
        super::extend_asset_scope_impl(app, path)
    }
}

#[command]
async fn save_image(
    base64_data: String,
    filename: Option<String>,
    document_path: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<SaveImageResult, String> {
    info!("save_image called");

    // 加载配置
    let config = AppConfig::load(&app_handle);

    // 解码 base64 数据
    let image_data = BASE64.decode(&base64_data).map_err(|e| {
        error!("Failed to decode base64: {}", e);
        e.to_string()
    })?;
    info!("Base64 decoded, size: {} bytes", image_data.len());

    // 计算 MD5
    let md5_hash = format!("{:x}", md5::compute(&image_data));
    info!("MD5 hash: {}", md5_hash);

    // 获取原始文件扩展名并消毒：仅保留 ASCII 字母数字（最多 10 字符），
    // 防止文件名中的路径分隔符/相对路径片段经扩展名写入目标目录之外。
    let original_ext = sanitize_image_extension(filename.as_deref());
    info!("Original extension: {}", original_ext);

    // 生成文件名: {MD5}.{扩展名}
    let new_filename = format!("{}.{}.{}", &md5_hash[..8], &md5_hash[8..16], original_ext);
    info!("New filename: {}", new_filename);

    // 根据存储模式确定目标目录
    let images_dir = match config.image_storage_mode {
        ImageStorageMode::AlongsideDocument => {
            if let Some(ref doc_path) = document_path {
                let doc_dir = std::path::Path::new(doc_path)
                    .parent()
                    .ok_or("无法获取文档目录")?;
                doc_dir.join(&config.image_folder_name)
            } else {
                // 如果没有文档路径，回退到用户 Documents 目录
                let documents_dir = app_handle.path().document_dir().map_err(|e| {
                    error!("Failed to get documents dir: {}", e);
                    e.to_string()
                })?;
                documents_dir.join("Textox").join("images")
            }
        }
        ImageStorageMode::CustomPath => {
            if let Some(ref custom_path) = config.image_custom_path {
                std::path::PathBuf::from(custom_path)
            } else {
                // 如果没有设置自定义路径，回退到用户 Documents 目录
                let documents_dir = app_handle.path().document_dir().map_err(|e| {
                    error!("Failed to get documents dir: {}", e);
                    e.to_string()
                })?;
                documents_dir.join("Textox").join("images")
            }
        }
        ImageStorageMode::Picgo => {
            // PicGo 模式下也保存到文档同级目录作为本地缓存/fallback
            if let Some(ref doc_path) = document_path {
                let doc_dir = std::path::Path::new(doc_path)
                    .parent()
                    .ok_or("无法获取文档目录")?;
                doc_dir.join(&config.image_folder_name)
            } else {
                let documents_dir = app_handle.path().document_dir().map_err(|e| {
                    error!("Failed to get documents dir: {}", e);
                    e.to_string()
                })?;
                documents_dir.join("Textox").join("images")
            }
        }
    };

    // 根据聚合模式确定子目录
    let images_dir = match config.image_aggregation_mode {
        ImageAggregationMode::None => images_dir,
        ImageAggregationMode::ByDocumentName => {
            if let Some(ref doc_path) = document_path {
                // 获取文档文件名（不含扩展名）
                let doc_name = std::path::Path::new(doc_path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("untitled");
                images_dir.join(doc_name)
            } else {
                images_dir.join("untitled")
            }
        }
        ImageAggregationMode::ByDate => {
            // 获取当前日期
            let now = chrono::Local::now();
            let date_folder = match config.image_date_format.as_str() {
                "YYYY" => now.format("%Y").to_string(),
                "YYYY-MM" => now.format("%Y-%m").to_string(),
                "YYYY-MM-DD" => now.format("%Y-%m-%d").to_string(),
                _ => now.format("%Y-%m").to_string(),
            };
            images_dir.join(date_folder)
        }
    };

    info!("Images dir (with aggregation): {:?}", images_dir);

    if !images_dir.exists() {
        info!("Creating images directory");
        tokio::fs::create_dir_all(&images_dir).await.map_err(|e| {
            error!("Failed to create images dir: {}", e);
            e.to_string()
        })?;
    }

    let file_path = images_dir.join(&new_filename);
    info!("File path: {:?}", file_path);

    // 写入文件
    tokio::fs::write(&file_path, image_data)
        .await
        .map_err(|e| {
            error!("Failed to write file: {}", e);
            e.to_string()
        })?;
    info!("File written successfully");

    // 计算相对路径
    let has_doc_path = document_path.is_some();
    let relative_path = match config.image_storage_mode {
        ImageStorageMode::AlongsideDocument | ImageStorageMode::Picgo => {
            if has_doc_path {
                let aggregation_subdir = match config.image_aggregation_mode {
                    ImageAggregationMode::None => String::new(),
                    ImageAggregationMode::ByDocumentName => {
                        if let Some(ref doc_path) = document_path {
                            let doc_name = std::path::Path::new(doc_path)
                                .file_stem()
                                .and_then(|s| s.to_str())
                                .unwrap_or("untitled");
                            format!("/{}", doc_name)
                        } else {
                            "/untitled".to_string()
                        }
                    }
                    ImageAggregationMode::ByDate => {
                        let now = chrono::Local::now();
                        let date_folder = match config.image_date_format.as_str() {
                            "YYYY" => now.format("%Y").to_string(),
                            "YYYY-MM" => now.format("%Y-%m").to_string(),
                            "YYYY-MM-DD" => now.format("%Y-%m-%d").to_string(),
                            _ => now.format("%Y-%m").to_string(),
                        };
                        format!("/{}", date_folder)
                    }
                };
                format!(
                    "{}{}/{}",
                    config.image_folder_name, aggregation_subdir, new_filename
                )
            } else {
                file_path.to_string_lossy().to_string()
            }
        }
        ImageStorageMode::CustomPath => file_path.to_string_lossy().to_string(),
    };

    let result = SaveImageResult {
        path: file_path.to_string_lossy().to_string(),
        filename: new_filename,
        relative_path,
    };
    info!("Returning result: {:?}", result);

    // 书签/最近打开目录时 dialog 插件不会扩权 asset 协议 scope，
    // 这里显式允许图片所在目录，否则 convertFileSrc 加载图片会 403。
    {
        use tauri::Manager;
        let scopes = app_handle.state::<tauri::scope::Scopes>();
        if let Err(e) = scopes.allow_directory(&images_dir, true) {
            error!(
                "Failed to extend asset scope for images dir {}: {}",
                images_dir.display(),
                e
            );
        }
    }

    Ok(result)
}

/// 消毒图片文件扩展名：仅保留 ASCII 字母数字（最多 10 字符），
/// 空结果回退为 "png"。防止恶意文件名把 `/`、`..` 等路径片段带进
/// 生成的目标文件名，造成目录穿越。
fn sanitize_image_extension(filename: Option<&str>) -> String {
    filename
        .and_then(|f| f.rsplit('.').next())
        .map(|ext| {
            ext.chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .take(10)
                .collect::<String>()
        })
        .filter(|ext| !ext.is_empty())
        .unwrap_or_else(|| "png".to_string())
}

fn image_mime_type(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    }
}

#[command]
async fn read_image_as_data_url(path: String) -> Result<String, String> {
    let image_data = tokio::fs::read(&path).await.map_err(|e| {
        error!("Failed to read image file: {}", e);
        format!("Failed to read image file: {}", e)
    })?;

    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let mime = image_mime_type(ext);

    let b64 = BASE64.encode(&image_data);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[command]
async fn open_privacy_policy(app: tauri::AppHandle) -> Result<(), String> {
    // 尝试多个可能的路径
    let possible_paths = vec![
        // 开发模式：项目根目录下的 public 文件夹
        std::env::current_dir()
            .ok()
            .map(|d| d.join("public/privacy.html")),
        // 生产模式：应用资源目录
        app.path()
            .resolve("public/privacy.html", tauri::path::BaseDirectory::Resource)
            .ok(),
        // 相对于可执行文件的路径
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|p| p.join("public/privacy.html"))),
    ];

    let mut found_path = None;
    for path in possible_paths.into_iter().flatten() {
        if path.exists() {
            found_path = Some(path);
            break;
        }
    }

    if let Some(path) = found_path {
        let path_str = path.to_string_lossy().to_string();
        info!("Opening privacy policy: {}", path_str);

        // 使用 opener 插件打开文件
        if let Err(e) = app.opener().open_path(&path_str, None::<&str>) {
            error!("Failed to open privacy policy: {}", e);
            return Err(format!("Failed to open privacy policy: {}", e));
        }
        Ok(())
    } else {
        error!("Privacy policy file not found in any location");
        Err("Privacy policy file not found".to_string())
    }
}

/// 禁用所有依赖窗口的菜单项（无窗口时调用）
#[cfg(desktop)]
pub fn disable_window_dependent_menus(app_handle: &tauri::AppHandle) {
    let Some(menu) = app_handle.menu() else {
        return;
    };

    // 段落菜单 - 全部禁用
    if let Some(paragraph_menu_item) = menu.get("paragraph") {
        if let Some(paragraph_submenu) = paragraph_menu_item.as_submenu() {
            for &item_id in PARAGRAPH_MENU_IDS {
                if let Some(menu_item) = paragraph_submenu.get(item_id) {
                    if let Some(item) = menu_item.as_menuitem() {
                        let _ = item.set_enabled(false);
                    }
                }
            }
        }
    }

    // 文件菜单项
    if let Some(file_menu_item) = menu.get("file") {
        if let Some(file_submenu) = file_menu_item.as_submenu() {
            if let Some(menu_item) = file_submenu.get("save_file") {
                if let Some(item) = menu_item.as_menuitem() {
                    let _ = item.set_enabled(false);
                }
            }
            if let Some(menu_item) = file_submenu.get("open_file_location") {
                if let Some(item) = menu_item.as_menuitem() {
                    let _ = item.set_enabled(false);
                }
            }
        }
    }

    // 导出/打印菜单项（完整版）：导出四项在嵌套的 export_submenu 下，
    // 与 update_export_menu 共用同一遍历，避免漏掉 html/epub/png。
    // 此项是「尽力而为」：单项失败只记日志，不中断其余项。
    #[cfg(not(feature = "free-version"))]
    let _ = for_each_export_menu_item(&menu, |item_id, item| {
        if let Err(e) = item.set_enabled(false) {
            error!("Failed to disable {} menu item: {:?}", item_id, e);
        }
        Ok(())
    });

    // 视图菜单
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
                        let _ = item.set_enabled(false);
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
                        let _ = item.set_enabled(false);
                    }
                }
            }
        }
    }

}

#[command]
fn create_bookmark(path: String, app: tauri::AppHandle) -> Result<(), String> {
    let bm = app.state::<bookmark_manager::BookmarkManager>();
    bm.create(&path)?;
    // 新授权的目录立即启动沙盒访问并扩权（此前由前端调用方负责，统一收归后端）
    if std::path::Path::new(&path).is_dir() {
        if let Err(e) = bm.start_access(&path) {
            log::warn!("Failed to start access for new directory bookmark: {}", e);
        }
        let _ = extend_asset_scope_impl(app, path);
    }
    Ok(())
}

#[command]
fn has_bookmark(path: String, app: tauri::AppHandle) -> bool {
    let bm = app.state::<bookmark_manager::BookmarkManager>();
    bm.has(&path)
}

#[command]
fn start_access(path: String, app: tauri::AppHandle) -> Result<(), String> {
    let bm = app.state::<bookmark_manager::BookmarkManager>();
    bm.start_access(&path)
}

#[command]
fn list_bookmarks(app: tauri::AppHandle) -> Vec<bookmark_manager::BookmarkInfo> {
    let bm = app.state::<bookmark_manager::BookmarkManager>();
    bm.list()
}

/// 目录书签数量不超过上限时，全量启动沙盒访问并扩展 asset scope。
/// 应用启动时调用，打开文档后跨授权目录的图片可直接加载，
/// 无需前端按文档图片地址逐个匹配书签。
fn ensure_directory_bookmark_access(app: &tauri::AppHandle) {
    let Some(bm) = app.try_state::<bookmark_manager::BookmarkManager>() else {
        return;
    };
    let dirs = bm.directory_bookmark_paths();
    if dirs.len() > bookmark_manager::MAX_DIRECTORY_BOOKMARKS {
        return;
    }
    for dir in dirs {
        let path = dir.to_string_lossy().to_string();
        if let Err(e) = bm.start_access(&path) {
            log::warn!(
                "Failed to start access for directory bookmark {}: {}",
                path,
                e
            );
        }
        // 图片要能被 asset 协议读取，目录还必须在 asset scope 内
        if let Err(e) = extend_asset_scope_impl(app.clone(), path) {
            log::warn!("Failed to extend asset scope for directory bookmark: {}", e);
        }
    }
}

#[command]
fn clear_bookmarks(paths: Vec<String>, app: tauri::AppHandle) -> Result<(), String> {
    let bm = app.state::<bookmark_manager::BookmarkManager>();
    bm.revoke_all(&paths);
    Ok(())
}

/// 向编辑器窗口发送菜单事件。如果不是编辑器窗口则跳过。
/// 返回是否成功发送到窗口。
#[cfg(desktop)]
fn emit_menu_event(app: &tauri::AppHandle, window_label: &Option<String>, event: &str) -> bool {
    if let Some(label) = window_label {
        if crate::window_manager::is_editor_label(label) {
            let _ = app.emit_to(label, "menu-event", event);
            return true;
        }
    }
    false
}

/// 崩溃上报 DSN 只来自编译期环境变量 `SENTRY_DSN`。
/// 仓库不内置 DSN：从源码自行构建的版本不上报任何数据；官方构建在打包时设置该变量。
/// Sentry DSN 是公开的客户端标识（非密钥），可以安全地编译进应用。
///
/// 初始化 Sentry 原生错误上报（panic / 手动 capture）。
/// 返回的 guard 需由调用方持有到进程退出，保证退出前待发送事件完成；
/// DSN 为空时返回 None，应用完全不受影响。
pub fn init_sentry() -> Option<sentry::ClientInitGuard> {
    let dsn = option_env!("SENTRY_DSN").unwrap_or("");
    if dsn.trim().is_empty() {
        return None;
    }
    let edition = if cfg!(feature = "free-version") {
        "texto-lite"
    } else {
        "texto"
    };
    let release = format!("{}@{}", edition, env!("CARGO_PKG_VERSION"));
    let environment = if cfg!(debug_assertions) {
        "development"
    } else {
        "production"
    };
    let mut options = sentry::ClientOptions::default();
    options.release = Some(release.into());
    options.environment = Some(environment.into());
    Some(sentry::init((dsn, options)))
}

pub fn run_app() -> tauri::Result<tauri::App> {
    let mut builder = tauri::Builder::default();

    // 单实例插件仅桌面端支持（iOS/Android 由系统管理前台单实例）
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for arg in argv {
                let is_dir = std::path::Path::new(&arg).is_dir();
                let is_file = arg.ends_with(".md")
                    || arg.ends_with(".markdown")
                    || arg.ends_with(".mdown")
                    || arg.ends_with(".mkd");
                if is_dir || is_file {
                    info!(
                        "Second instance opening {}",
                        if is_dir { "directory" } else { "file" }
                    );
                    let app_handle = app.clone();
                    let path = arg.clone();
                    tauri::async_runtime::spawn(async move {
                        let result = if is_dir {
                            WINDOW_MANAGER.create_window(&app_handle, None, None, Some(path))
                        } else {
                            WINDOW_MANAGER.create_window(&app_handle, None, Some(path), None)
                        };
                        if let Err(e) = result {
                            error!("Failed to create window for second instance path: {}", e);
                        }
                    });
                }
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("Textox".to_string()),
                    },
                ))
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Error
                })
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .on_window_event(|_window, _event| {
            if matches!(_event, tauri::WindowEvent::Focused(true)) {
                // MCP 在多个窗口间挑选默认目标时，用它做「最近聚焦」回退。
                mcp::note_focused_window(_window.label());
            }
            #[cfg(target_os = "macos")]
            {
                // 窗口获得焦点时重新禁用系统注入的窗口菜单项（macOS 可能动态改回启用状态）
                if matches!(_event, tauri::WindowEvent::Focused(true)) {
                    macos_menu::disable_system_window_menu_items(&crate::i18n::translate(
                        "menu.window",
                    ));
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            read_directory,
            read_subdirectory,
            get_file_tag_colors,
            set_file_tag_color,
            search_files,
            read_file,
            get_file_metadata,
            compare_file_content,
            write_file,
            create_file,
            create_folder,
            path_exists,
            delete_file,
            delete_folder,
            rename_file,
            check_path_type,
            list_bookmarks,
            clear_bookmarks,
            create_bookmark,
            start_access,
            get_temp_dir,
            save_pdf_file,
            save_binary_file,
            download_remote_file,
            save_recent_items,
            save_image,
            read_image_as_data_url,
            asset_scope_command::extend_asset_scope,
            get_config,
            get_mcp_status,
            get_default_config,
            get_app_version,
            set_config,
            get_plugin_config,
            get_plugin_configs,
            set_plugin_config,
            set_theme_bg,
            get_shortcuts_config,
            set_shortcuts_config,
            #[cfg(desktop)]
            sync_appearance_menu,
            #[cfg(desktop)]
            sync_view_menu,
            #[cfg(desktop)]
            sync_theme_menu,
            #[cfg(desktop)]
            update_open_file_location_menu,
            open_app_store,
            open_follow_author,
            store_review::request_app_review,
            store_review::open_app_review_page,
            #[cfg(all(not(feature = "free-version"), desktop))]
            update_export_menu,
            #[cfg(desktop)]
            update_paragraph_menu,
            #[cfg(desktop)]
            update_image_menu,
            window_manager::create_new_window,
            window_manager::get_window_info_command,
            window_manager::update_window_file,
            window_manager::update_window_folder,
            window_manager::clear_launch_workspace_flag,
            window_manager::update_window_mode,
            window_manager::update_window_sidebar_collapsed,
            window_manager::update_window_sidebar_view,
            window_manager::get_all_windows,
            window_manager::create_settings_window,
            window_manager::create_acknowledgments_window,
            window_manager::create_privacy_window,
            window_manager::create_onboarding_window,
            store_region::get_store_region,
            window_manager::window_ready,
            window_manager::take_pending_recent_item,
            window_manager::unregister_window,
            window_manager::cancel_quit,
            window_manager::show_titlebar_menu,
            open_privacy_policy,
            temp_files::list_temp_files,
            temp_files::create_temp_file,
            temp_files::delete_temp_file,
            temp_files::read_temp_file,
            temp_files::is_temp_path,
            document::open_document,
            temp_files::cleanup_temp_files,
            pending_file::check_pending_open_file,
            file_watcher::start_watching,
            file_watcher::stop_watching,
            file_watcher::get_watcher_stats,
            has_bookmark,
            is_icloud_file,
            fonts::get_system_fonts_command,
            theme_manager::list_themes,
            theme_manager::load_user_theme_css,
            theme_manager::delete_theme,
            #[cfg(not(feature = "free-version"))]
            theme_manager::import_commands::import_theme,
            #[cfg(not(feature = "free-version"))]
            theme_manager::import_commands::import_theme_files,
            #[cfg(not(feature = "free-version"))]
            theme_manager::import_commands::import_with_overwrite,
            #[cfg(not(feature = "free-version"))]
            theme_manager::import_commands::convert_theme,
            #[cfg(not(feature = "free-version"))]
            theme_manager::import_commands::preview_import,
            #[cfg(not(feature = "free-version"))]
            theme_manager::preview_theme_css,
            theme_manager::save_theme_css,
            theme_manager::get_theme_quick_settings,
            theme_manager::set_theme_quick_settings,
            #[cfg(not(feature = "free-version"))]
            theme_manager::export_theme,
            #[cfg(target_os = "macos")]
            export_pdf,
            #[cfg(target_os = "macos")]
            png_export::export_png,
            #[cfg(target_os = "macos")]
            print_webview,
            native_dialog::confirm_delete,
            #[cfg(target_os = "macos")]
            native_dialog::pick_pdf_save_path,
            #[cfg(target_os = "macos")]
            native_dialog::pick_export_save_path,
            #[cfg(all(not(feature = "free-version"), desktop))]
            sync_submenu,
            i18n::import_translation_file,
            i18n::read_custom_translation,
            i18n::clear_custom_translations,
            i18n::list_custom_translations,
            i18n::remove_custom_translation,
            plugins::scan::plugin_scan,
            plugins::scan::plugin_get_state,
            plugins::scan::plugin_set_enabled,
            plugins::scan::plugin_set_safe_mode,
            plugins::assets::plugin_read_asset,
            plugins::assets::plugin_asset_path,
            plugins::data::plugin_read_data,
            plugins::data::plugin_write_data,
            plugins::install::plugin_install_from_file,
            plugins::install::plugin_install_from_url,
            plugins::install::plugin_uninstall,
            plugins::seed::plugin_seed_bundled,
            plugins::seed::plugin_restore_builtin,
        ])
        .setup(|app| {
            // 注册安全作用域书签管理器
            let bookmark_manager = bookmark_manager::BookmarkManager::new(app.handle());
            // 启动时恢复全部书签的沙盒访问权限，避免“打开方式”等
            // 不经过对话框的路径重启后读不到文件/图片
            bookmark_manager.start_all();
            app.manage(bookmark_manager);
            // 目录书签数量不多时全量启动访问并扩展 asset scope
            ensure_directory_bookmark_access(app.handle());

            // 加载应用配置和快捷键配置
            let app_config = AppConfig::load(app);
            // MCP 服务端按设置里的开关启停（默认关闭；只监听 127.0.0.1）
            mcp::apply(app.handle(), app_config.mcp_enabled);
            let shortcuts_config = ShortcutsConfig::load(app);

            // 注册主窗口并根据配置设置大小
            WINDOW_MANAGER.register_main_window("main");

            // 获取或创建主窗口（config 中已移除窗口定义，需要在 Rust 中创建）
            let window_width = app_config.window_width.max(1.0);
            let window_height = app_config.window_height.max(1.0);
            let _main_window = match app.get_webview_window("main") {
                Some(window) => window,
                None => {
                    #[cfg(desktop)]
                    let builder =
                        WebviewWindowBuilder::new(app, "main", WebviewUrl::App("/".into()))
                            .title("Textox")
                            .inner_size(window_width, window_height)
                            .visible(false);

                    #[cfg(not(desktop))]
                    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("/".into()))
                        .title("Textox")
                        .visible(false);

                    #[cfg(desktop)]
                    let builder = builder.center();

                    // 显式设置 devtools：tauri 在编译进 devtools feature 时，未显式指定
                    // 的窗口默认 devtools=true（tauri-runtime-wry unwrap_or(true)），
                    // 因此 release 也必须显式关掉，否则原生右键 Inspect Element 会出现。
                    let builder = builder.devtools(devtools_enabled());

                    #[cfg(target_os = "macos")]
                    let builder = {
                        let bg = window_manager::get_bg_color(app);
                        builder
                            .title_bar_style(tauri::TitleBarStyle::Overlay)
                            .hidden_title(true)
                            .background_color(bg)
                    };

                    #[cfg(target_os = "windows")]
                    let builder = {
                        let bg = window_manager::get_bg_color(app);
                        builder.decorations(false).background_color(bg)
                    };

                    builder
                        .build()
                        .map_err(|e| format!("Failed to create main window: {}", e))?;
                    app.get_webview_window("main")
                        .ok_or_else(|| "Failed to get main window after creation".to_string())?
                }
            };

            // 启动注入：配置了默认工作区时，主窗口直接进入工作区模式
            let workspace_folder = if app_config.startup_behavior == StartupBehavior::Workspace {
                app_config.workspace_folder.clone()
            } else {
                None
            };
            if let Some(ref folder) = workspace_folder {
                window_manager::WINDOW_MANAGER.patch_window_info("main", |info| {
                    info.opened_folder = Some(folder.clone());
                    info.is_single_file_mode = false;
                    info.is_launch_workspace = true;
                });
                window_manager::store_pending_file_for_window("main", folder);
            }

            // 同步主窗口原生标题（macOS 窗口列表/Dock 菜单只收录有标题的窗口）
            if let Some(main_window) = app.get_webview_window("main") {
                if let Some(title) =
                    window_manager::WINDOW_MANAGER.get_window_title(app.handle(), "main")
                {
                    let _ = main_window.set_title(&title);
                }
            }

            // 获取当前语言
            let lang = app_config.language.as_str();
            info!("加载应用配置，当前语言: {}", lang);

            // 初始化翻译器
            i18n::I18n::new(lang);

            // 辅助函数：获取快捷键（将 Cmd 转换为 Command/Ctrl 以兼容 Tauri）
            let get_accelerator = |action_id: &str| -> Option<String> {
                shortcuts_config
                    .get_shortcut(action_id)
                    .map(|s| to_tauri_accelerator(&s))
            };

            // 翻译函数
            let t = |key: &str| -> String { i18n::translate(key) };

            // ==================== 桌面端菜单（iOS/Android 无系统菜单栏，整块不编译） ====================
            #[cfg(desktop)]
            {
                // 创建菜单
                let new_window = MenuItemBuilder::new(t("menu.new_window"))
                    .id("new_window")
                    .accelerator(
                        get_accelerator("new_window")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+N")),
                    )
                    .build(app)?;

                let open_file = MenuItemBuilder::new(t("menu.open"))
                    .id("open_file")
                    .accelerator(
                        get_accelerator("open_file")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+O")),
                    )
                    .build(app)?;

                let open_folder = MenuItemBuilder::new(t("menu.open_folder"))
                    .id("open_folder")
                    .accelerator(
                        get_accelerator("open_folder")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+Shift+O")),
                    )
                    .build(app)?;

                let save_file = MenuItemBuilder::new(t("menu.save"))
                    .id("save_file")
                    .accelerator(
                        get_accelerator("save_file")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+S")),
                    )
                    .build(app)?;

                let open_file_location = MenuItemBuilder::new(t("menu.open_location"))
                    .id("open_file_location")
                    .accelerator(
                        get_accelerator("open_file_location")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+Shift+L")),
                    )
                    .build(app)?;

                let import_translations = MenuItemBuilder::new(t("menu.import_translations"))
                    .id("import_translations")
                    .build(app)?;

                #[cfg(not(feature = "free-version"))]
                let export_png = MenuItemBuilder::new(t("menu.export_png"))
                    .id("export_png")
                    .enabled(false)
                    .build(app)?;
                #[cfg(not(feature = "free-version"))]
                let export = MenuItemBuilder::new(t("menu.export_pdf"))
                    .id("export_pdf")
                    .accelerator(
                        get_accelerator("export_pdf")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+Shift+S")),
                    )
                    .enabled(false)
                    .build(app)?;
                #[cfg(not(feature = "free-version"))]
                let export_submenu = SubmenuBuilder::new(app, t("menu.export"))
                    .id("export_submenu")
                    .items(&[&export_png, &export])
                    .build()?;

                #[cfg(all(not(feature = "free-version"), target_os = "macos"))]
                let print_document = MenuItemBuilder::new(t("menu.print"))
                    .id("print_document")
                    .accelerator(
                        get_accelerator("print_document")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+Shift+P")),
                    )
                    .enabled(false)
                    .build(app)?;

                let separator = PredefinedMenuItem::separator(app)?;

                let toggle_sidebar = CheckMenuItemBuilder::new(t("menu.toggle_sidebar"))
                    .id("toggle_sidebar")
                    .accelerator(
                        get_accelerator("toggle_sidebar")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+T")),
                    )
                    .build(app)?;

                let toggle_edit_mode = CheckMenuItemBuilder::new(t("menu.toggle_edit_mode"))
                    .id("toggle_edit_mode")
                    .accelerator(
                        get_accelerator("toggle_edit_mode")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+/")),
                    )
                    .build(app)?;

                // 创建最近项目的子菜单项（最多10个）
                let recent_items_separator = PredefinedMenuItem::separator(app)?;
                let clear_recent = MenuItemBuilder::new(t("menu.clear_recent"))
                    .id("clear_recent")
                    .build(app)?;

                // 从 store 读取最近项目
                let recent_items: Vec<String> = RecentFilesStore::load(app);

                // 创建最近项目子菜单（在当前窗口打开）
                let mut recent_submenu_builder =
                    SubmenuBuilder::new(app, t("menu.open_recent")).id("open_recent");

                // 创建最近项目子菜单（在新窗口打开）- 当前未使用但保留
                #[allow(unused_variables, unused_assignments)]
                let mut recent_new_window_submenu_builder =
                    SubmenuBuilder::new(app, "在新窗口中打开");

                // 添加最近项目菜单项
                for item in recent_items.iter().take(5) {
                    let display_path = format_path_for_display(item, 50);

                    let item_id = format!("recent_item_{}", BASE64.encode(item));
                    #[allow(unused_variables)]
                    let item_id_new_window =
                        format!("recent_item_new_window_{}", BASE64.encode(item));

                    // 当前窗口打开的菜单项
                    let menu_item = MenuItemBuilder::new(display_path.clone())
                        .id(item_id)
                        .build(app)?;
                    recent_submenu_builder = recent_submenu_builder.item(&menu_item);

                    // 新窗口打开的菜单项 - 当前未使用但保留
                    #[allow(unused_variables)]
                    let new_window_item = MenuItemBuilder::new(display_path.clone())
                        .id(item_id_new_window)
                        .build(app)?;
                    recent_new_window_submenu_builder =
                        recent_new_window_submenu_builder.item(&new_window_item);
                }

                // 如果没有最近项目，添加提示项
                #[allow(unused_assignments)]
                if recent_items.is_empty() {
                    let no_recent = MenuItemBuilder::new(t("menu.no_recent"))
                        .id("no_recent")
                        .enabled(false)
                        .build(app)?;
                    recent_submenu_builder = recent_submenu_builder.item(&no_recent);

                    let no_recent_new_window = MenuItemBuilder::new(t("menu.no_recent"))
                        .id("no_recent_new_window")
                        .enabled(false)
                        .build(app)?;
                    recent_new_window_submenu_builder =
                        recent_new_window_submenu_builder.item(&no_recent_new_window);
                }

                let open_recent = recent_submenu_builder
                    .item(&recent_items_separator)
                    .item(&clear_recent)
                    .build()?;

                // 打开设置页面
                let open_settings = MenuItemBuilder::new(t("menu.preferences"))
                    .id("open_settings")
                    .accelerator(to_tauri_accelerator("Cmd,"))
                    .build(app)?;

                // 关于（使用系统原生关于面板/对话框）
                let product_name = app
                    .config()
                    .product_name
                    .clone()
                    .unwrap_or_else(|| "Textox".to_string());
                let about_metadata = AboutMetadata {
                    name: Some(product_name),
                    version: Some(app.package_info().version.to_string()),
                    copyright: Some("Copyright © 2024-2026 Textox".to_string()),
                    icon: app.default_window_icon().cloned(),
                    ..Default::default()
                };
                let about =
                    PredefinedMenuItem::about(app, Some(&t("menu.about")), Some(about_metadata))?;

                // 退出
                let quit_item = MenuItemBuilder::new(t("menu.quit"))
                    .id("quit_app")
                    .accelerator(if cfg!(target_os = "macos") {
                        "Command+Q"
                    } else {
                        "Ctrl+Q"
                    })
                    .build(app)?;

                // Textox 菜单
                let mut texto_menu_builder = SubmenuBuilder::new(app, t("menu.texto"))
                    .item(&about)
                    .item(&PredefinedMenuItem::separator(app)?)
                    .item(&open_settings)
                    .item(&PredefinedMenuItem::separator(app)?);
                // 系统"服务"子菜单（macOS 专属，由系统自动填充其他 app 提供的服务）
                #[cfg(target_os = "macos")]
                {
                    let services = PredefinedMenuItem::services(app, Some(&t("menu.services")))?;
                    texto_menu_builder = texto_menu_builder
                        .item(&services)
                        .item(&PredefinedMenuItem::separator(app)?);
                }
                let texto_menu = texto_menu_builder.item(&quit_item).build()?;

                // 文件菜单
                let mut file_menu_builder = SubmenuBuilder::new(app, t("menu.file"))
                    .id("file")
                    .item(&new_window)
                    .item(&separator)
                    .item(&open_file)
                    .item(&open_folder)
                    .item(&open_recent)
                    // .item(&open_recent_new_window)
                    .item(&PredefinedMenuItem::separator(app)?)
                    .item(&save_file)
                    .item(&open_file_location)
                    .item(&import_translations)
                    .item(&PredefinedMenuItem::separator(app)?);
                #[cfg(not(feature = "free-version"))]
                {
                    file_menu_builder = file_menu_builder.item(&export_submenu);
                }
                // 原生打印仅 macOS 支持，菜单项也只在 macOS 添加
                #[cfg(all(not(feature = "free-version"), target_os = "macos"))]
                {
                    file_menu_builder = file_menu_builder.item(&print_document);
                }
                let file_menu = file_menu_builder.build()?;

                // 打字机/工具栏开关是全局持久化配置，直接按当前配置初始化勾选态
                let view_config = AppConfig::load(app);
                let toggle_typewriter_mode =
                    CheckMenuItemBuilder::new(t("menu.toggle_typewriter_mode"))
                        .id("toggle_typewriter_mode")
                        .checked(view_config.typewriter_enabled)
                        .accelerator(
                            get_accelerator("toggle_typewriter_mode")
                                .unwrap_or_else(|| to_tauri_accelerator("Cmd+Shift+T")),
                        )
                        .build(app)?;

                let toggle_readable_line_length =
                    CheckMenuItemBuilder::new(t("menu.toggle_readable_line_length"))
                        .id("toggle_readable_line_length")
                        .checked(view_config.editor_readable_line_length)
                        .build(app)?;

                let toggle_editor_toolbar =
                    CheckMenuItemBuilder::new(t("menu.toggle_editor_toolbar"))
                        .id("toggle_editor_toolbar")
                        .checked(view_config.show_editor_toolbar)
                        .build(app)?;

                let toggle_inline_format_toolbar =
                    CheckMenuItemBuilder::new(t("menu.toggle_inline_format_toolbar"))
                        .id("toggle_inline_format_toolbar")
                        .checked(view_config.show_inline_format_toolbar)
                        .build(app)?;

                // 大纲样式（radio 选择器：关闭 / 文字 / 迷你地图）
                let outline_style_off =
                    CheckMenuItemBuilder::new(t("menu.outline_style_off"))
                        .id("outline_style_off")
                        .checked(view_config.outline_style == "off")
                        .build(app)?;
                let outline_style_text =
                    CheckMenuItemBuilder::new(t("menu.outline_style_text"))
                        .id("outline_style_text")
                        .checked(view_config.outline_style == "text")
                        .build(app)?;
                let outline_style_minimap =
                    CheckMenuItemBuilder::new(t("menu.outline_style_minimap"))
                        .id("outline_style_minimap")
                        .checked(view_config.outline_style == "minimap")
                        .build(app)?;

                let outline_style_menu = SubmenuBuilder::new(app, t("menu.outline_style"))
                    .id("outline_style")
                    .item(&outline_style_off)
                    .item(&outline_style_text)
                    .item(&outline_style_minimap)
                    .build()?;

                // 视图菜单
                let view_menu = SubmenuBuilder::new(app, t("menu.view"))
                    .id("view")
                    .item(&toggle_sidebar)
                    .item(&toggle_edit_mode)
                    .item(&toggle_typewriter_mode)
                    .item(&toggle_readable_line_length)
                    .item(&toggle_editor_toolbar)
                    .item(&toggle_inline_format_toolbar)
                    .item(&outline_style_menu)
                    .build()?;

                // 外观菜单（使用 CheckMenuItem 以显示选中态）
                let config = AppConfig::load(app);
                let current_appearance = config.appearance;
                let appearance_light = CheckMenuItemBuilder::new(t("menu.appearance_light"))
                    .id("appearance_light")
                    .checked(current_appearance == "light")
                    .build(app)?;
                let appearance_dark = CheckMenuItemBuilder::new(t("menu.appearance_dark"))
                    .id("appearance_dark")
                    .checked(current_appearance == "dark")
                    .build(app)?;
                let appearance_system = CheckMenuItemBuilder::new(t("menu.appearance_system"))
                    .id("appearance_system")
                    .checked(current_appearance == "system" || current_appearance.is_empty())
                    .build(app)?;

                // 内置主题（使用 CheckMenuItem 显示选中态）
                let current_theme = AppConfig::load(app).color_theme;
                let theme_default = CheckMenuItemBuilder::new(t("menu.theme_default"))
                    .id("theme_default")
                    .checked(current_theme == "default")
                    .build(app)?;
                let theme_pastel = CheckMenuItemBuilder::new(t("menu.theme_pastel"))
                    .id("theme_pastel")
                    .checked(current_theme == "pastel")
                    .build(app)?;
                let theme_spring = CheckMenuItemBuilder::new(t("menu.theme_spring"))
                    .id("theme_spring")
                    .checked(current_theme == "spring")
                    .build(app)?;

                // 自定义主题子菜单（动态加载用户导入的主题）
                let user_themes = theme_manager::list_themes(app.handle().clone())
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|t| !t.is_builtin)
                    .collect::<Vec<_>>();

                let mut user_theme_items: HashMap<String, CheckMenuItem<tauri::Wry>> =
                    HashMap::new();
                let mut custom_builder = SubmenuBuilder::new(app, t("menu.theme_user_imported"))
                    .id("theme_user_imported");

                if user_themes.is_empty() {
                    let placeholder = MenuItemBuilder::new(t("menu.no_imported_themes"))
                        .id("no_imported_themes")
                        .enabled(false)
                        .build(app)?;
                    custom_builder = custom_builder.item(&placeholder);
                } else {
                    for theme in &user_themes {
                        let item = CheckMenuItemBuilder::new(&theme.name)
                            .id(format!("theme_user_{}", theme.id))
                            .checked(current_theme == theme.id)
                            .build(app)?;
                        user_theme_items.insert(theme.id.clone(), item);
                        // Need to borrow the item from the HashMap
                    }
                    // Build items and add to submenu
                    for item in user_theme_items.values() {
                        custom_builder = custom_builder.item(item);
                    }
                }

                let custom_themes_submenu = custom_builder.build()?;

                // 主题设置
                let theme_settings = MenuItemBuilder::new(t("menu.theme_settings"))
                    .id("theme_settings")
                    .build(app)?;

                // 外观菜单
                let appearance_menu = SubmenuBuilder::new(app, t("menu.appearance"))
                    .id("appearance")
                    .item(&appearance_light)
                    .item(&appearance_dark)
                    .item(&appearance_system)
                    .item(&PredefinedMenuItem::separator(app)?)
                    .item(&theme_default)
                    .item(&theme_pastel)
                    .item(&theme_spring)
                    .item(&custom_themes_submenu)
                    .item(&PredefinedMenuItem::separator(app)?)
                    .item(&theme_settings)
                    .build()?;

                // 管理外观菜单项状态（用于选中态同步）
                app.manage(AppearanceMenuState {
                    light: appearance_light,
                    dark: appearance_dark,
                    system: appearance_system,
                });
                app.manage(ThemeMenuState {
                    default: theme_default,
                    pastel: theme_pastel,
                    spring: theme_spring,
                    user_themes: user_theme_items,
                });

                // 导出日志菜单项（移到帮助菜单）
                let export_logs = MenuItemBuilder::new(t("menu.export_logs"))
                    .id("export_logs")
                    .build(app)?;

                // 撤销/重做改为自定义菜单项：原生 PredefinedMenuItem 会接管 Cmd+Z，
                // 绕过编辑器（ProseMirror/CodeMirror/统一历史）的撤销栈，故只发事件由前端分发。
                let undo = MenuItemBuilder::new(t("menu.undo"))
                    .id("undo")
                    .accelerator(
                        get_accelerator("undo").unwrap_or_else(|| to_tauri_accelerator("Cmd+Z")),
                    )
                    .build(app)?;
                let redo = MenuItemBuilder::new(t("menu.redo"))
                    .id("redo")
                    .accelerator(
                        get_accelerator("redo")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+Shift+Z")),
                    )
                    .build(app)?;

                // 编辑菜单
                let edit_menu = SubmenuBuilder::new(app, t("menu.edit"))
                    .item(&undo)
                    .item(&redo)
                    .item(&PredefinedMenuItem::separator(app)?)
                    .item(&PredefinedMenuItem::cut(app, Some(&t("menu.cut")))?)
                    .item(&PredefinedMenuItem::copy(app, Some(&t("menu.copy")))?)
                    .item(&PredefinedMenuItem::paste(app, Some(&t("menu.paste")))?)
                    .item(&PredefinedMenuItem::select_all(
                        app,
                        Some(&t("menu.select_all")),
                    )?)
                    .item(&PredefinedMenuItem::separator(app)?)
                    // .item(&MenuItemBuilder::new(t("menu.auto_fill")).id("auto_fill").build(app)?)
                    // .item(&MenuItemBuilder::new(t("menu.start_dictation")).id("start_dictation").build(app)?)
                    // .item(&MenuItemBuilder::new(t("menu.emoji_symbols")).id("emoji_symbols").build(app)?)
                    .build()?;

                let heading_1 = MenuItemBuilder::new(t("menu.heading_1"))
                    .id("heading_1")
                    .accelerator(
                        get_accelerator("heading_1")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+1")),
                    )
                    .build(app)?;
                let heading_2 = MenuItemBuilder::new(t("menu.heading_2"))
                    .id("heading_2")
                    .accelerator(
                        get_accelerator("heading_2")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+2")),
                    )
                    .build(app)?;
                let heading_3 = MenuItemBuilder::new(t("menu.heading_3"))
                    .id("heading_3")
                    .accelerator(
                        get_accelerator("heading_3")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+3")),
                    )
                    .build(app)?;
                let heading_4 = MenuItemBuilder::new(t("menu.heading_4"))
                    .id("heading_4")
                    .accelerator(
                        get_accelerator("heading_4")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+4")),
                    )
                    .build(app)?;
                let heading_5 = MenuItemBuilder::new(t("menu.heading_5"))
                    .id("heading_5")
                    .accelerator(
                        get_accelerator("heading_5")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+5")),
                    )
                    .build(app)?;
                let heading_6 = MenuItemBuilder::new(t("menu.heading_6"))
                    .id("heading_6")
                    .accelerator(
                        get_accelerator("heading_6")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+6")),
                    )
                    .build(app)?;
                let bullet_list = MenuItemBuilder::new(t("menu.bullet_list"))
                    .id("bullet_list")
                    .accelerator(
                        get_accelerator("bullet_list")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+Shift+7")),
                    )
                    .build(app)?;
                let ordered_list = MenuItemBuilder::new(t("menu.ordered_list"))
                    .id("ordered_list")
                    .accelerator(
                        get_accelerator("ordered_list")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+Shift+8")),
                    )
                    .build(app)?;
                let task_list = MenuItemBuilder::new(t("menu.task_list"))
                    .id("task_list")
                    .accelerator(
                        get_accelerator("task_list")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+Shift+9")),
                    )
                    .build(app)?;
                let code_block = MenuItemBuilder::new(t("menu.code_block"))
                    .id("code_block")
                    .accelerator(
                        get_accelerator("code_block")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+Shift+C")),
                    )
                    .build(app)?;
                let math_block = MenuItemBuilder::new(t("menu.math_block"))
                    .id("math_block")
                    .accelerator(
                        get_accelerator("math_block")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+Shift+M")),
                    )
                    .build(app)?;
                let blockquote = MenuItemBuilder::new(t("menu.blockquote"))
                    .id("blockquote")
                    .accelerator(
                        get_accelerator("blockquote")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+Shift+B")),
                    )
                    .build(app)?;
                let horizontal_rule = MenuItemBuilder::new(t("menu.horizontal_rule"))
                    .id("horizontal_rule")
                    .accelerator(
                        get_accelerator("horizontal_rule")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+Shift+-")),
                    )
                    .build(app)?;
                let table = MenuItemBuilder::new(t("menu.table"))
                    .id("table")
                    .accelerator(
                        get_accelerator("table")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+Opt+T")),
                    )
                    .build(app)?;
                let mermaid = MenuItemBuilder::new(t("menu.mermaid"))
                    .id("mermaid")
                    .accelerator(
                        get_accelerator("mermaid")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+Opt+M")),
                    )
                    .build(app)?;
                let image = MenuItemBuilder::new(t("menu.image"))
                    .id("image")
                    .accelerator(
                        get_accelerator("image")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+Shift+I")),
                    )
                    .build(app)?;

                let paragraph_sep1 = PredefinedMenuItem::separator(app)?;
                let paragraph_sep2 = PredefinedMenuItem::separator(app)?;
                let paragraph_sep3 = PredefinedMenuItem::separator(app)?;

                // 段落菜单
                let paragraph_menu = SubmenuBuilder::new(app, t("menu.paragraph"))
                    .id("paragraph")
                    .item(&heading_1)
                    .item(&heading_2)
                    .item(&heading_3)
                    .item(&heading_4)
                    .item(&heading_5)
                    .item(&heading_6)
                    .item(&paragraph_sep1)
                    .item(&bullet_list)
                    .item(&ordered_list)
                    .item(&task_list)
                    .item(&paragraph_sep2)
                    .item(&code_block)
                    .item(&math_block)
                    .item(&blockquote)
                    .item(&horizontal_rule)
                    .item(&paragraph_sep3)
                    .item(&table)
                    .item(&mermaid)
                    .item(&image)
                    .build()?;

                let minimize = MenuItemBuilder::new(t("menu.minimize"))
                    .id("minimize")
                    .accelerator(
                        get_accelerator("minimize")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+M")),
                    )
                    .build(app)?;
                // 缩放不设快捷键（用户要求移除）
                let zoom = MenuItemBuilder::new(t("menu.zoom")).id("zoom").build(app)?;
                // macOS 上系统会在"窗口"菜单自动注入"填充/居中"等窗口平铺项，
                // 应用不再重复添加自己的"全屏/居中"条目（快捷键仍由前端 keydown 处理）
                #[cfg(not(target_os = "macos"))]
                let center = MenuItemBuilder::new(t("menu.center"))
                    .id("center")
                    .accelerator(
                        get_accelerator("center")
                            .unwrap_or_else(|| to_tauri_accelerator("Cmd+Opt+C")),
                    )
                    .build(app)?;

                // 窗口菜单
                #[cfg(not(target_os = "macos"))]
                let fullscreen_item = MenuItemBuilder::new(t("menu.fullscreen"))
                    .id("fullscreen")
                    .build(app)?;
                let window_menu_builder = SubmenuBuilder::new(app, t("menu.window"))
                    .id("__tauri_window_menu__")
                    .item(&minimize)
                    .item(&zoom);
                #[cfg(not(target_os = "macos"))]
                let window_menu_builder = window_menu_builder.item(&fullscreen_item).item(&center);
                let window_menu = window_menu_builder.build()?;

                // 评价应用菜单项
                let rate_app = MenuItemBuilder::new(t("menu.rate_app"))
                    .id("rate_app")
                    .build(app)?;

                // 关注作者菜单项
                let follow_author = MenuItemBuilder::new(t("menu.follow_author"))
                    .id("follow_author")
                    .build(app)?;

                // 帮助菜单（id 用于 macOS 识别为系统 Help 菜单，从而自动加上搜索框）
                let help_menu = SubmenuBuilder::new(app, t("menu.help"))
                    .id("__tauri_help_menu__")
                    .item(
                        &MenuItemBuilder::new(t("menu.onboarding_wizard"))
                            .id("open_onboarding")
                            .build(app)?,
                    )
                    .item(
                        &MenuItemBuilder::new(t("menu.acknowledgments"))
                            .id("acknowledgments")
                            .build(app)?,
                    )
                    // TODO: 更新日志功能未实现
                    // .item(
                    //     &MenuItemBuilder::new(t("menu.changelog"))
                    //         .id("changelog")
                    //         .enabled(false)
                    //         .build(app)?,
                    // )
                    .item(
                        &MenuItemBuilder::new(t("menu.privacy"))
                            .id("privacy")
                            .build(app)?,
                    )
                    // TODO: 网站功能未实现
                    // .item(
                    //     &MenuItemBuilder::new(t("menu.website"))
                    //         .id("website")
                    //         .enabled(false)
                    //         .build(app)?,
                    // )
                    // TODO: 反馈功能未实现
                    // .item(
                    //     &MenuItemBuilder::new(t("menu.feedback"))
                    //         .id("feedback")
                    //         .enabled(false)
                    //         .build(app)?,
                    // )
                    .item(&PredefinedMenuItem::separator(app)?)
                    .item(&follow_author)
                    .item(&rate_app)
                    .item(&export_logs)
                    .build()?;

                // 开发者选项菜单（仅开发环境构建，用于调试）
                let mut developer_menu: Option<Submenu<tauri::Wry>> = None;
                if devtools_enabled() {
                    let devtools_item = MenuItemBuilder::new(t("menu.devtools"))
                        .id("open_frontend_devtools")
                        .accelerator(if cfg!(target_os = "macos") {
                            "Cmd+Alt+I"
                        } else {
                            "Ctrl+Shift+I"
                        })
                        .build(app)?;
                    let test_review_prompt = MenuItemBuilder::new(t("menu.test_review_prompt"))
                        .id("test_review_prompt")
                        .build(app)?;
                    developer_menu = Some(
                        SubmenuBuilder::new(app, t("menu.developer"))
                            .id("developer")
                            .item(&devtools_item)
                            .item(&PredefinedMenuItem::separator(app)?)
                            .item(&test_review_prompt)
                            .build()?,
                    );
                }

                // 主菜单
                let mut menu_builder = MenuBuilder::new(app)
                    .item(&texto_menu)
                    .item(&file_menu)
                    .item(&edit_menu)
                    .item(&paragraph_menu)
                    .item(&view_menu)
                    .item(&appearance_menu);
                if let Some(developer_menu) = &developer_menu {
                    menu_builder = menu_builder.item(developer_menu);
                }
                let menu = menu_builder.item(&window_menu).item(&help_menu).build()?;

                app.set_menu(menu)?;

                // macOS：为"关于"和"偏好设置"菜单项设置 SF Symbols 模板图标
                #[cfg(target_os = "macos")]
                macos_menu::set_menu_item_symbol_icons(&[
                    (&t("menu.about"), "info.circle"),
                    (&t("menu.preferences"), "gearshape"),
                    (&t("menu.quit"), "xmark.rectangle"),
                ]);
                // macOS：窗口菜单图标
                #[cfg(target_os = "macos")]
                macos_menu::set_submenu_item_symbol_icons(
                    &t("menu.window"),
                    &[
                        (&t("menu.minimize"), "minus.rectangle"),
                        (&t("menu.zoom"), "square.arrowtriangle.4.outward"),
                    ],
                );
                // macOS：视图菜单图标
                #[cfg(target_os = "macos")]
                macos_menu::set_submenu_item_symbol_icons(
                    &t("menu.view"),
                    &[(&t("menu.toggle_sidebar"), "sidebar.left")],
                );
                // macOS：安装窗口菜单代理（每次显示前重排应用条目并禁用"从组中移除窗口"）
                #[cfg(target_os = "macos")]
                macos_menu::install_window_menu_delegate(&t("menu.window"));

                #[cfg(target_os = "macos")]
                dock_menu::setup_dock_menu(app.handle());

                // 保存可配置快捷键的菜单项引用，供运行时动态更新 accelerator
                let mut all_items: HashMap<String, MenuItem<tauri::Wry>> = HashMap::new();
                all_items.insert("new_window".to_string(), new_window);
                all_items.insert("open_file".to_string(), open_file);
                all_items.insert("open_folder".to_string(), open_folder);
                all_items.insert("save_file".to_string(), save_file);
                all_items.insert("open_file_location".to_string(), open_file_location);
                #[cfg(not(feature = "free-version"))]
                {
                    all_items.insert("export_png".to_string(), export_png);
                    all_items.insert("export_pdf".to_string(), export);
                }
                #[cfg(all(not(feature = "free-version"), target_os = "macos"))]
                all_items.insert("print_document".to_string(), print_document);
                all_items.insert("heading_1".to_string(), heading_1);
                all_items.insert("heading_2".to_string(), heading_2);
                all_items.insert("heading_3".to_string(), heading_3);
                all_items.insert("heading_4".to_string(), heading_4);
                all_items.insert("heading_5".to_string(), heading_5);
                all_items.insert("heading_6".to_string(), heading_6);
                all_items.insert("bullet_list".to_string(), bullet_list);
                all_items.insert("ordered_list".to_string(), ordered_list);
                all_items.insert("task_list".to_string(), task_list);
                all_items.insert("code_block".to_string(), code_block);
                all_items.insert("math_block".to_string(), math_block);
                all_items.insert("blockquote".to_string(), blockquote);
                all_items.insert("horizontal_rule".to_string(), horizontal_rule);
                all_items.insert("table".to_string(), table);
                all_items.insert("mermaid".to_string(), mermaid);
                all_items.insert("image".to_string(), image);
                all_items.insert("theme_settings".to_string(), theme_settings);
                all_items.insert("minimize".to_string(), minimize);
                #[cfg(not(target_os = "macos"))]
                {
                    all_items.insert("fullscreen".to_string(), fullscreen_item);
                    all_items.insert("center".to_string(), center);
                }
                app.manage(AppMenuState { items: all_items });
                app.manage(ViewMenuState {
                    sidebar: toggle_sidebar,
                    edit_mode: toggle_edit_mode,
                    typewriter: toggle_typewriter_mode,
                    readable_line_length: toggle_readable_line_length,
                    toolbar: toggle_editor_toolbar,
                    inline_format_toolbar: toggle_inline_format_toolbar,
                    outline_style_off,
                    outline_style_text,
                    outline_style_minimap,
                });

                // 处理菜单事件
                app.on_menu_event(move |app, event| {
                    let event_id = event.id().as_ref();
                    info!("菜单事件被点击: {:?}", event_id);

                    // 获取当前窗口：优先使用聚焦窗口，否则使用第一个可见窗口
                    let window_label = app
                        .webview_windows()
                        .into_iter()
                        .find(|(_, w)| w.is_focused().unwrap_or(false))
                        .or_else(|| {
                            app.webview_windows()
                                .into_iter()
                                .find(|(_, w)| w.is_visible().unwrap_or(false))
                        })
                        .map(|(label, _)| label);

                    match event_id {
                        "new_window" => {
                            if let Some(label) = &window_label {
                                let _ = app.emit_to(label, "menu-event", "new_window");
                            } else {
                                // 没有可见窗口时直接在 Rust 侧创建
                                let handle = app.clone();
                                tauri::async_runtime::spawn(async move {
                                    if let Err(e) = crate::WINDOW_MANAGER
                                        .create_window(&handle, None, None, None)
                                    {
                                        error!("Failed to create window from menu: {}", e);
                                    }
                                });
                            }
                        }
                        "open_file" => {
                            if emit_menu_event(app, &window_label, "open_file") {
                                return;
                            }
                            let handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let file = handle
                                    .dialog()
                                    .file()
                                    .add_filter("Markdown", &["md", "markdown", "mdown", "mkd"])
                                    .add_filter("Text", &["txt"])
                                    .add_filter("All Files", &["*"])
                                    .blocking_pick_file();
                                if let Some(path) = file {
                                    let path_str = path.to_string();
                                    // 如果已有窗口打开了该文件，直接聚焦
                                    if let Some(existing) =
                                        crate::window_manager::find_window_by_path(&path_str)
                                    {
                                        let _ =
                                            crate::window_manager::focus_window(&handle, &existing);
                                    } else if let Err(e) = crate::WINDOW_MANAGER.create_window(
                                        &handle,
                                        None,
                                        Some(path_str),
                                        None,
                                    ) {
                                        error!("Failed to create window from open file: {}", e);
                                    }
                                }
                            });
                        }
                        "open_folder" => {
                            if emit_menu_event(app, &window_label, "open_folder") {
                                return;
                            }
                            let handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let folder = handle.dialog().file().blocking_pick_folder();
                                if let Some(path) = folder {
                                    let path_str = path.to_string();
                                    // 如果已有窗口打开了该目录，直接聚焦
                                    if let Some(existing) =
                                        crate::window_manager::find_window_by_path(&path_str)
                                    {
                                        let _ =
                                            crate::window_manager::focus_window(&handle, &existing);
                                    } else if let Err(e) = crate::WINDOW_MANAGER.create_window(
                                        &handle,
                                        None,
                                        None,
                                        Some(path_str),
                                    ) {
                                        error!("Failed to create window from open folder: {}", e);
                                    }
                                }
                            });
                        }
                        "save_file" => {
                            emit_menu_event(app, &window_label, "save_file");
                        }
                        "clear_recent" => {
                            // 清除最近项目需要广播到所有窗口
                            let _ = app.emit("menu-event", "clear_recent");
                        }
                        // 最近文件：先查重，未命中时一律新建窗口
                        id if id.starts_with("recent_item_") && !id.contains("new_window") => {
                            if let Some(encoded_path) = id.strip_prefix("recent_item_") {
                                if let Ok(decoded) = BASE64.decode(encoded_path) {
                                    if let Ok(path) = String::from_utf8(decoded) {
                                        // 如果已有窗口打开了该文件/目录，直接聚焦
                                        if let Some(existing) =
                                            crate::window_manager::find_window_by_path(&path)
                                        {
                                            let _ =
                                                crate::window_manager::focus_window(app, &existing);
                                            return;
                                        }
                                        // 否则新建窗口
                                        let handle = app.clone();
                                        tauri::async_runtime::spawn(async move {
                                            let _ = crate::WINDOW_MANAGER
                                                .create_window_for_recent_item(&handle, &path);
                                        });
                                    }
                                }
                            }
                        }
                        // 在新窗口中打开最近文件：总是新建窗口
                        id if id.starts_with("recent_item_new_window_") => {
                            if let Some(encoded_path) = id.strip_prefix("recent_item_new_window_") {
                                if let Ok(decoded) = BASE64.decode(encoded_path) {
                                    if let Ok(path) = String::from_utf8(decoded) {
                                        let handle = app.clone();
                                        tauri::async_runtime::spawn(async move {
                                            let _ = crate::WINDOW_MANAGER
                                                .create_window_for_recent_item(&handle, &path);
                                        });
                                    }
                                }
                            }
                        }
                        "toggle_sidebar" => {
                            emit_menu_event(app, &window_label, "toggle_sidebar");
                        }
                        "toggle_edit_mode" => {
                            emit_menu_event(app, &window_label, "toggle_edit_mode");
                        }
                        "toggle_typewriter_mode" => {
                            // 全局配置：在 Rust 端按持久化值翻转并广播，
                            // 避免只作用于聚焦窗口、其他窗口状态丢失
                            let mut config = AppConfig::load(app);
                            config.typewriter_enabled = !config.typewriter_enabled;
                            if let Err(e) = config.save(app) {
                                error!("保存打字机模式配置失败: {}", e);
                            } else {
                                sync_global_view_menu_checks(app, &config);
                                let _ = app.emit("config-changed", config);
                            }
                        }
                        "toggle_readable_line_length" => {
                            // 全局配置：在 Rust 端按持久化值翻转并广播，
                            // 避免只作用于聚焦窗口、其他窗口状态丢失
                            let mut config = AppConfig::load(app);
                            config.editor_readable_line_length = !config.editor_readable_line_length;
                            if let Err(e) = config.save(app) {
                                error!("保存可读行宽配置失败: {}", e);
                            } else {
                                sync_global_view_menu_checks(app, &config);
                                let _ = app.emit("config-changed", config);
                            }
                        }
                        "toggle_editor_toolbar" => {
                            // 全局配置：在 Rust 端按持久化值翻转并广播，
                            // 避免只作用于聚焦窗口、其他窗口状态丢失
                            let mut config = AppConfig::load(app);
                            config.show_editor_toolbar = !config.show_editor_toolbar;
                            if let Err(e) = config.save(app) {
                                error!("保存工具栏配置失败: {}", e);
                            } else {
                                sync_global_view_menu_checks(app, &config);
                                let _ = app.emit("config-changed", config);
                            }
                        }
                        "toggle_inline_format_toolbar" => {
                            let mut config = AppConfig::load(app);
                            config.show_inline_format_toolbar = !config.show_inline_format_toolbar;
                            if let Err(e) = config.save(app) {
                                error!("保存悬浮工具栏配置失败: {}", e);
                            } else {
                                sync_global_view_menu_checks(app, &config);
                                let _ = app.emit("config-changed", config);
                            }
                        }
                        "outline_style_off" => {
                            let mut config = AppConfig::load(app);
                            config.outline_style = "off".to_string();
                            if let Err(e) = config.save(app) {
                                error!("保存大纲样式配置失败: {}", e);
                            } else {
                                sync_global_view_menu_checks(app, &config);
                                let _ = app.emit("config-changed", config);
                            }
                        }
                        "outline_style_text" => {
                            let mut config = AppConfig::load(app);
                            config.outline_style = "text".to_string();
                            if let Err(e) = config.save(app) {
                                error!("保存大纲样式配置失败: {}", e);
                            } else {
                                sync_global_view_menu_checks(app, &config);
                                let _ = app.emit("config-changed", config);
                            }
                        }
                        "outline_style_minimap" => {
                            let mut config = AppConfig::load(app);
                            config.outline_style = "minimap".to_string();
                            if let Err(e) = config.save(app) {
                                error!("保存大纲样式配置失败: {}", e);
                            } else {
                                sync_global_view_menu_checks(app, &config);
                                let _ = app.emit("config-changed", config);
                            }
                        }
                        "test_review_prompt" => {
                            // 开发者菜单：测试环境一键触发系统评分弹窗（仅 macOS 支持原生评分面板）
                            #[cfg(target_os = "macos")]
                            {
                                if let Err(e) = store_review::request_app_review(app.clone()) {
                                    error!("Failed to trigger review prompt: {}", e);
                                }
                            }
                        }
                        "auto_save" => {
                            #[cfg(not(feature = "free-version"))]
                            {
                                // 切换自动保存配置
                                let mut config = AppConfig::load(app);
                                config.auto_save = !config.auto_save;
                                if let Err(e) = config.save(app) {
                                    error!("保存自动保存配置失败: {}", e);
                                } else {
                                    info!(
                                        "自动保存已 {}",
                                        if config.auto_save { "开启" } else { "关闭" }
                                    );
                                    // 广播到所有窗口
                                    let _ = app.emit("config-changed", config.clone());
                                }
                            }
                            #[cfg(feature = "free-version")]
                            {
                                info!("Auto-save is disabled in the free version");
                            }
                        }
                        "open_onboarding" => {
                            // 设置向导是独立窗口，不依赖当前聚焦窗口
                            if let Err(e) =
                                crate::window_manager::create_onboarding_window_internal(app)
                            {
                                error!("Failed to open onboarding wizard: {}", e);
                            }
                        }
                        "open_settings" => {
                            if let Some(label) = &window_label {
                                let _ = app.emit_to(label, "menu-event", "open_settings");
                            } else {
                                if let Err(e) =
                                    crate::window_manager::create_settings_window_internal(app)
                                {
                                    error!("Failed to create settings window: {}", e);
                                }
                            }
                        }
                        "open_frontend_devtools" => {
                            // 打开前端开发者工具（作用于当前聚焦/可见窗口）
                            if devtools_enabled() {
                                if let Some(label) = &window_label {
                                    if let Some(window) = app.get_webview_window(label) {
                                        window.open_devtools();
                                    }
                                }
                            }
                        }
                        // 外观菜单事件：切換选中态并广播到所有窗口
                        "appearance_light" => {
                            if let Some(state) = app.try_state::<AppearanceMenuState>() {
                                let _ = state.light.set_checked(true);
                                let _ = state.dark.set_checked(false);
                                let _ = state.system.set_checked(false);
                            }
                            let _ = app.emit("menu-event", "appearance_light");
                        }
                        "appearance_dark" => {
                            if let Some(state) = app.try_state::<AppearanceMenuState>() {
                                let _ = state.light.set_checked(false);
                                let _ = state.dark.set_checked(true);
                                let _ = state.system.set_checked(false);
                            }
                            let _ = app.emit("menu-event", "appearance_dark");
                        }
                        "appearance_system" => {
                            if let Some(state) = app.try_state::<AppearanceMenuState>() {
                                let _ = state.light.set_checked(false);
                                let _ = state.dark.set_checked(false);
                                let _ = state.system.set_checked(true);
                            }
                            let _ = app.emit("menu-event", "appearance_system");
                        }
                        // 主题切换事件：切换选中态并广播
                        "theme_default" => {
                            if let Some(state) = app.try_state::<ThemeMenuState>() {
                                let _ = state.default.set_checked(true);
                                let _ = state.pastel.set_checked(false);
                                let _ = state.spring.set_checked(false);
                                for item in state.user_themes.values() {
                                    let _ = item.set_checked(false);
                                }
                            }
                            let _ = app.emit("menu-event", "theme_default");
                        }
                        "theme_pastel" => {
                            if let Some(state) = app.try_state::<ThemeMenuState>() {
                                let _ = state.default.set_checked(false);
                                let _ = state.pastel.set_checked(true);
                                let _ = state.spring.set_checked(false);
                                for item in state.user_themes.values() {
                                    let _ = item.set_checked(false);
                                }
                            }
                            let _ = app.emit("menu-event", "theme_pastel");
                        }
                        "theme_spring" => {
                            if let Some(state) = app.try_state::<ThemeMenuState>() {
                                let _ = state.default.set_checked(false);
                                let _ = state.pastel.set_checked(false);
                                let _ = state.spring.set_checked(true);
                                for item in state.user_themes.values() {
                                    let _ = item.set_checked(false);
                                }
                            }
                            let _ = app.emit("menu-event", "theme_spring");
                        }
                        // 用户导入的主题
                        id if id.starts_with("theme_user_") && id != "theme_user_imported" => {
                            if let Some(state) = app.try_state::<ThemeMenuState>() {
                                let _ = state.default.set_checked(false);
                                let _ = state.pastel.set_checked(false);
                                let _ = state.spring.set_checked(false);
                                let theme_id = id.strip_prefix("theme_user_").unwrap_or("");
                                for (tid, item) in state.user_themes.iter() {
                                    let _ = item.set_checked(tid == theme_id);
                                }
                            }
                            let _ = app.emit("menu-event", id);
                        }
                        "theme_settings" => {
                            let _ = app.emit("menu-event", "theme_settings");
                        }
                        "export_logs" => {
                            // 防止重复处理
                            info!("导出日志菜单项被点击: {:?}", std::process::id());
                            // 导出日志到用户选择的目录
                            let app_handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                // 获取日志目录
                                let log_dir = app_handle
                                    .path()
                                    .app_log_dir()
                                    .unwrap_or_else(|_| PathBuf::from("."));

                                // 让用户选择目标目录
                                let target_dir = app_handle
                                    .dialog()
                                    .file()
                                    .set_title("选择日志导出目录")
                                    .set_directory("/")
                                    .blocking_pick_folder();

                                if let Some(target_dir) = target_dir {
                                    // 生成文件名: Textox-日期时分秒-随机字符串.log
                                    let now = chrono::Local::now();
                                    let random_string: String =
                                        std::iter::repeat_with(|| rand::random::<u8>() % 36)
                                            .take(8)
                                            .map(|x| {
                                                if x < 10 {
                                                    (b'0' + x) as char
                                                } else {
                                                    (b'a' + x - 10) as char
                                                }
                                            })
                                            .collect();
                                    let filename = format!(
                                        "Textox-{}-{}.log",
                                        now.format("%Y%m%d%H%M%S"),
                                        random_string
                                    );
                                    let target_path = match target_dir.into_path() {
                                        Ok(path) => path.join(&filename),
                                        Err(_) => {
                                            error!("无法转换目标路径");
                                            return;
                                        }
                                    };

                                    // 复制日志文件
                                    match std::fs::read_dir(&log_dir) {
                                        Ok(entries) => {
                                            let mut log_content = String::new();
                                            for entry in entries.flatten() {
                                                if let Ok(content) =
                                                    std::fs::read_to_string(entry.path())
                                                {
                                                    log_content.push_str(&content);
                                                    log_content.push('\n');
                                                }
                                            }

                                            if let Err(e) =
                                                std::fs::write(&target_path, log_content)
                                            {
                                                error!("导出日志失败: {}", e);
                                            } else {
                                                info!("日志已导出到: {:?}", target_path);
                                            }
                                        }
                                        Err(e) => {
                                            error!("读取日志目录失败: {}", e);
                                        }
                                    }
                                }
                            });
                        }
                        "quit_app" => {
                            // 标记退出请求，向所有窗口发送关闭检查
                            info!("quit_app: setting QUIT_REQUESTED, broadcasting check-close");
                            crate::window_manager::QUIT_REQUESTED.store(true, Ordering::SeqCst);
                            let labels: Vec<String> =
                                app.webview_windows().keys().cloned().collect();
                            for label in &labels {
                                let _ = app.emit_to(label, "check-close", ());
                            }
                            if labels.is_empty() {
                                // 没有窗口，直接退出
                                app.exit(0);
                            }
                        }
                        // 文件菜单
                        "open_file_location" => {
                            emit_menu_event(app, &window_label, "open_file_location");
                        }
                        "import_translations" => {
                            let handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let file = handle
                                    .dialog()
                                    .file()
                                    .add_filter("Translations", &["json", "yaml"])
                                    .set_title("选择翻译文件")
                                    .blocking_pick_file();
                                if let Some(path) = file {
                                    let path_str = path.to_string();
                                    match i18n::import_translation_file(handle.clone(), path_str) {
                                        Err(e) => {
                                            error!("导入翻译失败: {}", e);
                                            let _ = handle.emit("import-translation-error", e);
                                        }
                                        Ok(_) => {
                                            let _ = handle.emit("import-translation-success", "");
                                        }
                                    }
                                }
                            });
                        }
                        // 导出项全部按 id 原样转发给前端：插件导出器（html/epub/
                        // docx/odt/rtf/tex）随时可增减，Rust 侧不再逐个列举。
                        // `export_logs` 在上面的分支已处理，不会被这里吞掉。
                        #[cfg(not(feature = "free-version"))]
                        id if id.starts_with("export_") => {
                            emit_menu_event(app, &window_label, id);
                        }
                        #[cfg(not(feature = "free-version"))]
                        "print_document" => {
                            emit_menu_event(app, &window_label, "print_document");
                        }
                        // 编辑菜单
                        "undo" | "redo" => {
                            emit_menu_event(app, &window_label, event_id);
                        }
                        "auto_fill" => {
                            emit_menu_event(app, &window_label, "auto_fill");
                        }
                        "start_dictation" => {
                            emit_menu_event(app, &window_label, "start_dictation");
                        }
                        "emoji_symbols" => {
                            emit_menu_event(app, &window_label, "emoji_symbols");
                        }
                        // 段落菜单
                        "heading_1" | "heading_2" | "heading_3" | "heading_4" | "heading_5"
                        | "heading_6" => {
                            emit_menu_event(app, &window_label, event_id);
                        }
                        "bullet_list" | "ordered_list" | "task_list" => {
                            emit_menu_event(app, &window_label, event_id);
                        }
                        "code_block" | "math_block" | "blockquote" | "horizontal_rule" => {
                            emit_menu_event(app, &window_label, event_id);
                        }
                        "table" | "mermaid" => {
                            emit_menu_event(app, &window_label, event_id);
                        }
                        // 格式菜单
                        "bold" | "italic" | "strikethrough" => {
                            emit_menu_event(app, &window_label, event_id);
                        }
                        "inline_code" | "inline_math" | "link" | "image" => {
                            emit_menu_event(app, &window_label, event_id);
                        }
                        // 窗口菜单（所有窗口类型都处理）
                        "minimize" => {
                            if let Some(label) = &window_label {
                                let _ = app.emit_to(label, "menu-event", "minimize");
                            }
                        }
                        "zoom" => {
                            if let Some(label) = &window_label {
                                let _ = app.emit_to(label, "menu-event", "zoom");
                            }
                        }
                        "fullscreen" => {
                            if let Some(label) = &window_label {
                                let _ = app.emit_to(label, "menu-event", "fullscreen");
                            }
                        }
                        "center" => {
                            if let Some(label) = &window_label {
                                let _ = app.emit_to(label, "menu-event", "center");
                            }
                        }
                        // 帮助菜单
                        "acknowledgments" => {
                            if let Some(label) = &window_label {
                                let _ = app.emit_to(label, "menu-event", "acknowledgments");
                            } else if let Err(e) =
                                crate::window_manager::create_acknowledgments_window_internal(app)
                            {
                                error!("Failed to create acknowledgments window: {}", e);
                            }
                        }
                        "privacy" => {
                            if let Some(label) = &window_label {
                                let _ = app.emit_to(label, "menu-event", "privacy");
                            } else if let Err(e) =
                                crate::window_manager::create_privacy_window_internal(app)
                            {
                                error!("Failed to create privacy window: {}", e);
                            }
                        }
                        "rate_app" => {
                            store_review::open_app_review_page();
                        }
                        "follow_author" => {
                            if let Err(e) = open_follow_author(app.clone()) {
                                error!("Failed to open author profile from menu: {}", e);
                            }
                        }
                        _ => {}
                    }
                });
            } // #[cfg(desktop)] 桌面端菜单结束

            // 为所有窗口设置关闭事件处理
            let app_handle = app.handle().clone();

            for (label, window) in app.webview_windows() {
                let app_handle_clone = app_handle.clone();
                let label_clone = label.clone();
                info!("Setting up close handler for window: {}", label);
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // Ctrl+C 强制退出时放行窗口关闭
                        if crate::window_manager::FORCE_EXIT.load(Ordering::SeqCst) {
                            info!("Force exit: allowing window to close: {}", label_clone);
                            return;
                        }
                        info!("Close requested for window: {}", label_clone);
                        // 阻止默认关闭行为
                        api.prevent_close();
                        // 发送关闭检查事件到该窗口
                        info!("Emitting check-close event to: {}", label_clone);
                        let _ = app_handle_clone.emit_to(&label_clone, "check-close", ());
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
}

/// 移动端入口（iOS/Android）。桌面端由 main.rs 负责启动。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = run_app().expect("failed to build tauri application");
    app.run(|app_handle, event| {
        // 处理"App 或其他应用以"打开方式"传入的文件（仅 macOS/iOS 有该事件）
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = event {
            for url in urls {
                let url_str = url.to_string();
                if let Some(path) = url_str.strip_prefix("file://") {
                    let decoded = urlencoding::decode(path).unwrap_or_else(|_| path.into());
                    let file_path: String = decoded.into_owned();
                    log::info!(
                        "[mobile] opened file: {} (exists={})",
                        file_path,
                        std::path::Path::new(&file_path).exists()
                    );
                    // iOS 就地打开的文件需要安全作用域访问
                    #[cfg(target_os = "ios")]
                    crate::start_ios_scoped_access(&file_path);
                    // 启动早期：入队等待前端初始化后消费
                    crate::add_pending_open_file(file_path.clone());
                    // 应用已运行：定向通知一个编辑器窗口（载荷带 target，
                    // 其余窗口的监听器会自行忽略，避免多窗口各开一次）。
                    let target = crate::mcp::resolve_window(app_handle, None)
                        .unwrap_or_else(|_| "main".to_string());
                    let _ = app_handle.emit_to(
                        target.clone(),
                        "open-file",
                        serde_json::json!({ "path": file_path, "target": target }),
                    );
                }
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        let _ = (app_handle, event);
    });
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_valid_plugin_id() {
        assert!(is_valid_plugin_id("picgo"));
        assert!(is_valid_plugin_id("my_plugin-2"));
        assert!(!is_valid_plugin_id(""));
        assert!(!is_valid_plugin_id("../evil"));
        assert!(!is_valid_plugin_id("a/b"));
        assert!(!is_valid_plugin_id("中文"));
        assert!(!is_valid_plugin_id("Picgo"));
        assert!(!is_valid_plugin_id(&"a".repeat(65)));
    }

    // -----------------------------------------------------------------------
    // read_directory 携带 Finder 标签颜色
    // -----------------------------------------------------------------------

    #[cfg(target_os = "macos")]
    #[test]
    fn test_read_directory_includes_tag_color() {
        let dir = std::env::temp_dir().join("textox-read-dir-tag-color");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let colored = dir.join("colored.md");
        let plain = dir.join("plain.md");
        std::fs::write(&colored, "x").unwrap();
        std::fs::write(&plain, "x").unwrap();
        macos_tags::write_color(colored.to_str().unwrap(), Some("red")).unwrap();

        let nodes = read_directory_with_depth(&dir, 0).unwrap();
        let colored_node = nodes.iter().find(|n| n.name == "colored.md").unwrap();
        let plain_node = nodes.iter().find(|n| n.name == "plain.md").unwrap();

        assert_eq!(colored_node.tag_color.as_deref(), Some("red"));
        assert_eq!(plain_node.tag_color, None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    // -----------------------------------------------------------------------
    // format_path_for_display
    // -----------------------------------------------------------------------

    #[test]
    fn test_format_path_short() {
        let result = format_path_for_display("/tmp/foo.md", 50);
        assert_eq!(result, "/tmp/foo.md");
    }

    #[test]
    fn test_format_path_exact_max() {
        let path = "/tmp/short.md"; // 13 chars
        let result = format_path_for_display(path, 13);
        assert_eq!(result, path, "Path at max_len boundary should return as-is");
    }

    #[test]
    fn test_format_path_truncate_mid_levels() {
        // Force truncation with smaller max_len
        let result = format_path_for_display("/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p.md", 20);
        assert!(
            result.starts_with("..."),
            "Should be truncated, got: {}",
            result
        );
        assert!(result.len() <= 23, "Result too long: {}", result.len());
    }

    #[test]
    fn test_format_path_single_long_component() {
        let long = "a".repeat(100);
        let path = format!("/{}", long);
        let result = format_path_for_display(&path, 50);
        assert!(result.starts_with("..."));
        // max_len=50 → displays at most 47 chars of the path + "..." = 50 total
        assert_eq!(result.len(), 50);
    }

    #[test]
    fn test_format_path_max_len_3_edge() {
        // R1 fix: max_len < 3 clamped to 3, result is just "..." (3 chars)
        let result = format_path_for_display("/very/long/path/to/file.md", 1);
        assert_eq!(result, "...");
    }

    #[test]
    fn test_format_path_max_len_0_edge() {
        // R1 fix: max_len = 0 clamped to 3, result is just "..." (3 chars)
        let result = format_path_for_display("/very/long/path.md", 0);
        assert_eq!(result, "...");
    }

    #[test]
    fn test_format_path_home_replacement() {
        let home = dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        if !home.is_empty() {
            let path = format!("{}/Documents/file.md", home);
            let result = format_path_for_display(&path, 200);
            assert!(
                result.starts_with('~'),
                "Expected ~/ prefix, got: {}",
                result
            );
        }
    }

    #[test]
    fn test_format_path_two_levels_kept() {
        let result = format_path_for_display("/Users/user/projects/texto/src/main.rs", 35);
        assert!(result.starts_with("..."));
    }

    #[test]
    fn test_format_path_long_chinese_last_component() {
        // 多字节文件名：字节长度 > max_len，且 (len - 47) 落在 UTF-8 字符中间，
        // 旧实现会 panic（byte index is not a char boundary）。
        let path = "/Users/geange/Documents/2026年度总结报告草稿最终版修订版本完整版最终定稿.md";
        let result = format_path_for_display(path, 50);
        assert!(result.starts_with("..."));
        assert!(result.len() <= 50, "Result too long: {}", result.len());
        assert!(result.ends_with(".md"));
    }

    #[test]
    fn test_format_path_long_chinese_no_separator() {
        let path = "一个非常非常非常非常非常非常非常非常非常非常长的中文文件名.md";
        let result = format_path_for_display(path, 30);
        assert!(result.starts_with("..."));
        assert!(result.len() <= 30, "Result too long: {}", result.len());
        assert!(result.ends_with(".md"));
    }

    #[test]
    fn test_format_path_short_chinese_untouched() {
        let path = "/tmp/工作计划.md";
        let result = format_path_for_display(path, 50);
        assert_eq!(result, path);
    }

    #[test]
    fn test_format_path_chinese_with_ascii_prefix() {
        // 混合 ASCII 前缀 + 长中文文件名，起始偏移可能落在中文中间
        let path = "/Volumes/工作盘/2026年度总结报告草稿最终版修订版本完整版最终定稿.md";
        let result = format_path_for_display(path, 50);
        assert!(result.starts_with("..."));
        assert!(result.len() <= 50, "Result too long: {}", result.len());
        assert!(result.ends_with(".md"));
    }

    #[test]
    fn test_format_path_max_len_3_with_multibyte() {
        // max_len=3（clamp 下限）时预算为 0，多字节路径也应安全返回 "..."
        let path = "/Users/geange/中文文档/年度总结.md";
        let result = format_path_for_display(path, 1);
        assert_eq!(result, "...");
    }

    #[test]
    fn test_format_path_exactly_budget_bytes() {
        // 最后一级恰好 47 字节（预算），应原样保留最后一级
        let last = format!("{}{}", "中".repeat(14), "abcde"); // 42 + 5 = 47 字节
        assert_eq!(last.len(), 47);
        let path = format!("/Users/geange/Documents/{}", last);
        let result = format_path_for_display(&path, 50);
        assert_eq!(result, format!("...{}", last));
    }

    // -----------------------------------------------------------------------
    // truncate_path_tail
    // -----------------------------------------------------------------------

    #[test]
    fn test_truncate_path_tail_never_splits_multibyte() {
        let s = "一个非常非常非常非常非常非常长的中文文件名.md";
        for max_len in 3..=s.len() + 5 {
            let result = truncate_path_tail(s, max_len);
            assert!(result.starts_with("..."));
            assert!(
                result.len() <= max_len,
                "max_len={} result={} (len {})",
                max_len,
                result,
                result.len()
            );
        }
    }

    #[test]
    fn test_truncate_path_tail_fits_budget_still_adds_prefix() {
        let s = "中文.md";
        assert_eq!(truncate_path_tail(s, 20), "...中文.md");
    }

    #[test]
    fn test_truncate_path_tail_empty() {
        assert_eq!(truncate_path_tail("", 10), "...");
    }

    // -----------------------------------------------------------------------
    // sanitize_image_extension
    // -----------------------------------------------------------------------

    #[test]
    fn test_sanitize_image_extension_normal() {
        assert_eq!(sanitize_image_extension(Some("photo.png")), "png");
        assert_eq!(sanitize_image_extension(Some("a.b.jpeg")), "jpeg");
        assert_eq!(sanitize_image_extension(None), "png");
        // 无点文件名整体视为"扩展名"，保持原行为
        assert_eq!(sanitize_image_extension(Some("noext")), "noext");
    }

    #[test]
    fn test_sanitize_image_extension_strips_path_traversal() {
        // rsplit('.') 取最后一段；无论取到哪一段，路径字符都会被剥离，
        // 最终结果不可能包含 / \ .. 等路径片段
        assert_eq!(
            sanitize_image_extension(Some("evil.png/../../outside")),
            "outside"
        );
        assert_eq!(sanitize_image_extension(Some("a.png\\..\\..\\etc")), "etc");
        assert_eq!(sanitize_image_extension(Some("x..png")), "png");
        // 无点文件名整体作为扩展名时，路径片段同样被剥离
        assert_eq!(sanitize_image_extension(Some("evil/../../x")), "x");
        assert_eq!(sanitize_image_extension(Some("a/../b")), "b");
        assert_eq!(sanitize_image_extension(Some("no/dots/here")), "nodotshere");
    }

    #[test]
    fn test_sanitize_image_extension_caps_length() {
        let long = format!("{}.{}", "x".repeat(50), "y".repeat(50));
        let result = sanitize_image_extension(Some(&long));
        assert!(result.len() <= 10);
    }

    // -----------------------------------------------------------------------
    // search_files_sync
    // -----------------------------------------------------------------------

    fn create_temp_search_dir(prefix: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("textox-search-{}-{}", prefix, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[cfg(unix)]
    #[test]
    fn test_search_files_symlink_loop_terminates() {
        let dir = create_temp_search_dir("loop");
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("sub/alpha.md"), "").unwrap();
        std::os::unix::fs::symlink(&dir, dir.join("sub/loop")).unwrap();

        let results = search_files_sync(&dir, "alpha").unwrap();
        assert!(!results.is_empty(), "alpha.md should still be found");
        assert!(results.iter().all(|r| r.name == "alpha.md"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_search_files_basic_match() {
        let dir = create_temp_search_dir("basic");
        std::fs::write(dir.join("alpha.md"), "").unwrap();
        std::fs::write(dir.join("beta.md"), "").unwrap();

        let results = search_files_sync(&dir, "alpha").unwrap();
        assert_eq!(results.len(), 1, "only alpha.md should match");
        assert_eq!(results[0].name, "alpha.md");
        assert!(results[0].path.ends_with("alpha.md"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_search_files_case_insensitive() {
        let dir = create_temp_search_dir("case");
        std::fs::write(dir.join("README.md"), "").unwrap();

        let results = search_files_sync(&dir, "readme").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "README.md");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_search_files_ignores_hidden() {
        let dir = create_temp_search_dir("hidden");
        std::fs::write(dir.join(".secret.md"), "").unwrap();
        std::fs::write(dir.join(".DS_Store"), "").unwrap();

        let results = search_files_sync(&dir, "secret").unwrap();
        assert!(results.is_empty(), "hidden files must be ignored");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_search_files_recursive() {
        let dir = create_temp_search_dir("recursive");
        std::fs::create_dir_all(dir.join("sub/deeper")).unwrap();
        std::fs::write(dir.join("sub/deeper/target.md"), "").unwrap();

        let results = search_files_sync(&dir, "target").unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].path.ends_with("target.md"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_search_files_does_not_match_directories() {
        let dir = create_temp_search_dir("dirs");
        std::fs::create_dir_all(dir.join("docs")).unwrap();

        let results = search_files_sync(&dir, "docs").unwrap();
        assert!(results.is_empty(), "directory names must not match");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_search_files_result_limit() {
        let dir = create_temp_search_dir("limit");
        for i in 0..250 {
            std::fs::write(dir.join(format!("file_{i:03}.md")), "").unwrap();
        }

        let results = search_files_sync(&dir, "file").unwrap();
        assert!(results.len() <= 200, "results must be capped at 200");
        assert_eq!(results.len(), 200);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_search_files_empty_query_returns_empty() {
        let dir = create_temp_search_dir("empty");
        std::fs::write(dir.join("alpha.md"), "").unwrap();

        let results = search_files_sync(&dir, "  ").unwrap();
        assert!(results.is_empty(), "blank query must return no results");

        let _ = std::fs::remove_dir_all(&dir);
    }

    // -----------------------------------------------------------------------
    // to_tauri_accelerator
    // -----------------------------------------------------------------------

    #[test]
    fn test_to_tauri_accelerator_cmd() {
        let result = to_tauri_accelerator("Cmd+S");
        if cfg!(target_os = "macos") {
            assert_eq!(result, "Command+S");
        } else {
            assert_eq!(result, "Ctrl+S");
        }
    }

    #[test]
    fn test_to_tauri_accelerator_opt() {
        let result = to_tauri_accelerator("Cmd+Opt+T");
        if cfg!(target_os = "macos") {
            assert_eq!(result, "Command+Option+T");
        } else {
            assert_eq!(result, "Ctrl+Alt+T");
        }
    }

    #[test]
    fn test_to_tauri_accelerator_no_modifier() {
        let result = to_tauri_accelerator("F5");
        assert_eq!(result, "F5");
    }

    // -----------------------------------------------------------------------
    // image_mime_type
    // -----------------------------------------------------------------------

    #[test]
    fn test_image_mime_known() {
        assert_eq!(image_mime_type("png"), "image/png");
        assert_eq!(image_mime_type("jpg"), "image/jpeg");
        assert_eq!(image_mime_type("jpeg"), "image/jpeg");
        assert_eq!(image_mime_type("gif"), "image/gif");
        assert_eq!(image_mime_type("webp"), "image/webp");
        assert_eq!(image_mime_type("svg"), "image/svg+xml");
        assert_eq!(image_mime_type("bmp"), "image/bmp");
        assert_eq!(image_mime_type("ico"), "image/x-icon");
        assert_eq!(image_mime_type("avif"), "image/avif");
    }

    #[test]
    fn test_image_mime_unknown() {
        assert_eq!(image_mime_type("pdf"), "application/octet-stream");
        assert_eq!(image_mime_type("txt"), "application/octet-stream");
        assert_eq!(image_mime_type(""), "application/octet-stream");
    }

    #[test]
    fn test_image_mime_case_insensitive() {
        assert_eq!(image_mime_type("PNG"), "image/png");
        assert_eq!(image_mime_type("JPG"), "image/jpeg");
        assert_eq!(image_mime_type("Svg"), "image/svg+xml");
    }

    // -----------------------------------------------------------------------
    // AppConfig – serde defaults (the #[serde(default)] fix)
    // -----------------------------------------------------------------------

    #[test]
    fn test_app_config_missing_fields_use_defaults() {
        // Minimal JSON with only some fields — missing ones should get defaults
        let json = r#"{
            "auto_save": true,
            "language": "zh-CN"
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert!(config.auto_save);
        assert_eq!(config.language, "zh-CN");
        // Fields not in JSON get Default values
        assert_eq!(config.color_theme, "default");
        assert_eq!(config.appearance, "system");
        assert_eq!(config.editor_font_size, 15);
        assert_eq!(config.source_font_size, 13);
        assert_eq!(config.window_width, 960.0);
        assert_eq!(config.window_height, 700.0);
        assert!(!config.sync_editor_bg);
        assert!(config.watch_external_file_changes);
        assert_eq!(config.startup_behavior, StartupBehavior::BlankDocument);
        assert!(config.workspace_folder.is_none());
    }

    #[test]
    fn test_startup_behavior_serde() {
        assert_eq!(
            serde_json::from_str::<StartupBehavior>("\"blank\"").unwrap(),
            StartupBehavior::BlankDocument
        );
        assert_eq!(
            serde_json::from_str::<StartupBehavior>("\"workspace\"").unwrap(),
            StartupBehavior::Workspace
        );
        assert_eq!(
            serde_json::to_string(&StartupBehavior::Workspace).unwrap(),
            "\"workspace\""
        );
        // 未知值回退到默认（serde(default) 只对缺失字段生效，这里验证默认枚举值）
        let json = r#"{}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.startup_behavior, StartupBehavior::BlankDocument);
    }

    #[test]
    fn test_app_config_unknown_fields_ignored() {
        let json = r#"{
            "auto_save": false,
            "language": "en-US",
            "unknown_field": "should_not_cause_error",
            "another_unknown": 42
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert!(!config.auto_save);
        assert_eq!(config.language, "en-US");
    }

    #[test]
    fn test_app_config_serde_roundtrip() {
        let config = AppConfig::default();
        let json = serde_json::to_value(&config).unwrap();
        let deserialized: AppConfig = serde_json::from_value(json).unwrap();
        assert_eq!(deserialized.auto_save, config.auto_save);
        assert_eq!(deserialized.language, config.language);
        assert_eq!(deserialized.color_theme, config.color_theme);
        assert_eq!(deserialized.appearance, config.appearance);
        assert_eq!(deserialized.editor_font_size, config.editor_font_size);
        assert_eq!(deserialized.source_font_size, config.source_font_size);
        assert_eq!(deserialized.window_width, config.window_width);
        assert_eq!(deserialized.window_height, config.window_height);
        assert_eq!(deserialized.startup_behavior, config.startup_behavior);
        assert_eq!(deserialized.workspace_folder, config.workspace_folder);
    }

    #[test]
    fn test_app_config_full_json() {
        let json = r#"{
            "auto_save": true,
            "sync_editor_bg": true,
            "language": "ja-JP",
            "color_theme": "pastel",
            "appearance": "dark",
            "font_family": "system",
            "editor_font_family": "mono",
            "editor_font_size": 18,
            "source_font_size": 16,
            "image_storage_mode": "custom_path",
            "image_folder_name": "media",
            "image_custom_path": "/custom/path",
            "image_aggregation_mode": "by_date",
            "image_date_format": "YYYY-MM-DD",
            "picgo_server_url": "http://localhost:36677",
            "window_width": 1920.0,
            "window_height": 1080.0,
            "watch_external_file_changes": false,
            "silent_external_file_changes": true,
            "code_block_word_wrap": false,
            "show_line_numbers": false,
            "auto_capitalize": true,
            "show_word_count": true,
            "openable_extensions": ["md", "txt"],
            "show_editor_toolbar": true,
            "startup_behavior": "workspace",
            "workspace_folder": "/Users/me/workspace"
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert!(config.auto_save);
        assert!(config.sync_editor_bg);
        assert_eq!(config.language, "ja-JP");
        assert_eq!(config.color_theme, "pastel");
        assert_eq!(config.appearance, "dark");
        assert_eq!(config.editor_font_size, 18);
        assert_eq!(config.source_font_size, 16);
        assert_eq!(config.window_width, 1920.0);
        assert!(!config.watch_external_file_changes);
        assert!(config.silent_external_file_changes);
        assert!(!config.code_block_word_wrap);
        assert!(config.auto_capitalize);
        assert_eq!(config.openable_extensions, vec!["md", "txt"]);
        assert_eq!(config.startup_behavior, StartupBehavior::Workspace);
        assert_eq!(
            config.workspace_folder.as_deref(),
            Some("/Users/me/workspace")
        );
    }

    #[test]
    fn test_app_config_missing_last_run_version_defaults_empty() {
        // 旧配置缺少 last_run_version：serde(default) 给出空串（= 全新安装，无历史版本）
        let config: AppConfig = serde_json::from_str("{}").unwrap();
        assert_eq!(config.last_run_version, "");
    }

    #[test]
    fn test_app_config_agent_defaults() {
        let config = AppConfig::default();
        assert!(!config.agent_enabled);
        assert!(config.agent_profiles.is_empty());
        assert!(config.agent_consent.is_none());
        assert_eq!(config.agent_result_surface, "floating");
    }

    #[test]
    fn test_app_config_agent_roundtrip() {
        let json = serde_json::json!({
            "agent_enabled": true,
            "agent_profiles": [{
                "id": "p_1",
                "name": "工作号",
                "provider": "zhipu",
                "model": "glm-5.3",
                "api_key": "sk-a",
                "base_url": "",
                "enabled": true
            }],
            "agent_consent": { "version": 1, "accepted_at": "2026-11-01T00:00:00Z", "providers": ["deepseek"] }
        });
        let config: AppConfig = serde_json::from_value(json).unwrap();
        assert!(config.agent_enabled);
        assert_eq!(config.agent_profiles.len(), 1);
        assert_eq!(config.agent_profiles[0].provider, "zhipu");
        assert!(config.agent_profiles[0].enabled);
        assert_eq!(config.agent_profiles[0].api_key, "sk-a");
        assert_eq!(
            config.agent_consent.as_ref().unwrap().providers,
            vec!["deepseek"]
        );

        let roundtrip: AppConfig =
            serde_json::from_str(&serde_json::to_string(&config).unwrap()).unwrap();
        assert_eq!(roundtrip.agent_profiles, config.agent_profiles);
        assert_eq!(roundtrip.agent_consent, config.agent_consent);
    }

    #[test]
    fn test_agent_profile_tolerates_missing_fields() {
        let json = serde_json::json!({
            "agent_profiles": [{ "id": "p_1", "provider": "future-ai" }]
        });
        let config: AppConfig = serde_json::from_value(json).unwrap();
        let profile = &config.agent_profiles[0];
        assert_eq!(profile.provider, "future-ai");
        assert_eq!(profile.model, "");
        assert_eq!(profile.api_key, "");
        assert!(!profile.enabled);
    }

    #[test]
    fn test_agent_defaults_after_serde() {
        let config: AppConfig = serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(!config.agent_enabled);
        assert!(config.agent_profiles.is_empty());
        assert!(config.agent_consent.is_none());
        assert_eq!(config.agent_result_surface, "floating");
    }

    #[test]
    fn test_app_config_ignores_legacy_agent_fields() {
        let json = serde_json::json!({
            "agent_provider": "openai",
            "agent_models": { "openai": "gpt-6-luna" },
            "agent_api_keys": { "openai": "sk-old" },
            "agent_base_url": ""
        });
        let config: AppConfig = serde_json::from_value(json).unwrap();
        assert!(config.agent_profiles.is_empty());
        assert!(config.agent_consent.is_none());
    }

    #[test]
    fn test_openable_extensions_merges_defaults() {
        // 旧配置只含 md/txt：合并后应补齐全部默认扩展名
        let merged = AppConfig::ensure_default_openable_extensions(vec![
            "md".to_string(),
            "txt".to_string(),
        ]);
        for ext in ["md", "markdown", "txt"] {
            assert!(merged.contains(&ext.to_string()), "missing {}", ext);
        }
        // 插件提供的扩展名不再属于默认值
        assert!(!merged.contains(&"excalidraw".to_string()));

        // 已有完整列表时保持不变（无重复）
        let defaults = AppConfig::default().openable_extensions;
        let merged2 = AppConfig::ensure_default_openable_extensions(defaults.clone());
        assert_eq!(merged2, defaults);
    }

    #[test]
    fn test_openable_extensions_strip_legacy_plugin_extensions() {
        // 历史版本自动注入的插件扩展名在加载时清理（大小写与点号不敏感）
        let stripped = AppConfig::strip_legacy_plugin_extensions(vec![
            "md".to_string(),
            ".Excalidraw".to_string(),
            "txt".to_string(),
            "excalidraw".to_string(),
        ]);
        assert_eq!(stripped, vec!["md".to_string(), "txt".to_string()]);

        // 用户自选扩展名不受影响
        let kept =
            AppConfig::strip_legacy_plugin_extensions(vec!["md".to_string(), "kanban".to_string()]);
        assert_eq!(kept, vec!["md".to_string(), "kanban".to_string()]);
    }

    // -----------------------------------------------------------------------
    // FontFamily / EditorFontFamily serde (untagged enums)
    // -----------------------------------------------------------------------

    #[test]
    fn test_font_family_preset_system() {
        let json = "\"system\"";
        let font: FontFamily = serde_json::from_str(json).unwrap();
        assert!(matches!(font, FontFamily::Preset(PresetFontFamily::System)));
    }

    #[test]
    fn test_font_family_custom_string() {
        let json = "\"Roboto Mono\"";
        let font: FontFamily = serde_json::from_str(json).unwrap();
        assert!(matches!(font, FontFamily::Custom(ref s) if s == "Roboto Mono"));
    }

    #[test]
    fn test_font_family_removed_variant_falls_back_to_custom() {
        // After Lxgwwenkai was removed from the enum,
        // "lxgwwenkai" should deserialize as Custom(...)
        let json = "\"lxgwwenkai\"";
        let font: FontFamily = serde_json::from_str(json).unwrap();
        assert!(
            matches!(font, FontFamily::Custom(ref s) if s == "lxgwwenkai"),
            "Removed variant should fall back to Custom, got: {:?}",
            font
        );
    }

    #[test]
    fn test_editor_font_family_preset_system() {
        let json = "\"system\"";
        let font: EditorFontFamily = serde_json::from_str(json).unwrap();
        assert!(matches!(
            font,
            EditorFontFamily::Preset(PresetEditorFontFamily::System)
        ));
    }

    #[test]
    fn test_editor_font_family_preset_mono() {
        let json = "\"mono\"";
        let font: EditorFontFamily = serde_json::from_str(json).unwrap();
        assert!(matches!(
            font,
            EditorFontFamily::Preset(PresetEditorFontFamily::Mono)
        ));
    }

    #[test]
    fn test_editor_font_family_removed_variant_falls_back_to_custom() {
        let json = "\"lxgwwenkai\"";
        let font: EditorFontFamily = serde_json::from_str(json).unwrap();
        assert!(
            matches!(font, EditorFontFamily::Custom(ref s) if s == "lxgwwenkai"),
            "Removed variant should fall back to Custom, got: {:?}",
            font
        );
    }

    #[test]
    fn test_editor_font_family_roundtrip() {
        let cases = vec![
            EditorFontFamily::Preset(PresetEditorFontFamily::System),
            EditorFontFamily::Preset(PresetEditorFontFamily::Mono),
            EditorFontFamily::Custom("Fira Code".into()),
        ];
        for font in cases {
            let json = serde_json::to_value(&font).unwrap();
            let deserialized: EditorFontFamily = serde_json::from_value(json).unwrap();
            assert_eq!(
                format!("{:?}", font),
                format!("{:?}", deserialized),
                "Roundtrip failed for {:?}",
                font
            );
        }
    }

    // -----------------------------------------------------------------------
    // ShortcutsConfig
    // -----------------------------------------------------------------------

    #[test]
    fn test_shortcuts_config_get_shortcut_found() {
        let config = ShortcutsConfig::default();
        let result = config.get_shortcut("save_file");
        assert!(result.is_some());
        assert!(result.unwrap().contains('+'));
    }

    #[test]
    fn test_shortcuts_config_get_shortcut_missing() {
        let config = ShortcutsConfig::default();
        let result = config.get_shortcut("nonexistent_action");
        assert!(result.is_none());
    }

    #[test]
    fn test_shortcuts_config_get_shortcut_null() {
        let config = ShortcutsConfig::default();
        let result = config.get_shortcut("open_folder");
        assert!(result.is_none()); // open_folder has None as value
    }

    #[test]
    fn test_shortcuts_config_serde_missing_version() {
        // Without #[serde(default)], missing version field would fail
        let json = r#"{
            "shortcuts": {"save_file": "Cmd+S"}
        }"#;
        let config: ShortcutsConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.version, 1); // default
        assert_eq!(config.get_shortcut("save_file"), Some("Cmd+S".to_string()));
    }

    #[test]
    fn test_shortcuts_config_serde_roundtrip() {
        let config = ShortcutsConfig::default();
        let json = serde_json::to_value(&config).unwrap();
        let deserialized: ShortcutsConfig = serde_json::from_value(json).unwrap();
        assert_eq!(config.version, deserialized.version);
        assert_eq!(config.shortcuts.len(), deserialized.shortcuts.len());
        for (key, val) in &config.shortcuts {
            assert_eq!(
                deserialized.shortcuts.get(key),
                Some(val),
                "Mismatch for key: {}",
                key
            );
        }
    }

    // -----------------------------------------------------------------------
    // ImageStorageMode / ImageAggregationMode
    // -----------------------------------------------------------------------

    #[test]
    fn test_image_storage_mode_serde() {
        let json = r#""alongside_document""#;
        let mode: ImageStorageMode = serde_json::from_str(json).unwrap();
        assert!(matches!(mode, ImageStorageMode::AlongsideDocument));

        let json = r#""custom_path""#;
        let mode: ImageStorageMode = serde_json::from_str(json).unwrap();
        assert!(matches!(mode, ImageStorageMode::CustomPath));

        let json = r#""picgo""#;
        let mode: ImageStorageMode = serde_json::from_str(json).unwrap();
        assert!(matches!(mode, ImageStorageMode::Picgo));
    }

    #[test]
    fn test_image_aggregation_mode_serde() {
        let json = r#""none""#;
        let mode: ImageAggregationMode = serde_json::from_str(json).unwrap();
        assert!(matches!(mode, ImageAggregationMode::None));

        let json = r#""by_document_name""#;
        let mode: ImageAggregationMode = serde_json::from_str(json).unwrap();
        assert!(matches!(mode, ImageAggregationMode::ByDocumentName));

        let json = r#""by_date""#;
        let mode: ImageAggregationMode = serde_json::from_str(json).unwrap();
        assert!(matches!(mode, ImageAggregationMode::ByDate));
    }

    // -----------------------------------------------------------------------
    // Pending open file helpers
    // -----------------------------------------------------------------------

    #[test]
    fn test_pending_files_operations() {
        // Global state, so test sequentially in one fn
        take_all_pending_open_files(); // clear

        // add & take FIFO
        add_pending_open_file("/tmp/first.md".into());
        add_pending_open_file("/tmp/second.md".into());
        assert_eq!(take_first_pending_open_file(), Some("/tmp/first.md".into()));
        assert_eq!(
            take_first_pending_open_file(),
            Some("/tmp/second.md".into())
        );
        assert_eq!(take_first_pending_open_file(), None);

        // take_all
        add_pending_open_file("/tmp/a.md".into());
        add_pending_open_file("/tmp/b.md".into());
        let all = take_all_pending_open_files();
        assert_eq!(all.len(), 2);
        assert!(all.contains(&"/tmp/a.md".into()));
        assert!(all.contains(&"/tmp/b.md".into()));
        assert_eq!(take_first_pending_open_file(), None);

        // empty state
        take_all_pending_open_files();
        assert_eq!(take_first_pending_open_file(), None);
        assert!(take_all_pending_open_files().is_empty());
    }

    // -----------------------------------------------------------------------
    // Recent items path normalization
    // -----------------------------------------------------------------------

    #[test]
    fn test_normalize_recent_path() {
        // 目录带末尾斜杠（macOS Finder/Dock 打开）应归一化
        assert_eq!(
            normalize_recent_path("/Users/foo/Documents/"),
            "/Users/foo/Documents"
        );
        // 多个末尾分隔符
        assert_eq!(
            normalize_recent_path("/Users/foo/Documents//"),
            "/Users/foo/Documents"
        );
        // Windows 末尾反斜杠
        assert_eq!(
            normalize_recent_path("C:\\Users\\foo\\Documents\\"),
            "C:\\Users\\foo\\Documents"
        );
        // 根目录 / 保持不变
        assert_eq!(normalize_recent_path("/"), "/");
        // Windows 盘符根目录 C:\ 保持不变
        assert_eq!(normalize_recent_path("C:\\"), "C:\\");
        // 无末尾分隔符的路径保持不变
        assert_eq!(
            normalize_recent_path("/Users/foo/Documents"),
            "/Users/foo/Documents"
        );
    }

    // -----------------------------------------------------------------------
    // download_remote_file 的 URL 校验
    // -----------------------------------------------------------------------

    #[test]
    fn accepts_http_and_https_media_urls() {
        assert!(validate_remote_media_url("https://example.com/a.png").is_ok());
        assert!(validate_remote_media_url("http://example.com/a.png").is_ok());
    }

    #[test]
    fn rejects_non_http_media_urls() {
        assert!(validate_remote_media_url("file:///etc/passwd").is_err());
        assert!(validate_remote_media_url("ftp://example.com/a.png").is_err());
        assert!(validate_remote_media_url("data:image/png;base64,AAAA").is_err());
        assert!(validate_remote_media_url("").is_err());
    }
}
