use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThemeMeta {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub theme_type: String,
    #[serde(default)]
    pub is_builtin: bool,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default)]
    pub imported_from: Option<String>,
    #[serde(default)]
    pub imported_at: Option<String>,
    #[serde(default)]
    pub conversion_notes: Option<Vec<String>>,
}

impl ThemeMeta {
    pub fn builtin(id: &str, name: &str) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            version: "1.0.0".to_string(),
            author: Some("Textox".to_string()),
            description: None,
            theme_type: "texto".to_string(),
            is_builtin: true,
            is_default: id == "default",
            imported_from: None,
            imported_at: None,
            conversion_notes: None,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ThemeData {
    pub meta: ThemeMeta,
    pub css: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImportResult {
    pub success: bool,
    pub meta: Option<ThemeMeta>,
    pub error: Option<String>,
    pub is_duplicate: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImportPreviewResult {
    pub success: bool,
    pub css: Option<String>,
    pub suggested_name: Option<String>,
    pub error: Option<String>,
}

pub struct ThemeManager {
    themes_dir: PathBuf,
}

/// 校验主题 ID 是否安全：非空、单一路径组件，禁止 "." / ".." / 路径分隔符 /
/// 绝对路径，防止通过主题 ID 拼路径造成目录穿越。
fn is_safe_theme_id(id: &str) -> bool {
    if id.is_empty() || id == "." || id == ".." {
        return false;
    }
    let mut components = std::path::Path::new(id).components();
    matches!(
        components.next(),
        Some(std::path::Component::Normal(name)) if name == id && components.next().is_none()
    )
}

impl ThemeManager {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let themes_dir = app_data_dir.join("themes");
        Self { themes_dir }
    }

    fn ensure_themes_dir(&self) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.themes_dir)
    }

    pub fn builtin_themes() -> Vec<ThemeMeta> {
        vec![
            ThemeMeta::builtin("default", "Default"),
            ThemeMeta::builtin("pastel", "Pastel"),
            ThemeMeta::builtin("spring", "Spring"),
        ]
    }

    pub fn scan_themes(&self) -> Vec<ThemeMeta> {
        let mut themes = Vec::new();
        if !self.themes_dir.exists() {
            return themes;
        }
        let dir = match std::fs::read_dir(&self.themes_dir) {
            Ok(d) => d,
            Err(_) => return themes,
        };
        for entry in dir {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let meta_path = path.join("theme.json");
            if !meta_path.exists() {
                continue;
            }
            let css_path = path.join("theme.css");
            if !css_path.exists() {
                continue;
            }
            let content = match std::fs::read_to_string(&meta_path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            match serde_json::from_str::<ThemeMeta>(&content) {
                Ok(meta) => themes.push(meta),
                Err(_) => continue,
            }
        }
        themes
    }

    pub fn read_theme(&self, id: &str) -> Option<ThemeData> {
        let theme_dir = self.themes_dir.join(id);
        let meta_path = theme_dir.join("theme.json");
        let css_path = theme_dir.join("theme.css");
        if !meta_path.exists() || !css_path.exists() {
            return None;
        }
        let meta_str = std::fs::read_to_string(&meta_path).ok()?;
        let meta: ThemeMeta = serde_json::from_str(&meta_str).ok()?;
        let css = std::fs::read_to_string(&css_path).ok()?;
        Some(ThemeData { meta, css })
    }

    pub fn write_theme(&self, meta: &ThemeMeta, css: &str) -> std::io::Result<()> {
        self.ensure_themes_dir()?;
        let theme_dir = self.themes_dir.join(&meta.id);
        std::fs::create_dir_all(&theme_dir)?;
        let meta_path = theme_dir.join("theme.json");
        let css_path = theme_dir.join("theme.css");
        let meta_json =
            serde_json::to_string_pretty(meta).map_err(|e| std::io::Error::other(e.to_string()))?;
        std::fs::write(&meta_path, meta_json)?;
        std::fs::write(&css_path, css)?;
        Ok(())
    }

    pub fn delete_theme_dir(&self, id: &str) -> std::io::Result<()> {
        let theme_dir = self.themes_dir.join(id);
        if theme_dir.exists() {
            std::fs::remove_dir_all(&theme_dir)?;
        }
        Ok(())
    }

    pub fn theme_exists(&self, id: &str) -> bool {
        self.themes_dir.join(id).join("theme.json").exists()
    }
}

use tauri::{command, AppHandle, Emitter, Manager};

fn get_theme_manager(app: &AppHandle) -> Result<ThemeManager, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(ThemeManager::new(data_dir))
}

