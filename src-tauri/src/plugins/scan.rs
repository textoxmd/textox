use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::paths::{is_valid_plugin_id, plugins_root};

/// `manifest.json` 大小上限：超出即视为不可加载（防止超大文件拖垮扫描）。
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

/// 出厂播种记录：该 id 当前落盘版本的来源。
///
/// `origin` 为 `seed`（出厂播种，卸载后留墓碑、允许随资源升级）或 `user`（用户手动安装，
/// 播种永不覆盖）。字段刻意不加 `#[serde(default)]`：宁可整条记录解析失败回退「未播种」，
/// 也不要出现没有来源的半截记录。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SeedRecord {
    pub version: String,
    /// `seed`（出厂播种）或 `user`（手动安装）
    pub origin: String,
}

/// `<plugins>/plugins.json`：安全模式 + 启用列表 + 播种/卸载记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PluginStateFile {
    pub safe_mode: bool,
    pub enabled: Vec<String>,
    /// 已播种/已手动安装的版本；缺字段的旧文件解析为空表。
    #[serde(default)]
    pub seeded: std::collections::BTreeMap<String, SeedRecord>,
    /// 出厂插件被用户卸载后的墓碑：清掉后才允许重新播种（`restore`）。
    #[serde(default)]
    pub uninstalled: Vec<String>,
}

impl Default for PluginStateFile {
    fn default() -> Self {
        Self {
            safe_mode: true,
            enabled: Vec::new(),
            seeded: std::collections::BTreeMap::new(),
            uninstalled: Vec::new(),
        }
    }
}

/// 扫描结果条目。`error` 非空表示该目录不可加载（manifest 缺失/坏、id 与目录名不一致）。
#[derive(Debug, Clone, Serialize)]
pub struct InstalledPlugin {
    pub id: String,
    pub dir: String,
    pub manifest: serde_json::Value,
    /// 反映 `plugins.json` 的持久化开关，与 `error` 无关；manifest 损坏时可能仍为 `true`。
    pub enabled: bool,
    pub error: Option<String>,
}

pub fn state_path(root: &Path) -> PathBuf {
    root.join("plugins.json")
}

/// 读状态：文件缺失静默回退默认值；IO 失败或 JSON 损坏时告警后回退默认值。
pub fn read_state_from(path: &Path) -> PluginStateFile {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        // 首次运行本就没有该文件：静默用默认值
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return PluginStateFile::default();
        }
        Err(error) => {
            log::warn!("read plugin state {}: {error}", path.display());
            return PluginStateFile::default();
        }
    };
    match serde_json::from_str(&text) {
        Ok(state) => state,
        Err(error) => {
            log::warn!("parse plugin state {}: {error}", path.display());
            PluginStateFile::default()
        }
    }
}

pub fn write_state_to(path: &Path, state: &PluginStateFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("create state dir: {error}"))?;
    }
    let text =
        serde_json::to_string_pretty(state).map_err(|error| format!("serialize state: {error}"))?;
    let tmp = path.with_extension("json.tmp");
    let mut file = std::fs::File::create(&tmp).map_err(|error| format!("write state: {error}"))?;
    file.write_all(text.as_bytes())
        .map_err(|error| format!("write state: {error}"))?;
    // 先落盘再 rename：否则崩溃后可能留下 0 字节 plugins.json，等于全部插件被禁用
    file.sync_all()
        .map_err(|error| format!("sync state: {error}"))?;
    drop(file);
    std::fs::rename(&tmp, path).map_err(|error| format!("replace state: {error}"))
}

/// 按「保留式去重」写启用状态：先移除同 id 条目，仅在启用时重新追加。
fn apply_enabled(state: &mut PluginStateFile, id: String, enabled: bool) {
    state.enabled.retain(|candidate| candidate != &id);
    if enabled {
        state.enabled.push(id);
    }
}

/// 启用/停用某个插件并落盘（命令体与测试共用的唯一执行路径）。
pub fn set_enabled_in(root: &Path, id: &str, enabled: bool) -> Result<PluginStateFile, String> {
    if !is_valid_plugin_id(id) {
        return Err(format!("invalid plugin id: {id}"));
    }
    let path = state_path(root);
    let mut state = read_state_from(&path);
    apply_enabled(&mut state, id.to_string(), enabled);
    write_state_to(&path, &state)?;
    Ok(state)
}

