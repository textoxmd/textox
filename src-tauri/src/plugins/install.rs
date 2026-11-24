use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

use tauri::AppHandle;
use zip::ZipArchive;

use super::paths::{is_valid_plugin_id, plugins_root};
use super::scan::{read_state_from, scan, state_path, write_state_to, InstalledPlugin, SeedRecord};

const MAX_ENTRIES: usize = 2000;
// 含 pandoc-wasm（解压后约 56MB）这类大资产；上限只防滥用，不限制正常插件。
const MAX_TOTAL_BYTES: u64 = 96 * 1024 * 1024;

/// Windows 会把这些名字当设备名，且会静默剥离结尾的 `.` / 空格（导致卸载删不掉）。
fn is_windows_reserved(segment: &str) -> bool {
    if segment.ends_with('.') || segment.ends_with(' ') {
        return true;
    }
    let trimmed = segment.trim_end_matches([' ', '.']);
    let stem = trimmed.split('.').next().unwrap_or("").to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit())
}

/// `.zip` 插件包内相对路径过滤：绝对路径、`..`、盘符前缀、空路径一律拒绝。
fn safe_relative(name: &str) -> Option<PathBuf> {
    if name.is_empty() {
        return None;
    }
    let path = Path::new(name);
    if path.is_absolute() {
        return None;
    }
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                let segment = part.to_str()?;
                if cfg!(windows) && is_windows_reserved(segment) {
                    return None;
                }
                out.push(part);
            }
            // `..`、`.`、根与盘符前缀都不接受，避免解压逃逸
            _ => return None,
        }
    }
    if out.as_os_str().is_empty() {
        return None;
    }
    Some(out)
}

/// 符号链接条目在写入阶段就拒绝（`resolve_inside` 是读时防线，这里是写时防线）。
fn is_symlink_entry(mode: Option<u32>) -> bool {
    mode.is_some_and(|mode| mode & 0o170000 == 0o120000)
}

/// 回滚切换：删掉新目录，恢复旧目录（若原本有）。保证「返回 `Err` ⇒ 插件目录未被改动」。
/// best-effort：失败只记日志，不改变调用方看到的结果。
fn rollback(target: &Path, backup: &Path, had_old: bool) {
    match std::fs::remove_dir_all(target) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => log::warn!("rollback: remove {} failed: {error}", target.display()),
    }
    if had_old {
        if let Err(error) = std::fs::rename(backup, target) {
            log::warn!("rollback: restore {} failed: {error}", target.display());
        }
    }
}

/// 递归复制。源目录由 `stage_and_switch` 从 zip 解出且已拒绝符号链接条目，故不含链接；
/// 若将来复用本函数处理其它来源，需改用 `symlink_metadata` 判断并拒绝链接。
fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|error| format!("copy plugin dir: {error}"))?;
    for entry in std::fs::read_dir(from).map_err(|error| format!("copy plugin dir: {error}"))? {
        let entry = entry.map_err(|error| format!("copy plugin dir: {error}"))?;
        let source = entry.path();
        let destination = to.join(entry.file_name());
        if source.is_dir() {
            copy_dir(&source, &destination)?;
        } else {
            std::fs::copy(&source, &destination)
                .map_err(|error| format!("copy plugin dir: {error}"))?;
        }
    }
    Ok(())
}