#[command]
pub fn list_themes(app: AppHandle) -> Result<Vec<ThemeMeta>, String> {
    let mut themes = ThemeManager::builtin_themes();
    let manager = get_theme_manager(&app)?;
    #[allow(unused_mut)]
    let mut user_themes = manager.scan_themes();
    #[cfg(feature = "free-version")]
    {
        user_themes.truncate(2);
    }
    for user_theme in user_themes {
        themes.retain(|t| t.id != user_theme.id);
        themes.push(user_theme);
    }
    themes.sort_by(|a, b| {
        b.is_builtin
            .cmp(&a.is_builtin)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(themes)
}

#[command]
pub fn load_user_theme_css(app: AppHandle, id: String) -> Result<String, String> {
    if !is_safe_theme_id(&id) {
        return Err(format!("Invalid theme id: {}", id));
    }
    let manager = get_theme_manager(&app)?;
    if !manager.theme_exists(&id) {
        return Err(format!("Theme '{}' is not a user theme", id));
    }
    match manager.read_theme(&id) {
        Some(data) => Ok(data.css),
        None => Err(format!("Failed to read theme '{}'", id)),
    }
}

#[command]
pub fn delete_theme(app: AppHandle, id: String) -> Result<(), String> {
    if !is_safe_theme_id(&id) {
        return Err(format!("Invalid theme id: {}", id));
    }
    let manager = get_theme_manager(&app)?;
    if !manager.theme_exists(&id) {
        return Err(format!("Theme '{}' not found", id));
    }
    manager
        .delete_theme_dir(&id)
        .map_err(|e| format!("Failed to delete theme: {}", e))?;
    // 同步清理该主题的快速编辑覆盖配置
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    QuickSettingsStore::new(data_dir)
        .remove(&id)
        .map_err(|e| format!("Failed to remove theme quick settings: {}", e))?;
    Ok(())
}

#[cfg(not(feature = "free-version"))]
#[command]
pub fn preview_theme_css(app: AppHandle, css: String) -> Result<(), String> {
    app.emit("theme-css-preview", css)
        .map_err(|e| format!("Failed to emit preview event: {}", e))
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SaveThemeRequest {
    pub id: String,
    pub name: String,
    pub css: String,
}

/// 主题"快速编辑"覆盖配置（与 theme.css 解耦，独立 JSON 持久化）。
/// 所有字段均为可选：为 None 时表示跟随主题 CSS 自身取值。
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ThemeQuickSettings {
    /// 亮色模式下 --breathe-color（未保存标记颜色）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub breathe_light: Option<String>,
    /// 暗色模式下 --breathe-color
    #[serde(skip_serializing_if = "Option::is_none")]
    pub breathe_dark: Option<String>,
    /// 代码块亮色主题（--code-editor-theme-light）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_editor_theme_light: Option<String>,
    /// 代码块暗色主题（--code-editor-theme-dark）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_editor_theme_dark: Option<String>,
    /// 源码模式亮色主题（--source-code-theme-light）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_code_theme_light: Option<String>,
    /// 源码模式暗色主题（--source-code-theme-dark）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_code_theme_dark: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(default)]
pub struct QuickSettingsFile {
    pub version: i32,
    pub themes: HashMap<String, ThemeQuickSettings>,
}

impl Default for QuickSettingsFile {
    fn default() -> Self {
        Self {
            version: 1,
            themes: HashMap::new(),
        }
    }
}

/// quick-settings.json 的读写封装：按主题 id 保存覆盖值，放在应用数据目录顶层，
/// 与 themes/ 下的主题 CSS 文件完全解耦。
pub struct QuickSettingsStore {
    path: PathBuf,
}

impl QuickSettingsStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            path: app_data_dir.join("quick-settings.json"),
        }
    }

    /// 读取配置。文件缺失、内容损坏或缺少新字段时都回退为默认值，
    /// 保证旧版本升级 / 配置文件异常时应用仍可正常启动。
    fn load(&self) -> QuickSettingsFile {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default()
    }

    pub fn get(&self, theme_id: &str) -> Option<ThemeQuickSettings> {
        self.load().themes.get(theme_id).cloned()
    }

    pub fn set(&self, theme_id: &str, settings: ThemeQuickSettings) -> std::io::Result<()> {
        let mut file = self.load();
        file.themes.insert(theme_id.to_string(), settings);
        self.write(&file)
    }

    pub fn remove(&self, theme_id: &str) -> std::io::Result<()> {
        let mut file = self.load();
        if file.themes.remove(theme_id).is_none() {
            return Ok(());
        }
        self.write(&file)
    }

    fn write(&self, file: &QuickSettingsFile) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json =
            serde_json::to_string_pretty(file).map_err(|e| std::io::Error::other(e.to_string()))?;
        std::fs::write(&self.path, json)
    }
}