/// 切换安全模式并落盘（保留既有的启用列表）。
pub fn set_safe_mode_in(root: &Path, safe_mode: bool) -> Result<PluginStateFile, String> {
    let path = state_path(root);
    let mut state = read_state_from(&path);
    state.safe_mode = safe_mode;
    write_state_to(&path, &state)?;
    Ok(state)
}

/// 读状态 + 扫描插件根：install 命令与 CLI 共用的唯一入口。
pub fn scan(root: &Path) -> Result<Vec<InstalledPlugin>, String> {
    scan_dir(root, &read_state_from(&state_path(root)))
}

/// 扫描插件根目录。非目录、非法 id 目录直接跳过；manifest 有问题也入列，用 `error` 说明。
pub fn scan_dir(root: &Path, state: &PluginStateFile) -> Result<Vec<InstalledPlugin>, String> {
    let entries = std::fs::read_dir(root).map_err(|error| format!("read plugins dir: {error}"))?;
    let mut plugins = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("read plugins dir entry: {error}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(id) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !is_valid_plugin_id(id) {
            continue;
        }
        let enabled = state.enabled.iter().any(|candidate| candidate == id);
        let manifest_path = path.join("manifest.json");
        let (manifest, error) = match std::fs::metadata(&manifest_path) {
            Ok(meta) if meta.len() > MAX_MANIFEST_BYTES => (
                serde_json::Value::Null,
                Some(format!("manifest.json too large: {} bytes", meta.len())),
            ),
            _ => match std::fs::read_to_string(&manifest_path) {
                Ok(text) => match serde_json::from_str::<serde_json::Value>(&text) {
                    Ok(value) => {
                        let declared = value
                            .get("id")
                            .and_then(|id| id.as_str())
                            .unwrap_or_default();
                        if declared == id {
                            (value, None)
                        } else {
                            let error =
                                format!("manifest id `{declared}` does not match directory `{id}`");
                            (value, Some(error))
                        }
                    }
                    Err(error) => (
                        serde_json::Value::Null,
                        Some(format!("invalid manifest.json: {error}")),
                    ),
                },
                Err(error) => (
                    serde_json::Value::Null,
                    Some(format!("missing manifest.json: {error}")),
                ),
            },
        };
        plugins.push(InstalledPlugin {
            id: id.to_string(),
            dir: path.to_string_lossy().into_owned(),
            manifest,
            enabled,
            error,
        });
    }
    plugins.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(plugins)
}

#[tauri::command]
pub fn plugin_scan(app: tauri::AppHandle) -> Result<Vec<InstalledPlugin>, String> {
    let root = plugins_root(&app)?;
    let state = read_state_from(&state_path(&root));
    scan_dir(&root, &state)
}

#[tauri::command]
pub fn plugin_get_state(app: tauri::AppHandle) -> Result<PluginStateFile, String> {
    let root = plugins_root(&app)?;
    Ok(read_state_from(&state_path(&root)))
}

#[tauri::command]
pub fn plugin_set_enabled(
    app: tauri::AppHandle,
    id: String,
    enabled: bool,
) -> Result<PluginStateFile, String> {
    let root = plugins_root(&app)?;
    set_enabled_in(&root, &id, enabled)
}