/// 安装 `.zip`（插件包）：先解压到 `<root>/.staging-<uuid>`，校验通过后整体切换到 `<root>/<id>`。
/// 顶层必须恰好一个目录，目录名即插件 id；升级时保留旧目录里的 `data.json`。
///
/// 成功后把来源记为 `user`（播种永不覆盖用户安装的版本）。文件安装与 URL 安装都走这里，
/// 因此两条入口都会记录来源。
///
/// 进程异常退出可能残留 `.staging-<uuid>` 目录；它不会被扫描为插件，也不会被自动清理。
pub fn install_zip_bytes(root: &Path, bytes: &[u8]) -> Result<String, String> {
    let plugin_id = install_zip_bytes_limited(root, bytes, MAX_TOTAL_BYTES, MAX_ENTRIES)?;
    if let Err(error) = record_user_install(root, &plugin_id) {
        // 目录已经换好了，但来源没记下：整体报失败时不能把半截安装留在磁盘上
        // （否则 UI 显示未安装、磁盘上却有目录且来源不明）。
        let installed = root.join(&plugin_id);
        return match std::fs::remove_dir_all(&installed) {
            Ok(()) => Err(error),
            Err(cleanup) => Err(format!(
                "{error}; rollback failed: remove {}: {cleanup}",
                installed.display()
            )),
        };
    }
    Ok(plugin_id)
}

/// 把刚安装的插件标记为用户安装（覆盖播种记录，并清除同名墓碑，允许再次手动装回）。
fn record_user_install(root: &Path, plugin_id: &str) -> Result<(), String> {
    let path = state_path(root);
    let mut state = read_state_from(&path);
    let version = std::fs::read_to_string(root.join(plugin_id).join("manifest.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|manifest| {
            manifest
                .get("version")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "0.0.0".to_string());
    state.seeded.insert(
        plugin_id.to_string(),
        SeedRecord {
            version,
            origin: "user".to_string(),
        },
    );
    state.uninstalled.retain(|id| id != plugin_id);
    write_state_to(&path, &state)
}

/// 从本地文件安装：先按文件大小预检（避免把超大包整个读入内存），再安装。
pub fn install_plugin_file(root: &Path, path: &Path) -> Result<String, String> {
    let meta = std::fs::metadata(path)
        .map_err(|error| format!("read plugin package {}: {error}", path.display()))?;
    if meta.len() > MAX_TOTAL_BYTES {
        return Err(format!(
            "plugin package too large: {} bytes ({})",
            meta.len(),
            path.display()
        ));
    }
    let bytes = std::fs::read(path)
        .map_err(|error| format!("read plugin package {}: {error}", path.display()))?;
    install_zip_bytes(root, &bytes)
}

fn install_zip_bytes_limited(
    root: &Path,
    bytes: &[u8],
    max_total: u64,
    max_entries: usize,
) -> Result<String, String> {
    let mut archive =
        ZipArchive::new(Cursor::new(bytes)).map_err(|error| format!("open zip: {error}"))?;
    if archive.len() > max_entries {
        return Err(format!("too many entries: {}", archive.len()));
    }
    // staging 名带唯一后缀，避免并发安装互相删；`.` 开头不会被扫成插件
    let staging = root.join(format!(".staging-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&staging).map_err(|error| format!("create staging: {error}"))?;
    let outcome = stage_and_switch(root, &mut archive, &staging, max_total);
    // 成功与失败都清理暂存目录，避免把半成品留在插件根目录
    let _ = std::fs::remove_dir_all(&staging);
    outcome
}

fn stage_and_switch(
    root: &Path,
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    staging: &Path,
    max_total: u64,
) -> Result<String, String> {
    let mut total: u64 = 0;
    let mut top: Option<String> = None;

    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|error| match error {
            zip::result::ZipError::UnsupportedArchive(_) => {
                format!("read zip entry: {error} (only deflate is supported)")
            }
            other => format!("read zip entry: {other}"),
        })?;
        let raw_name = file.name().to_string();
        let relative =
            safe_relative(&raw_name).ok_or_else(|| format!("illegal zip entry: {raw_name}"))?;
        if is_symlink_entry(file.unix_mode()) {
            return Err(format!("illegal zip entry: {raw_name}"));
        }
        let segment = relative
            .components()
            .next()
            .and_then(|component| match component {
                Component::Normal(part) => part.to_str(),
                _ => None,
            })
            .ok_or_else(|| format!("illegal zip entry: {raw_name}"))?
            .to_string();
        match &top {
            None => top = Some(segment),
            Some(existing) if existing != &segment => {
                return Err("zip must contain exactly one top-level dir".to_string());
            }
            _ => {}
        }
        let destination = staging.join(&relative);
        if file.is_dir() {
            std::fs::create_dir_all(&destination)
                .map_err(|error| format!("extract zip entry: {error}"))?;
            continue;
        }
        // 声明大小可伪造，只作为「快速拒绝」省一次解压；真正的约束是下面的实际字节截断
        let declared = total.saturating_add(file.size());
        if declared > max_total {
            return Err(format!("uncompressed size exceeds limit: {declared} bytes"));
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("extract zip entry: {error}"))?;
        }
        let remaining = max_total.saturating_sub(total);
        let mut output = std::fs::File::create(&destination)
            .map_err(|error| format!("extract zip entry: {error}"))?;
        // 声明大小不可信（可伪造），按实际字节截断：最多读到 remaining + 1 就停
        let written = std::io::copy(&mut file.by_ref().take(remaining + 1), &mut output)
            .map_err(|error| format!("extract zip entry: {error}"))?;
        total = total.saturating_add(written);
        if total > max_total {
            return Err(format!("uncompressed size exceeds limit: {total} bytes"));
        }
    }

    let plugin_id = top.ok_or_else(|| "zip must contain exactly one top-level dir".to_string())?;
    let staged = staging.join(&plugin_id);
    validate_staged(&staged, &plugin_id)?;

    let target = root.join(&plugin_id);
    let backup = root.join(format!(".{plugin_id}.bak"));
    if backup.exists() {
        std::fs::remove_dir_all(&backup).map_err(|error| format!("clear backup: {error}"))?;
    }
    let had_old = target.exists();
    if had_old {
        std::fs::rename(&target, &backup).map_err(|error| format!("backup plugin dir: {error}"))?;
    }
    if let Err(error) = copy_dir(&staged, &target) {
        rollback(&target, &backup, had_old);
        return Err(error);
    }
    // 升级保留用户数据：zip 里没有 data.json 时，把旧目录里的一并搬过来
    // （`data.rs` 的契约要求 data.json 跟随插件目录，否则升级会静默清空插件数据）。
    if had_old {
        let old_data = backup.join("data.json");
        if old_data.exists() && !target.join("data.json").exists() {
            if let Err(error) = std::fs::copy(&old_data, target.join("data.json")) {
                rollback(&target, &backup, had_old);
                return Err(format!("restore data.json: {error}"));
            }
        }
    }
    if had_old {
        let _ = std::fs::remove_dir_all(&backup);
    }
    Ok(plugin_id)
}