#[command]
pub fn save_theme_css(app: AppHandle, request: SaveThemeRequest) -> Result<ThemeMeta, String> {
    if !is_safe_theme_id(&request.id) {
        return Err(format!("Invalid theme id: {}", request.id));
    }
    let manager = get_theme_manager(&app)?;

    let meta = ThemeMeta {
        id: request.id.clone(),
        name: request.name,
        version: "1.0.0".to_string(),
        author: None,
        description: None,
        theme_type: "texto".to_string(),
        is_builtin: false,
        is_default: false,
        imported_from: None,
        imported_at: Some(chrono::Utc::now().to_rfc3339()),
        conversion_notes: None,
    };

    manager
        .write_theme(&meta, &request.css)
        .map_err(|e| format!("Failed to save theme: {}", e))?;

    Ok(meta)
}

#[command]
pub fn get_theme_quick_settings(
    app: AppHandle,
    theme_id: String,
) -> Result<Option<ThemeQuickSettings>, String> {
    if !is_safe_theme_id(&theme_id) {
        return Err(format!("Invalid theme id: {}", theme_id));
    }
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(QuickSettingsStore::new(data_dir).get(&theme_id))
}

#[command]
pub fn set_theme_quick_settings(
    app: AppHandle,
    theme_id: String,
    settings: ThemeQuickSettings,
) -> Result<(), String> {
    if !is_safe_theme_id(&theme_id) {
        return Err(format!("Invalid theme id: {}", theme_id));
    }
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    QuickSettingsStore::new(data_dir)
        .set(&theme_id, settings)
        .map_err(|e| format!("Failed to save theme quick settings: {}", e))
}

#[cfg(not(feature = "free-version"))]
#[command]
pub async fn export_theme(app: AppHandle, id: String) -> Result<String, String> {
    let manager = get_theme_manager(&app)?;
    let data = manager
        .read_theme(&id)
        .ok_or_else(|| format!("Theme '{}' not found", id))?;

    let file_path = app
        .dialog()
        .file()
        .add_filter("CSS Files", &["css"])
        .set_file_name(format!("{}.css", data.meta.id))
        .blocking_save_file();

    match file_path {
        Some(path) => {
            let std_path = path
                .as_path()
                .ok_or_else(|| "Invalid file path".to_string())?
                .to_path_buf();
            let path_str = std_path.to_string_lossy().to_string();
            std::fs::write(&std_path, &data.css)
                .map_err(|e| format!("Failed to export theme: {}", e))?;
            Ok(path_str)
        }
        None => Err("Export cancelled".to_string()),
    }
}

#[cfg(not(feature = "free-version"))]
pub mod import_commands {
    use super::*;
    use crate::theme_converter;
    use tauri_plugin_dialog::DialogExt;