#[tauri::command]
pub fn plugin_set_safe_mode(
    app: tauri::AppHandle,
    safe_mode: bool,
) -> Result<PluginStateFile, String> {
    let root = plugins_root(&app)?;
    set_safe_mode_in(&root, safe_mode)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::test_support::TempRoot;

    fn write_manifest(dir: &Path, id: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(
            dir.join("manifest.json"),
            format!(r#"{{"id":"{id}","name":"Demo","version":"1.0.0","minAppVersion":"2.3.8","author":{{"name":"Textox"}}}}"#),
        )
        .unwrap();
    }

    #[test]
    fn state_roundtrips_and_falls_back_to_defaults() {
        let root = TempRoot::new("textox-scan");
        let path = state_path(root.path());

        assert!(read_state_from(&path).safe_mode);
        assert!(read_state_from(&path).enabled.is_empty());

        let state = PluginStateFile {
            safe_mode: false,
            enabled: vec!["app.textox.demo".to_string()],
            ..PluginStateFile::default()
        };
        write_state_to(&path, &state).unwrap();

        let read = read_state_from(&path);
        assert!(!read.safe_mode);
        assert_eq!(read.enabled, vec!["app.textox.demo".to_string()]);
        assert!(!path.with_extension("json.tmp").exists());

        std::fs::write(&path, "{ not json").unwrap();
        assert!(read_state_from(&path).safe_mode);
    }

    #[test]
    fn empty_state_object_uses_defaults() {
        let empty: PluginStateFile = serde_json::from_str("{}").unwrap();
        assert!(empty.safe_mode);
        assert!(empty.enabled.is_empty());
        assert!(empty.seeded.is_empty());
        assert!(empty.uninstalled.is_empty());
    }

    /// 旧版 `plugins.json`（只有 `safe_mode` / `enabled`）必须继续可读。
    #[test]
    fn legacy_state_without_seed_fields_still_parses() {
        let legacy: PluginStateFile =
            serde_json::from_str(r#"{"safe_mode":false,"enabled":["app.textox.demo"]}"#).unwrap();
        assert!(!legacy.safe_mode);
        assert_eq!(legacy.enabled, vec!["app.textox.demo".to_string()]);
        assert!(legacy.seeded.is_empty());
        assert!(legacy.uninstalled.is_empty());
    }

    #[test]
    fn seed_records_roundtrip_through_state_file() {
        let root = TempRoot::new("textox-scan");
        let path = state_path(root.path());
        let mut state = PluginStateFile::default();
        state.seeded.insert(
            "app.textox.demo".to_string(),
            SeedRecord {
                version: "1.2.3".to_string(),
                origin: "seed".to_string(),
            },
        );
        state.uninstalled.push("app.textox.gone".to_string());

        write_state_to(&path, &state).unwrap();

        let read = read_state_from(&path);
        assert_eq!(
            read.seeded.get("app.textox.demo"),
            Some(&SeedRecord {
                version: "1.2.3".to_string(),
                origin: "seed".to_string(),
            })
        );
        assert_eq!(read.uninstalled, vec!["app.textox.gone".to_string()]);
    }

    #[test]
    fn partial_state_keeps_default_for_safe_mode() {
        let partial: PluginStateFile =
            serde_json::from_str(r#"{"enabled":["app.textox.demo"]}"#).unwrap();
        assert!(partial.safe_mode);
        assert_eq!(partial.enabled, vec!["app.textox.demo".to_string()]);
    }

    #[test]
    fn keeps_enabled_flag_even_when_manifest_is_broken() {
        let root = TempRoot::new("textox-scan");
        std::fs::create_dir_all(root.path().join("app.textox.broken")).unwrap();
        std::fs::write(
            root.path().join("app.textox.broken/manifest.json"),
            "{ not json",
        )
        .unwrap();

        let state = PluginStateFile {
            safe_mode: true,
            enabled: vec!["app.textox.broken".to_string()],
            ..PluginStateFile::default()
        };
        let scanned = scan_dir(root.path(), &state).unwrap();
        let broken = scanned
            .iter()
            .find(|plugin| plugin.id == "app.textox.broken")
            .unwrap();
        assert!(broken.enabled);
        assert!(broken.error.is_some());
    }

    #[test]
    fn scans_directories_and_reports_problems() {
        let root = TempRoot::new("textox-scan");

        write_manifest(&root.path().join("app.textox.good"), "app.textox.good");
        write_manifest(&root.path().join("app.textox.mismatch"), "app.textox.other");
        std::fs::create_dir_all(root.path().join("app.textox.broken")).unwrap();
        std::fs::write(
            root.path().join("app.textox.broken/manifest.json"),
            "{ not json",
        )
        .unwrap();
        std::fs::create_dir_all(root.path().join("Not_A_Plugin")).unwrap();
        std::fs::write(root.path().join("app.textox.file"), "x").unwrap();
        std::fs::create_dir_all(root.path().join("app.textox.nomanifest")).unwrap();

        let state = PluginStateFile {
            safe_mode: true,
            enabled: vec!["app.textox.good".to_string()],
            ..PluginStateFile::default()
        };
        let scanned = scan_dir(root.path(), &state).unwrap();
        let ids: Vec<&str> = scanned.iter().map(|plugin| plugin.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                "app.textox.broken",
                "app.textox.good",
                "app.textox.mismatch",
                "app.textox.nomanifest"
            ]
        );
        let mut sorted = ids.clone();
        sorted.sort();
        assert_eq!(ids, sorted);

        let good = scanned
            .iter()
            .find(|plugin| plugin.id == "app.textox.good")
            .unwrap();
        assert!(good.error.is_none());
        assert!(good.enabled);
        assert_eq!(
            good.manifest.get("name").and_then(|v| v.as_str()),
            Some("Demo")
        );

        let mismatch = scanned
            .iter()
            .find(|plugin| plugin.id == "app.textox.mismatch")
            .unwrap();
        assert!(mismatch
            .error
            .as_deref()
            .unwrap()
            .contains("does not match"));

        let broken = scanned
            .iter()
            .find(|plugin| plugin.id == "app.textox.broken")
            .unwrap();
        assert!(broken
            .error
            .as_deref()
            .unwrap()
            .contains("invalid manifest.json"));

        let missing = scanned
            .iter()
            .find(|plugin| plugin.id == "app.textox.nomanifest")
            .unwrap();
        assert!(missing
            .error
            .as_deref()
            .unwrap()
            .contains("missing manifest.json"));
    }

    #[test]
    fn writes_state_into_a_missing_directory() {
        let root = TempRoot::new("textox-scan");
        let path = root.path().join("nested").join("plugins.json");
        let state = PluginStateFile {
            safe_mode: true,
            enabled: vec!["app.textox.hello".to_string()],
            ..PluginStateFile::default()
        };

        write_state_to(&path, &state).expect("write into missing directory");

        assert!(path.exists());
        assert_eq!(
            read_state_from(&path).enabled,
            vec!["app.textox.hello".to_string()]
        );
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn rejects_invalid_ids_when_enabling() {
        let root = TempRoot::new("textox-scan");
        let error = set_enabled_in(root.path(), "Not_A_Plugin", true).unwrap_err();
        assert!(error.contains("invalid plugin id"), "{error}");
        // 非法 id 不得落盘
        assert!(!state_path(root.path()).exists());
    }

    #[test]
    fn persists_enabled_and_safe_mode_through_the_pure_entry_points() {
        let root = TempRoot::new("textox-scan");
        set_enabled_in(root.path(), "app.textox.demo", true).unwrap();
        let state = set_safe_mode_in(root.path(), false).unwrap();
        assert!(!state.safe_mode);
        let reread = read_state_from(&state_path(root.path()));
        assert_eq!(reread.enabled, vec!["app.textox.demo".to_string()]);
        assert!(!reread.safe_mode);
    }

    #[test]
    fn reports_oversized_manifest_without_parsing_it() {
        let root = TempRoot::new("textox-scan");
        let dir = root.path().join("app.textox.huge");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("manifest.json"),
            vec![b' '; (MAX_MANIFEST_BYTES + 1) as usize],
        )
        .unwrap();

        let scanned = scan_dir(root.path(), &PluginStateFile::default()).unwrap();
        let huge = scanned
            .iter()
            .find(|plugin| plugin.id == "app.textox.huge")
            .unwrap();

        assert!(huge.manifest.is_null());
        assert!(huge.error.as_deref().unwrap().contains("too large"));
    }

    #[test]
    fn apply_enabled_keeps_the_list_deduplicated() {
        let mut state = PluginStateFile::default();

        apply_enabled(&mut state, "app.textox.demo".to_string(), true);
        apply_enabled(&mut state, "app.textox.demo".to_string(), true);
        assert_eq!(state.enabled, vec!["app.textox.demo".to_string()]);

        apply_enabled(&mut state, "app.textox.demo".to_string(), false);
        assert!(state.enabled.is_empty());

        apply_enabled(&mut state, "app.textox.other".to_string(), true);
        assert_eq!(state.enabled, vec!["app.textox.other".to_string()]);
    }
}
