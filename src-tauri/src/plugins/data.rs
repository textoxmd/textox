use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use super::paths::{plugins_root, resolve_inside};

const MAX_DATA_BYTES: usize = 10 * 1024 * 1024;

/// `<plugins>/<id>/data.json`：插件私有数据（`settings` 与 `plugin` 两个命名空间）。
///
/// **安装/升级契约**：本文件位于插件目录内，安装流程（旧目录改 `.bak` → 新目录覆盖 →
/// 删 `.bak`）必须在替换前把旧 `data.json` 搬入新目录，否则升级会静默清空插件数据。
pub fn data_path(root: &Path, plugin_id: &str) -> Result<PathBuf, String> {
    let manifest = resolve_inside(root, plugin_id, "manifest.json")
        .map_err(|error| format!("plugin not installed: {plugin_id} ({error})"))?;
    let dir = manifest
        .parent()
        .ok_or_else(|| "plugin dir not found".to_string())?;
    Ok(dir.join("data.json"))
}

fn default_data() -> Value {
    json!({ "settings": {}, "plugin": {} })
}

/// 读插件数据：文件缺失用默认值；无法解析或不是 JSON 对象时把坏文件改名为
/// `data.json.corrupt` 并回退默认值（避免坏文件让插件永久读失败）。
pub fn read_data_file(path: &Path) -> Result<Value, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(default_data());
        }
        Err(error) => return Err(format!("read data: {error}")),
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(value) if value.is_object() => Ok(value),
        parsed => {
            let reason = match parsed {
                Ok(_) => "expected a JSON object".to_string(),
                Err(error) => error.to_string(),
            };
            let backup = path.with_extension("json.corrupt");
            if std::fs::rename(path, &backup).is_ok() {
                log::warn!(
                    "invalid data.json ({reason}); moved to {}",
                    backup.display()
                );
            } else {
                log::warn!("invalid data.json ({reason})");
            }
            Ok(default_data())
        }
    }
}

pub fn write_data_file(path: &Path, data: &Value) -> Result<(), String> {
    write_data_file_limited(path, data, MAX_DATA_BYTES)
}

fn write_data_file_limited(path: &Path, data: &Value, max_bytes: usize) -> Result<(), String> {
    if !data.is_object() {
        return Err("data must be an object".to_string());
    }
    let text =
        serde_json::to_string_pretty(data).map_err(|error| format!("serialize data: {error}"))?;
    if text.len() > max_bytes {
        return Err(format!("data too large: {} bytes", text.len()));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("create data dir: {error}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    let mut file = std::fs::File::create(&tmp).map_err(|error| format!("write data: {error}"))?;
    file.write_all(text.as_bytes())
        .map_err(|error| format!("write data: {error}"))?;
    // 先落盘再 rename：避免崩溃后留下半截 data.json
    file.sync_all()
        .map_err(|error| format!("sync data: {error}"))?;
    drop(file);
    std::fs::rename(&tmp, path).map_err(|error| format!("replace data: {error}"))
}

#[tauri::command]
pub fn plugin_read_data(app: AppHandle, plugin_id: String) -> Result<Value, String> {
    let root = plugins_root(&app)?;
    read_data_file(&data_path(&root, &plugin_id)?)
}

#[tauri::command]
pub fn plugin_write_data(app: AppHandle, plugin_id: String, data: Value) -> Result<(), String> {
    let root = plugins_root(&app)?;
    write_data_file(&data_path(&root, &plugin_id)?, &data)?;
    // 广播给所有窗口：设置窗口落盘后，编辑器窗口里的插件实例据此热更新
    let _ = app.emit("plugin:data-changed", json!({ "pluginId": plugin_id }));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::test_support::TempRoot;

    fn install_manifest(root: &Path) -> PathBuf {
        let dir = root.join("app.textox.demo");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("manifest.json"),
            r#"{"id":"app.textox.demo","name":"Demo","version":"1.0.0","minAppVersion":"2.3.8","author":{"name":"Textox"}}"#,
        )
        .unwrap();
        dir
    }

    #[test]
    fn missing_file_reads_defaults() {
        let root = TempRoot::new("textox-data");
        install_manifest(root.path());
        let path = data_path(root.path(), "app.textox.demo").unwrap();

        assert_eq!(
            read_data_file(&path).unwrap(),
            json!({ "settings": {}, "plugin": {} })
        );
    }

    #[test]
    fn writes_then_reads_back_and_leaves_no_temp_file() {
        let root = TempRoot::new("textox-data");
        install_manifest(root.path());
        let path = data_path(root.path(), "app.textox.demo").unwrap();
        let data = json!({ "settings": { "limit": 10 }, "plugin": { "count": 2 } });

        write_data_file(&path, &data).unwrap();

        assert_eq!(read_data_file(&path).unwrap(), data);
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn rejects_non_object_payload() {
        let root = TempRoot::new("textox-data");
        install_manifest(root.path());
        let path = data_path(root.path(), "app.textox.demo").unwrap();

        let error = write_data_file(&path, &json!([1, 2])).unwrap_err();

        assert!(error.contains("data must be an object"), "{error}");
        assert!(!path.exists());
    }

    #[test]
    fn quarantines_corrupted_data_file() {
        for content in ["{oops", "[1,2]"] {
            let root = TempRoot::new("textox-data");
            let dir = install_manifest(root.path());
            let path = data_path(root.path(), "app.textox.demo").unwrap();
            std::fs::write(dir.join("data.json"), content).unwrap();

            assert_eq!(
                read_data_file(&path).unwrap(),
                json!({ "settings": {}, "plugin": {} }),
                "content: {content}"
            );
            assert!(!path.exists(), "original must be moved away: {content}");
            assert!(
                path.with_extension("json.corrupt").exists(),
                "quarantine file must exist: {content}"
            );
        }
    }

    #[test]
    fn rejects_data_over_an_injected_limit() {
        let root = TempRoot::new("textox-data");
        install_manifest(root.path());
        let path = data_path(root.path(), "app.textox.demo").unwrap();
        let data = json!({ "k": "0123456789" });

        let error = write_data_file_limited(&path, &data, 10).unwrap_err();
        assert!(error.contains("data too large"), "{error}");
        assert!(!path.exists());

        write_data_file_limited(&path, &data, 64).unwrap();
        assert_eq!(read_data_file(&path).unwrap(), data);
    }

    #[test]
    fn reports_missing_install_for_data_path() {
        let root = TempRoot::new("textox-data");
        std::fs::create_dir_all(root.path().join("app.textox.demo")).unwrap();

        let error = data_path(root.path(), "app.textox.demo").unwrap_err();

        assert!(error.contains("plugin not installed"), "{error}");
    }
}