    #[command]
    pub async fn import_theme(app: AppHandle) -> Result<ImportResult, String> {
        let maybe_files = app
            .dialog()
            .file()
            .add_filter("CSS Theme Files", &["css"])
            .blocking_pick_files();

        let files: Vec<std::path::PathBuf> = match maybe_files {
            Some(f) => f
                .into_iter()
                .map(|fp| fp.as_path().map(|p| p.to_path_buf()).unwrap_or_default())
                .filter(|p| !p.as_os_str().is_empty())
                .collect(),
            None => {
                return Ok(ImportResult {
                    success: false,
                    meta: None,
                    error: Some("No file selected".to_string()),
                    is_duplicate: false,
                });
            }
        };

        let manager = get_theme_manager(&app)?;
        let mut results: Vec<ImportResult> = Vec::new();

        for file_path in &files {
            let path_str = file_path.to_string_lossy().to_string();
            let result = process_single_import(&manager, &path_str);
            results.push(result);
        }

        // 单文件导入直接返回该文件的结果；多文件导入聚合统计
        if let Some(result) = (results.len() == 1).then(|| results[0].clone()) {
            return Ok(result);
        }
        let success_count = results.iter().filter(|r| r.success).count();
        Ok(ImportResult {
            success: success_count > 0,
            meta: None,
            error: Some(format!(
                "Imported {}/{} themes successfully",
                success_count,
                results.len()
            )),
            is_duplicate: false,
        })
    }

    #[command]
    pub async fn import_theme_files(
        app: AppHandle,
        paths: Vec<String>,
    ) -> Result<Vec<ImportResult>, String> {
        let manager = get_theme_manager(&app)?;
        let mut results = Vec::new();
        for path in &paths {
            let result = process_single_import(&manager, path);
            results.push(result);
        }
        Ok(results)
    }

    fn process_single_import(manager: &ThemeManager, file_path: &str) -> ImportResult {
        let css = match std::fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(e) => {
                return ImportResult {
                    success: false,
                    meta: None,
                    error: Some(format!("Failed to read file: {}", e)),
                    is_duplicate: false,
                }
            }
        };

        if let Err(e) = theme_converter::validate_css_security(&css) {
            return ImportResult {
                success: false,
                meta: None,
                error: Some(e),
                is_duplicate: false,
            };
        }

        let filename = std::path::Path::new(file_path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown.css");

        let is_converted = theme_converter::detect_theme_format(&css);
        let theme_type = if is_converted { "converted" } else { "texto" };

        let (final_css, conversion_notes) = if is_converted {
            theme_converter::convert_theme_css(&css)
        } else {
            (css, Vec::new())
        };

        let mut meta = theme_converter::create_meta_from_file(filename, theme_type);
        if !conversion_notes.is_empty() {
            meta.conversion_notes = Some(conversion_notes);
        }

        let is_duplicate = manager.theme_exists(&meta.id);
        if is_duplicate {
            return ImportResult {
                success: false,
                meta: Some(meta),
                error: None,
                is_duplicate: true,
            };
        }

        match manager.write_theme(&meta, &final_css) {
            Ok(()) => ImportResult {
                success: true,
                meta: Some(meta),
                error: None,
                is_duplicate: false,
            },
            Err(e) => ImportResult {
                success: false,
                meta: None,
                error: Some(format!("Failed to save theme: {}", e)),
                is_duplicate: false,
            },
        }
    }