/// 校验解压结果：目录名是合法插件 id、manifest 可解析且 id 与目录一致、`main.js` 存在。
fn validate_staged(staged: &Path, plugin_id: &str) -> Result<(), String> {
    if !is_valid_plugin_id(plugin_id) {
        return Err(format!("invalid plugin dir name: {plugin_id}"));
    }
    let manifest_path = staged.join("manifest.json");
    let manifest_text = std::fs::read_to_string(&manifest_path)
        .map_err(|error| format!("missing manifest.json: {error}"))?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_text)
        .map_err(|error| format!("invalid manifest.json: {error}"))?;
    if manifest.get("id").and_then(|value| value.as_str()) != Some(plugin_id) {
        return Err("manifest id does not match zip dir".to_string());
    }
    if !staged.join("main.js").exists() {
        return Err("main.js missing".to_string());
    }
    Ok(())
}

/// 卸载插件：**先**落墓碑与状态，**再**删目录（以及可能残留的升级备份目录）。
///
/// 只有出厂播种来的插件才留 `uninstalled` 墓碑（否则下次启动会被重新播种回来）；
/// 用户手动安装的插件卸载后不留墓碑，之后装同名官方插件不会被永久拦住。幂等。
///
/// 顺序很重要：若先删目录再写状态，两步之间崩溃会留下「同版本 `seed` 记录 + 目录已删」，
/// 下次 `seed_from` 按同版本跳过 ⇒ 插件既不在墓碑里也不会重播，永久缺失。
/// 删目录失败时回滚到卸载前的状态，保证「返回 `Err` ⇒ 状态与目录都未变」。
pub fn uninstall_plugin(root: &Path, plugin_id: &str) -> Result<(), String> {
    if !is_valid_plugin_id(plugin_id) {
        return Err(format!("invalid plugin id: {plugin_id}"));
    }
    let path = state_path(root);
    let original = read_state_from(&path);
    let mut state = original.clone();
    let from_bundle = state
        .seeded
        .get(plugin_id)
        .is_some_and(|record| record.origin == "seed");
    // 一次性落盘：摘启用 + 清播种记录 + 记墓碑
    state.enabled.retain(|candidate| candidate != plugin_id);
    state.seeded.remove(plugin_id);
    if from_bundle && !state.uninstalled.iter().any(|id| id == plugin_id) {
        state.uninstalled.push(plugin_id.to_string());
    }
    write_state_to(&path, &state)?;

    let dir = root.join(plugin_id);
    if dir.exists() {
        if let Err(error) = std::fs::remove_dir_all(&dir) {
            if let Err(rollback) = write_state_to(&path, &original) {
                log::warn!("uninstall {plugin_id}: restore state failed: {rollback}");
            }
            return Err(format!("remove plugin dir: {error}"));
        }
    }
    let backup = root.join(format!(".{plugin_id}.bak"));
    if backup.exists() {
        let _ = std::fs::remove_dir_all(&backup);
    }
    Ok(())
}