    #[command]
    pub async fn import_with_overwrite(
        app: AppHandle,
        file_path: String,
        overwrite: bool,
    ) -> Result<ImportResult, String> {
        let manager = get_theme_manager(&app)?;

        let css = std::fs::read_to_string(&file_path)
            .map_err(|e| format!("Failed to read file: {}", e))?;

        theme_converter::validate_css_security(&css)?;

        let filename = std::path::Path::new(&file_path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown.css");

        let is_converted = theme_converter::detect_theme_format(&css);
        let theme_type = if is_converted { "converted" } else { "texto" };

        let (final_css, conversion_notes) = if is_converted {
            theme_converter::convert_theme_css(&css)
        } else {
            (css, Vec::new())
        };

        let mut meta = theme_converter::create_meta_from_file(filename, theme_type);
        if !conversion_notes.is_empty() {
            meta.conversion_notes = Some(conversion_notes);
        }

        let is_duplicate = manager.theme_exists(&meta.id);

        if is_duplicate && !overwrite {
            return Ok(ImportResult {
                success: false,
                meta: Some(meta),
                error: None,
                is_duplicate: true,
            });
        }

        manager
            .write_theme(&meta, &final_css)
            .map_err(|e| format!("Failed to save theme: {}", e))?;

        Ok(ImportResult {
            success: true,
            meta: Some(meta),
            error: None,
            is_duplicate: false,
        })
    }

    #[command]
    pub async fn preview_import(app: AppHandle) -> Result<ImportPreviewResult, String> {
        let maybe_files = app
            .dialog()
            .file()
            .add_filter("CSS Theme Files", &["css"])
            .blocking_pick_files();

        let files: Vec<std::path::PathBuf> = match maybe_files {
            Some(f) => f
                .into_iter()
                .map(|fp| fp.as_path().map(|p| p.to_path_buf()).unwrap_or_default())
                .filter(|p| !p.as_os_str().is_empty())
                .collect(),
            None => {
                return Ok(ImportPreviewResult {
                    success: false,
                    css: None,
                    suggested_name: None,
                    error: Some("No file selected".to_string()),
                });
            }
        };

        if files.is_empty() {
            return Ok(ImportPreviewResult {
                success: false,
                css: None,
                suggested_name: None,
                error: Some("No file selected".to_string()),
            });
        }

        let file_path = &files[0];
        let path_str = file_path.to_string_lossy().to_string();
        let css = std::fs::read_to_string(&path_str)
            .map_err(|e| format!("Failed to read file: {}", e))?;

        theme_converter::validate_css_security(&css)?;

        let filename = std::path::Path::new(&path_str)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown.css");

        let is_converted = theme_converter::detect_theme_format(&css);
        let theme_type = if is_converted { "converted" } else { "texto" };

        let (final_css, _conversion_notes) = if is_converted {
            theme_converter::convert_theme_css(&css)
        } else {
            (css, Vec::new())
        };

        let meta = theme_converter::create_meta_from_file(filename, theme_type);
        let suggested_name = meta.name;

        Ok(ImportPreviewResult {
            success: true,
            css: Some(final_css),
            suggested_name: Some(suggested_name),
            error: None,
        })
    }

    #[command]
    pub fn convert_theme(file_path: String) -> Result<ThemeData, String> {
        let css = std::fs::read_to_string(&file_path)
            .map_err(|e| format!("Failed to read file: {}", e))?;

        if !theme_converter::detect_theme_format(&css) {
            return Err("File does not appear to be a supported theme format".to_string());
        }

        let (converted_css, notes) = theme_converter::convert_theme_css(&css);

        let filename = std::path::Path::new(&file_path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("imported-theme.css");

        let mut meta = theme_converter::create_meta_from_file(filename, "converted");
        meta.conversion_notes = Some(notes);

        Ok(ThemeData {
            meta,
            css: converted_css,
        })
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_safe_theme_id_accepts_single_component() {
        assert!(is_safe_theme_id("default"));
        assert!(is_safe_theme_id("my-theme"));
        assert!(is_safe_theme_id("theme_2024"));
        assert!(is_safe_theme_id("主题"));
        assert!(is_safe_theme_id("123e4567-e89b-12d3-a456-426614174000"));
    }

    #[test]
    fn test_is_safe_theme_id_rejects_path_traversal() {
        assert!(!is_safe_theme_id(""));
        assert!(!is_safe_theme_id("."));
        assert!(!is_safe_theme_id(".."));
        assert!(!is_safe_theme_id("../"));
        assert!(!is_safe_theme_id("../../etc"));
        assert!(!is_safe_theme_id("a/b"));
        assert!(!is_safe_theme_id("/abs"));
        // 反斜杠在 Unix 上不是路径分隔符，仅 Windows 拒绝；此处不断言平台相关行为
        assert!(is_safe_theme_id("..hidden"));
    }

    #[test]
    fn test_theme_meta_builtin_default() {
        let meta = ThemeMeta::builtin("default", "Default");
        assert_eq!(meta.id, "default");
        assert_eq!(meta.name, "Default");
        assert_eq!(meta.version, "1.0.0");
        assert!(meta.is_builtin);
        assert!(meta.is_default);
        assert_eq!(meta.theme_type, "texto");
    }

    #[test]
    fn test_theme_meta_builtin_non_default() {
        let meta = ThemeMeta::builtin("pastel", "Pastel");
        assert_eq!(meta.id, "pastel");
        assert!(!meta.is_default);
    }

    #[test]
    fn test_theme_meta_serde_roundtrip() {
        let meta = ThemeMeta::builtin("test", "Test Theme");
        let json = serde_json::to_value(&meta).unwrap();
        let deserialized: ThemeMeta = serde_json::from_value(json).unwrap();
        assert_eq!(deserialized.id, meta.id);
        assert_eq!(deserialized.name, meta.name);
        assert_eq!(deserialized.version, meta.version);
        assert_eq!(deserialized.is_builtin, meta.is_builtin);
    }

    #[test]
    fn test_theme_meta_serde_missing_optional_fields() {
        let json = r#"{"id": "test", "name": "Test", "version": "1.0.0"}"#;
        let meta: ThemeMeta = serde_json::from_str(json).unwrap();
        assert_eq!(meta.id, "test");
        assert_eq!(meta.name, "Test");
        assert_eq!(meta.theme_type, ""); // default
        assert!(!meta.is_builtin); // default
        assert!(meta.author.is_none());
        assert!(meta.description.is_none());
    }

    #[test]
    fn test_theme_meta_serde_unknown_fields_ignored() {
        let json = r#"{
            "id": "test",
            "name": "Test",
            "version": "1.0.0",
            "unknownField": "should be ignored"
        }"#;
        let meta: ThemeMeta = serde_json::from_str(json).unwrap();
        assert_eq!(meta.id, "test");
    }

    #[test]
    fn test_builtin_themes_count() {
        let themes = ThemeManager::builtin_themes();
        assert_eq!(themes.len(), 3);
        let ids: Vec<&str> = themes.iter().map(|t| t.id.as_str()).collect();
        assert!(ids.contains(&"default"));
        assert!(ids.contains(&"pastel"));
        assert!(ids.contains(&"spring"));
    }

    #[test]
    fn test_theme_data_serde() {
        let meta = ThemeMeta::builtin("test", "Test");
        let data = ThemeData {
            meta,
            css: ":root { --bg: white; }".into(),
        };
        let json = serde_json::to_value(&data).unwrap();
        assert!(json.get("meta").is_some());
        assert!(json.get("css").is_some());
        assert_eq!(json["css"].as_str().unwrap(), ":root { --bg: white; }");
    }

    #[test]
    fn test_import_result_serde() {
        let result = ImportResult {
            success: true,
            meta: Some(ThemeMeta::builtin("imported", "Imported")),
            error: None,
            is_duplicate: false,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["success"].as_bool(), Some(true));
        // snake_case (no rename attribute on ImportResult)
        assert_eq!(json["is_duplicate"].as_bool(), Some(false));
        assert!(json.get("meta").is_some());
        // roundtrip
        let deserialized: ImportResult = serde_json::from_value(json).unwrap();
        assert!(deserialized.success);
        assert!(!deserialized.is_duplicate);
    }

    #[test]
    fn test_import_preview_result_serde() {
        let result = ImportPreviewResult {
            success: true,
            css: Some("body { color: red; }".into()),
            suggested_name: Some("My Theme".into()),
            error: None,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["success"].as_bool(), Some(true));
        // snake_case (no rename attribute on this struct)
        assert_eq!(json["suggested_name"].as_str(), Some("My Theme"));
        // roundtrip
        let deserialized: ImportPreviewResult = serde_json::from_value(json).unwrap();
        assert_eq!(deserialized.suggested_name.as_deref(), Some("My Theme"));
    }

    #[test]
    fn test_theme_quick_settings_default_and_serde() {
        let settings = ThemeQuickSettings::default();
        assert_eq!(settings.breathe_light, None);
        assert_eq!(settings.code_editor_theme_light, None);

        // 未设置的字段不应写出 null，避免前端把 null 当成覆盖值
        let serialized = serde_json::to_value(ThemeQuickSettings {
            breathe_light: Some("oklch(0.646 0.222 41.116)".into()),
            ..ThemeQuickSettings::default()
        })
        .unwrap();
        assert_eq!(
            serialized["breatheLight"].as_str(),
            Some("oklch(0.646 0.222 41.116)")
        );
        assert!(serialized.get("breatheDark").is_none());

        let json = r#"{
            "breatheLight": "oklch(0.646 0.222 41.116)",
            "codeEditorThemeDark": "dracula"
        }"#;
        let parsed: ThemeQuickSettings = serde_json::from_str(json).unwrap();
        assert_eq!(
            parsed.breathe_light.as_deref(),
            Some("oklch(0.646 0.222 41.116)")
        );
        assert_eq!(parsed.code_editor_theme_dark.as_deref(), Some("dracula"));
        assert_eq!(parsed.breathe_dark, None);
    }

    #[test]
    fn test_quick_settings_store_roundtrip() {
        let dir = std::env::temp_dir().join(format!("texto-quick-settings-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = QuickSettingsStore::new(dir.clone());

        assert_eq!(store.get("default"), None);

        let settings = ThemeQuickSettings {
            breathe_light: Some("oklch(0.9 0.1 60)".into()),
            source_code_theme_dark: Some("vscodeDark".into()),
            ..ThemeQuickSettings::default()
        };
        store.set("my-theme", settings.clone()).unwrap();
        assert_eq!(store.get("my-theme"), Some(settings));

        store.remove("my-theme").unwrap();
        assert_eq!(store.get("my-theme"), None);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_quick_settings_store_missing_file_returns_none() {
        let dir = std::env::temp_dir().join(format!(
            "texto-quick-settings-missing-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let store = QuickSettingsStore::new(dir.join("nested").join("quick-settings.json"));

        // 文件不存在：读取返回 None，首次写入应自动创建目录且不报错
        assert_eq!(store.get("default"), None);
        store
            .set(
                "default",
                ThemeQuickSettings {
                    breathe_light: Some("oklch(0.9 0.15 85 / 0.35)".into()),
                    ..ThemeQuickSettings::default()
                },
            )
            .unwrap();
        assert_eq!(
            store.get("default").unwrap().breathe_light.as_deref(),
            Some("oklch(0.9 0.15 85 / 0.35)")
        );

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_quick_settings_store_corrupt_file_falls_back_to_defaults() {
        let dir = std::env::temp_dir().join(format!(
            "texto-quick-settings-corrupt-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("quick-settings.json");
        std::fs::write(&path, "{\"themes\": not-json").unwrap();
        let store = QuickSettingsStore::new(dir.clone());

        // 损坏文件不能导致启动/读取崩溃，回退为空配置后可继续写入自愈
        assert_eq!(store.get("default"), None);
        store.set("default", ThemeQuickSettings::default()).unwrap();
        assert_eq!(store.get("default"), Some(ThemeQuickSettings::default()));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_quick_settings_store_partial_old_file_parses() {
        let dir = std::env::temp_dir().join(format!(
            "texto-quick-settings-partial-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("quick-settings.json");
        // 模拟旧版本/半成品配置：只有部分字段，缺字段应默认 None 而不是报错
        std::fs::write(
            &path,
            r##"{"version":1,"futureTopLevel":true,"themes":{"my-theme":{"highlightColor":"#ffd700","futureThemeField":"x"}}}"##,
        )
        .unwrap();
        let store = QuickSettingsStore::new(dir.clone());

        let settings = store.get("my-theme").unwrap();
        assert_eq!(settings.breathe_light, None);
        assert_eq!(settings.code_editor_theme_dark, None);

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