fn scan_current(root: &Path) -> Result<Vec<InstalledPlugin>, String> {
    scan(root)
}

#[tauri::command]
pub fn plugin_install_from_file(
    app: AppHandle,
    path: String,
) -> Result<Vec<InstalledPlugin>, String> {
    let root = plugins_root(&app)?;
    install_plugin_file(&root, Path::new(&path))?;
    scan_current(&root)
}

#[tauri::command]
pub async fn plugin_install_from_url(
    app: AppHandle,
    url: String,
) -> Result<Vec<InstalledPlugin>, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|error| format!("build http client: {error}"))?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("download failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("download failed: {}", response.status()));
    }
    if let Some(length) = response.content_length() {
        if length > MAX_TOTAL_BYTES {
            return Err(format!("download too large: {length} bytes"));
        }
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("download failed: {error}"))?;
    if bytes.len() as u64 > MAX_TOTAL_BYTES {
        return Err(format!("download too large: {} bytes", bytes.len()));
    }
    let root = plugins_root(&app)?;
    install_zip_bytes(&root, &bytes)?;
    scan_current(&root)
}

#[tauri::command]
pub fn plugin_uninstall(app: AppHandle, plugin_id: String) -> Result<Vec<InstalledPlugin>, String> {
    let root = plugins_root(&app)?;
    uninstall_plugin(&root, &plugin_id)?;
    scan_current(&root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::scan::{read_state_from, set_enabled_in, state_path, write_state_to};
    use crate::plugins::test_support::TempRoot;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    const MANIFEST: &str = r#"{"id":"app.textox.demo","name":"Demo","version":"1.0.0","minAppVersion":"2.3.8","author":{"name":"Textox"}}"#;
    const DIR: &str = "app.textox.demo";

    fn build_zip(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = ZipWriter::new(&mut buffer);
            let options = SimpleFileOptions::default();
            for (name, content) in entries {
                writer.start_file(*name, options).unwrap();
                writer.write_all(content.as_bytes()).unwrap();
            }
            writer.finish().unwrap();
        }
        buffer.into_inner()
    }

    fn valid_zip(main_js: &str) -> Vec<u8> {
        build_zip(&[
            ("app.textox.demo/manifest.json", MANIFEST),
            ("app.textox.demo/main.js", main_js),
        ])
    }

    #[test]
    fn rollback_restores_the_previous_directory() {
        let root = TempRoot::new("textox-install");
        let target = root.path().join("app.textox.demo");
        let backup = root.path().join(".app.textox.demo.bak");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("main.js"), "new").unwrap();
        std::fs::create_dir_all(&backup).unwrap();
        std::fs::write(backup.join("main.js"), "old").unwrap();

        rollback(&target, &backup, true);

        assert_eq!(
            std::fs::read_to_string(target.join("main.js")).unwrap(),
            "old"
        );
        assert!(!backup.exists());
    }

    #[test]
    fn rollback_removes_the_new_directory_when_there_was_none() {
        let root = TempRoot::new("textox-install");
        let target = root.path().join("app.textox.demo");
        let backup = root.path().join(".app.textox.demo.bak");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("main.js"), "new").unwrap();

        rollback(&target, &backup, false);

        assert!(!target.exists());
    }

    #[test]
    fn detects_windows_reserved_names() {
        for name in [
            "CON",
            "con",
            "CON.js",
            "NUL",
            "PRN",
            "AUX",
            "COM1",
            "COM9",
            "LPT1",
            "trailing.",
            "trailing ",
        ] {
            assert!(is_windows_reserved(name), "{name} should be reserved");
        }
        for name in ["CONIN$", "COM10", "LPT0x", "index.js", "a-COM1", "console"] {
            assert!(!is_windows_reserved(name), "{name} should not be reserved");
        }
    }

    #[test]
    fn installs_a_single_directory_zip() {
        let root = TempRoot::new("textox-install");

        let id = install_zip_bytes(root.path(), &valid_zip("console.log('v1')")).unwrap();

        assert_eq!(id, "app.textox.demo");
        assert_eq!(
            std::fs::read_to_string(root.path().join("app.textox.demo/main.js")).unwrap(),
            "console.log('v1')"
        );
        assert!(!has_staging(root.path()));
    }

    fn has_staging(root: &Path) -> bool {
        std::fs::read_dir(root)
            .map(|entries| {
                entries
                    .filter_map(|entry| entry.ok())
                    .any(|entry| entry.file_name().to_string_lossy().starts_with(".staging"))
            })
            .unwrap_or(false)
    }

    #[test]
    fn rejects_oversized_package_files_before_reading_them() {
        let root = TempRoot::new("textox-install");
        let package = root.path().join("huge.zip");
        let file = std::fs::File::create(&package).unwrap();
        // 稀疏文件：只占元数据，用它证明预检发生在整包读入之前
        file.set_len(MAX_TOTAL_BYTES + 1).unwrap();
        drop(file);

        let error = install_plugin_file(root.path(), &package).unwrap_err();

        assert!(error.contains("too large"), "{error}");
        assert!(error.contains("huge.zip"), "{error}");
        // 预检在解压前返回，不能留下任何 staging 残留
        let leftovers: Vec<String> = std::fs::read_dir(root.path())
            .map(|entries| {
                entries
                    .filter_map(|entry| entry.ok())
                    .map(|entry| entry.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        assert!(
            !leftovers.iter().any(|name| name.starts_with(".staging-")),
            "leftovers: {leftovers:?}"
        );
    }

    #[test]
    fn rejects_zip_with_multiple_top_level_dirs() {
        let root = TempRoot::new("textox-install");
        let bytes = build_zip(&[
            ("app.textox.demo/manifest.json", MANIFEST),
            ("app.textox.demo/main.js", "x"),
            ("app.textox.other/main.js", "y"),
        ]);

        let error = install_zip_bytes(root.path(), &bytes).unwrap_err();

        assert!(error.contains("exactly one top-level dir"), "{error}");
        assert!(!has_staging(root.path()));
    }

    #[test]
    fn rejects_absolute_and_parent_entries() {
        let root = TempRoot::new("textox-install");
        // 第三条是嵌套逃逸：顶层段合法，只有 `ParentDir` 检查能拦（顶层段检查拦不住）
        for entry in [
            "/etc/passwd",
            "../escape.js",
            "app.textox.demo/../../escape.js",
        ] {
            let bytes = build_zip(&[
                ("app.textox.demo/manifest.json", MANIFEST),
                ("app.textox.demo/main.js", "x"),
                (entry, "x"),
            ]);

            let error = install_zip_bytes(root.path(), &bytes).unwrap_err();

            assert!(error.contains("illegal zip entry"), "{entry}: {error}");
            assert!(!has_staging(root.path()));
        }
        assert!(!root.path().join("escape.js").exists());
    }

    #[test]
    fn rejects_symlink_entries() {
        let root = TempRoot::new("textox-install");
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = ZipWriter::new(&mut buffer);
            let options = SimpleFileOptions::default();
            writer
                .start_file("app.textox.demo/manifest.json", options)
                .unwrap();
            writer.write_all(MANIFEST.as_bytes()).unwrap();
            writer
                .start_file("app.textox.demo/main.js", options)
                .unwrap();
            writer.write_all(b"x").unwrap();
            writer
                .add_symlink("app.textox.demo/link", "/etc/passwd", options)
                .unwrap();
            writer.finish().unwrap();
        }

        let error = install_zip_bytes(root.path(), &buffer.into_inner()).unwrap_err();

        assert!(error.contains("illegal zip entry"), "{error}");
    }

    #[test]
    #[cfg(windows)]
    fn rejects_windows_reserved_names() {
        let root = TempRoot::new("textox-install");
        for name in ["CON", "NUL", "COM1", "trailing"] {
            let entry = if name == "trailing" {
                "app.textox.demo/trailing.".to_string()
            } else {
                format!("app.textox.demo/{name}")
            };
            let bytes = build_zip(&[
                ("app.textox.demo/manifest.json", MANIFEST),
                ("app.textox.demo/main.js", "x"),
                (entry.as_str(), "x"),
            ]);

            let error = install_zip_bytes(root.path(), &bytes).unwrap_err();

            assert!(error.contains("illegal zip entry"), "{entry}: {error}");
        }
    }

    #[test]
    #[cfg(not(windows))]
    fn accepts_reserved_names_on_non_windows() {
        let root = TempRoot::new("textox-install");
        let bytes = build_zip(&[
            ("app.textox.demo/manifest.json", MANIFEST),
            ("app.textox.demo/main.js", "x"),
            ("app.textox.demo/CON.js", "x"),
        ]);

        assert!(install_zip_bytes(root.path(), &bytes).is_ok());
        assert!(root.path().join("app.textox.demo/CON.js").exists());
    }

    #[test]
    fn rejects_manifest_id_mismatch() {
        let root = TempRoot::new("textox-install");
        let bytes = build_zip(&[
            (
                "app.textox.demo/manifest.json",
                r#"{"id":"app.textox.other","name":"Demo","version":"1.0.0","minAppVersion":"2.3.8","author":{"name":"Textox"}}"#,
            ),
            ("app.textox.demo/main.js", "x"),
        ]);

        let error = install_zip_bytes(root.path(), &bytes).unwrap_err();

        assert!(
            error.contains("manifest id does not match zip dir"),
            "{error}"
        );
        assert!(!root.path().join("app.textox.demo").exists());
    }

    #[test]
    fn rejects_zip_without_main_js() {
        let root = TempRoot::new("textox-install");
        let bytes = build_zip(&[("app.textox.demo/manifest.json", MANIFEST)]);

        let error = install_zip_bytes(root.path(), &bytes).unwrap_err();

        assert!(error.contains("main.js missing"), "{error}");
        assert!(!root.path().join("app.textox.demo").exists());
    }

    #[test]
    fn rejects_zips_with_too_many_entries() {
        let root = TempRoot::new("textox-install");
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = ZipWriter::new(&mut buffer);
            let options = SimpleFileOptions::default();
            for index in 0..2001 {
                writer
                    .start_file(format!("{DIR}/f{index}"), options)
                    .unwrap();
            }
            writer.finish().unwrap();
        }

        let error = install_zip_bytes(root.path(), &buffer.into_inner()).unwrap_err();

        assert!(error.contains("too many"), "{error}");
    }

    #[test]
    fn rejects_zips_exceeding_the_injected_byte_limit() {
        let root = TempRoot::new("textox-install");
        let bytes = build_zip(&[
            ("app.textox.demo/manifest.json", MANIFEST),
            (
                "app.textox.demo/main.js",
                "0123456789abcdefghijklmnopqrstuv",
            ),
        ]);

        let error = install_zip_bytes_limited(root.path(), &bytes, 16, 2000).unwrap_err();

        assert!(error.contains("uncompressed size exceeds limit"), "{error}");
        assert!(!root.path().join("app.textox.demo").exists());
        assert!(!has_staging(root.path()));
    }

    /// 只改中央目录里的 uncompressed size，模拟「声明很小、实际解出很多」的伪造包。
    fn forge_declared_size(zip: &mut [u8], declared: u32) {
        let eocd = zip
            .windows(4)
            .rposition(|window| window == b"PK\x05\x06")
            .expect("end of central directory");
        let cd_offset = u32::from_le_bytes(zip[eocd + 16..eocd + 20].try_into().unwrap()) as usize;
        let mut cursor = cd_offset;
        while zip[cursor..cursor + 4] == *b"PK\x01\x02" {
            let name_len =
                u16::from_le_bytes(zip[cursor + 28..cursor + 30].try_into().unwrap()) as usize;
            let extra_len =
                u16::from_le_bytes(zip[cursor + 30..cursor + 32].try_into().unwrap()) as usize;
            let comment_len =
                u16::from_le_bytes(zip[cursor + 32..cursor + 34].try_into().unwrap()) as usize;
            zip[cursor + 24..cursor + 28].copy_from_slice(&declared.to_le_bytes());
            cursor += 46 + name_len + extra_len + comment_len;
        }
    }

    #[test]
    fn truncates_forged_zips_at_the_limit() {
        let root = TempRoot::new("textox-install");
        let mut bytes = build_zip(&[
            ("app.textox.demo/manifest.json", MANIFEST),
            ("app.textox.demo/main.js", &"x".repeat(1024)),
        ]);
        forge_declared_size(&mut bytes, 1);

        let error = install_zip_bytes_limited(root.path(), &bytes, 16, 2000).unwrap_err();

        assert!(error.contains("uncompressed size exceeds limit"), "{error}");
        // 实际写入必须在「上限 + 1」处停下，而不是先写满再报错
        assert!(
            error.contains("17 bytes"),
            "must stop right after the limit: {error}"
        );
        assert!(!root.path().join("app.textox.demo").exists());
        assert!(!has_staging(root.path()));
    }

    #[test]
    fn preserves_data_json_across_reinstall() {
        let root = TempRoot::new("textox-install");
        install_zip_bytes(root.path(), &valid_zip("v1")).unwrap();
        let data_path = root.path().join(DIR).join("data.json");
        let data = r#"{"settings":{"limit":10},"plugin":{}}"#;
        std::fs::write(&data_path, data).unwrap();

        install_zip_bytes(root.path(), &valid_zip("v2")).unwrap();

        assert_eq!(
            std::fs::read_to_string(root.path().join(DIR).join("main.js")).unwrap(),
            "v2"
        );
        assert_eq!(std::fs::read_to_string(&data_path).unwrap(), data);
        assert!(!root.path().join(format!(".{DIR}.bak")).exists());
    }

    #[test]
    fn uninstall_removes_dir_and_clears_enabled() {
        let root = TempRoot::new("textox-install");
        install_zip_bytes(root.path(), &valid_zip("x")).unwrap();
        set_enabled_in(root.path(), DIR, true).unwrap();
        assert_eq!(
            read_state_from(&state_path(root.path())).enabled,
            vec![DIR.to_string()]
        );

        uninstall_plugin(root.path(), DIR).unwrap();

        assert!(!root.path().join(DIR).exists());
        assert!(read_state_from(&state_path(root.path())).enabled.is_empty());
        // 幂等：再次卸载不报错
        uninstall_plugin(root.path(), DIR).unwrap();
    }

    #[test]
    fn install_records_user_origin_and_clears_tombstone() {
        let root = TempRoot::new("textox-install");
        // 模拟「内置插件被卸载过」：目录已删、留墓碑
        let mut state = read_state_from(&state_path(root.path()));
        state.seeded.insert(
            DIR.to_string(),
            SeedRecord {
                version: "1.0.0".to_string(),
                origin: "seed".to_string(),
            },
        );
        state.uninstalled.push(DIR.to_string());
        write_state_to(&state_path(root.path()), &state).unwrap();

        install_zip_bytes(root.path(), &valid_zip("x")).unwrap();

        let read = read_state_from(&state_path(root.path()));
        let record = read.seeded.get(DIR).expect("install must be recorded");
        assert_eq!(record.origin, "user");
        assert_eq!(record.version, "1.0.0");
        // 手动装回同名内置插件后墓碑必须清掉
        assert!(read.uninstalled.is_empty());
    }

    #[test]
    fn failed_state_write_removes_the_half_installed_directory() {
        let root = TempRoot::new("textox-install");
        // 用目录占住 `plugins.json.tmp`：`write_state_to` 的 `File::create` 必定失败，
        // 且不需要改权限。此时目录已换入，安装方必须把目录删掉再报错。
        std::fs::create_dir_all(root.path().join("plugins.json.tmp")).unwrap();

        let error = install_zip_bytes(root.path(), &valid_zip("x")).unwrap_err();

        assert!(error.contains("write state"), "{error}");
        assert!(
            !root.path().join(DIR).exists(),
            "must not leave a half install"
        );
        assert!(!has_staging(root.path()));
    }

    #[test]
    fn uninstall_leaves_a_tombstone_only_for_bundled_plugins() {
        let root = TempRoot::new("textox-install");

        // 用户安装（install_zip_bytes 记录 origin=user）→ 不留墓碑
        install_zip_bytes(root.path(), &valid_zip("x")).unwrap();
        uninstall_plugin(root.path(), DIR).unwrap();
        let read = read_state_from(&state_path(root.path()));
        assert!(read.seeded.get(DIR).is_none());
        assert!(read.uninstalled.is_empty(), "{:?}", read.uninstalled);

        // 出厂播种 → 留墓碑，且移除播种记录（靠墓碑表达「不要再播种」）
        let mut state = read;
        state.seeded.insert(
            DIR.to_string(),
            SeedRecord {
                version: "1.0.0".to_string(),
                origin: "seed".to_string(),
            },
        );
        write_state_to(&state_path(root.path()), &state).unwrap();

        uninstall_plugin(root.path(), DIR).unwrap();
        let read = read_state_from(&state_path(root.path()));
        assert!(read.seeded.get(DIR).is_none());
        assert_eq!(read.uninstalled, vec![DIR.to_string()]);

        // 再次卸载不得重复追加墓碑
        uninstall_plugin(root.path(), DIR).unwrap();
        assert_eq!(
            read_state_from(&state_path(root.path())).uninstalled,
            vec![DIR.to_string()]
        );
    }
}
