//! 出厂播种：把应用资源目录里的内置插件复制到 `<plugins>/` 并记录来源版本。
//!
//! 与安装流程的分工：
//! - `origin == "seed"`：内置插件，可随资源升级重播（保留 `data.json`，不重新启用）。
//! - `origin == "user"`：用户手动安装，播种永不覆盖。
//! - 内置插件被卸载后留下 `uninstalled` 墓碑，只有 `restore` 清除后才再次播种。

use std::path::{Path, PathBuf};

use tauri::Manager;

use super::paths::{is_valid_plugin_id, plugins_root};
use super::scan::{read_state_from, state_path, write_state_to, PluginStateFile, SeedRecord};

/// 读 `<dir>/manifest.json`：缺失、非法 JSON 或不是对象都返回 `None`（调用方跳过该目录）。
fn read_manifest(dir: &Path) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(dir.join("manifest.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value.is_object().then_some(value)
}

/// 递归复制目录，跳过符号链接（资源目录不应夹带链接，也不跟随它逃出插件目录）。
fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|error| format!("create {}: {error}", to.display()))?;
    let entries =
        std::fs::read_dir(from).map_err(|error| format!("read {}: {error}", from.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("read {}: {error}", from.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("stat {}: {error}", entry.path().display()))?;
        if file_type.is_symlink() {
            continue;
        }
        let destination = to.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir(&entry.path(), &destination)?;
        } else {
            std::fs::copy(entry.path(), &destination)
                .map_err(|error| format!("copy {}: {error}", entry.path().display()))?;
        }
    }
    Ok(())
}

/// 按「复制到 `.{id}.tmp` → 换位」的方式落盘，换位过程可回滚。
///
/// 顺序：先把旧目录整体挪到 `.{id}.bak`，再把 `tmp` 换入，成功后才丢弃备份；
/// 换入失败则把备份挪回原位。这样任何一步出错都不会出现「旧目录已删、新目录没到位」
/// 的空窗。旧目录里的 `data.json` 在丢弃备份之前复制到新目录，保留用户配置。
/// 进程在「旧目录已挪走、新目录未换入」之间被杀时，遗留的 `.{id}.bak` 会在下次运行
/// 进入本函数时先复位成正式目录（随后按普通升级处理，`data.json` 一并保留）。
fn plant(source: &Path, target: &Path) -> Result<(), String> {
    let id = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("plugin");
    let tmp = target.with_file_name(format!(".{id}.tmp"));
    let backup = target.with_file_name(format!(".{id}.bak"));
    // 上次异常退出可能留下半成品，先清掉
    let _ = std::fs::remove_dir_all(&tmp);
    // 另一类残局：旧目录已挪到 `.{id}.bak`、新目录还没换入（复制/换位之间崩溃）。
    // 此时 `.{id}.bak` 是唯一的数据副本，必须复位，不能像普通备份那样直接删。
    if !target.exists() && backup.exists() {
        if let Err(error) = std::fs::rename(&backup, target) {
            return Err(format!("restore backup plugin dir: {error}"));
        }
    }
    if let Err(error) = copy_dir(source, &tmp) {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(error);
    }

    let _ = std::fs::remove_dir_all(&backup);
    let had_old = target.exists();
    if had_old {
        if let Err(error) = std::fs::rename(target, &backup) {
            let _ = std::fs::remove_dir_all(&tmp);
            return Err(format!("backup plugin dir: {error}"));
        }
    }
    if let Err(error) = std::fs::rename(&tmp, target) {
        if had_old {
            // 回滚：旧目录复位，保证「返回 Err ⇒ 磁盘与之前一致」
            if let Err(restore) = std::fs::rename(&backup, target) {
                log::warn!(
                    "seed {}: restore backup failed: {restore}",
                    target.display()
                );
            }
        }
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(format!("rename: {error}"));
    }

    if had_old {
        // 用户配置跟着目录走（见 data.rs 的安装/升级契约）。备份随后就要删掉，
        // 所以先把 data.json 搬到新目录；搬失败只告警：配置丢了也比插件没装上好。
        let old_data = backup.join("data.json");
        if old_data.exists() {
            if let Err(error) = std::fs::copy(&old_data, target.join("data.json")) {
                log::warn!(
                    "seed {}: restore data.json failed: {error}",
                    target.display()
                );
            }
        }
        let _ = std::fs::remove_dir_all(&backup);
    }
    Ok(())
}

/// 已从应用资源目录退役的内置插件：升级后主动清掉此前播种的副本。
///
/// 只清理 `origin == "seed"` 的记录——用户手动安装的同名插件（`origin == "user"`）
/// 保持不动；删除失败时保留记录，下次启动重试。
const RETIRED_BUNDLED_PLUGINS: &[&str] = &["app.textox.epub-export"];

/// 清理退役内置插件，返回是否有状态变更（调用方负责落盘）。
fn prune_retired(root: &Path, state: &mut PluginStateFile) -> bool {
    let mut changed = false;
    for &id in RETIRED_BUNDLED_PLUGINS {
        let Some(record) = state.seeded.get(id) else {
            continue;
        };
        if record.origin != "seed" {
            continue;
        }
        match std::fs::remove_dir_all(root.join(id)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                log::warn!("prune retired plugin {id}: {error}");
                continue;
            }
        }
        // 换位过程可能留下的残局一并清掉
        let _ = std::fs::remove_dir_all(root.join(format!(".{id}.tmp")));
        let _ = std::fs::remove_dir_all(root.join(format!(".{id}.bak")));
        state.seeded.remove(id);
        state.enabled.retain(|candidate| candidate != id);
        state.uninstalled.retain(|candidate| candidate != id);
        changed = true;
        log::info!("pruned retired bundled plugin {id}");
    }
    changed
}

/// 把 `bundled` 下的插件播种到 `root`，并就地更新 `state`（函数结束时统一落盘）。
///
/// 单个插件失败只记录并继续，已成功的插件仍会写入 `state`；整轮结束后返回**第一个**错误。
/// 返回的 id 是**本次真正复制过**的 id（排序与 `read_dir` 一致，调用方可自行排序）。
pub fn seed_from(
    bundled: &Path,
    root: &Path,
    state: &mut PluginStateFile,
) -> Result<Vec<String>, String> {
    // 退役清理先于播种：即使资源目录缺失（开发模式）也要清掉旧副本并落盘。
    let pruned = prune_retired(root, state);

    // 开发模式没有资源目录：静默跳过
    if !bundled.exists() {
        if pruned {
            write_state_to(&state_path(root), state)
                .map_err(|error| format!("write plugin state: {error}"))?;
        }
        return Ok(Vec::new());
    }
    std::fs::create_dir_all(root).map_err(|error| format!("create plugins dir: {error}"))?;

    let mut planted = Vec::new();
    let mut first_error: Option<String> = None;
    let entries =
        std::fs::read_dir(bundled).map_err(|error| format!("read bundled plugins: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("read bundled plugins: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("stat {}: {error}", entry.path().display()))?;
        if !file_type.is_dir() {
            continue;
        }
        let Some(id) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !is_valid_plugin_id(&id) {
            continue;
        }
        // 退役插件即便还残留在资源目录（例如旧的 dev 资源副本）也不再播种
        if RETIRED_BUNDLED_PLUGINS.contains(&id.as_str()) {
            continue;
        }
        if state.uninstalled.contains(&id) {
            continue;
        }
        let source = entry.path();
        // 坏 manifest 只跳过自身，不中断整轮播种
        let Some(manifest) = read_manifest(&source) else {
            log::warn!("skip bundled plugin {id}: manifest.json missing or invalid");
            continue;
        };
        let version = manifest
            .get("version")
            .and_then(|value| value.as_str())
            .unwrap_or("0.0.0")
            .to_string();

        let mut fresh = true;
        if let Some(record) = state.seeded.get(&id) {
            // 用户装的版本优先，绝不覆盖；同版本视为已播种（幂等）
            if record.origin == "user" || record.version == version {
                continue;
            }
            fresh = false;
        }

        // 单个插件失败不中断整轮：已复制的插件必须留下 `seeded` 记录，
        // 否则下次会被当成全新插件重播（可能把用户手动关掉的 defaultEnabled 重新启用）。
        if let Err(error) = plant(&source, &root.join(&id)) {
            log::warn!("seed {id}: {error}");
            if first_error.is_none() {
                first_error = Some(format!("{id}: {error}"));
            }
            continue;
        }
        state.seeded.insert(
            id.clone(),
            SeedRecord {
                version,
                origin: "seed".to_string(),
            },
        );
        // 升级重播不自动启用：用户可能手动关过
        let default_enabled = manifest
            .get("defaultEnabled")
            .and_then(|value| value.as_bool())
            == Some(true);
        if fresh && default_enabled && !state.enabled.contains(&id) {
            state.enabled.push(id.clone());
        }
        planted.push(id);
    }

    // 整轮结束后统一落盘：即便中途有插件失败，已成功的记录也必须留在磁盘上
    let persisted = write_state_to(&state_path(root), state);
    if let Some(error) = first_error {
        if let Err(write_error) = persisted {
            log::warn!("seed: write plugin state failed: {write_error}");
        }
        return Err(error);
    }
    persisted?;
    Ok(planted)
}

/// 清除墓碑与播种记录，使下一次 `seed_from` 重新复制。
pub fn restore(root: &Path, plugin_id: &str) -> Result<(), String> {
    if !is_valid_plugin_id(plugin_id) {
        return Err(format!("invalid plugin id: {plugin_id}"));
    }
    let path = state_path(root);
    let mut state = read_state_from(&path);
    state.uninstalled.retain(|candidate| candidate != plugin_id);
    state.seeded.remove(plugin_id);
    write_state_to(&path, &state)
}

/// 应用资源目录下的 `plugins/`；资源目录不可用时返回 `None`。
fn bundled_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("plugins"))
}

#[tauri::command]
pub fn plugin_seed_bundled(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let Some(bundled) = bundled_root(&app) else {
        return Ok(Vec::new());
    };
    let root = plugins_root(&app)?;
    let mut state = read_state_from(&state_path(&root));
    seed_from(&bundled, &root, &mut state)
}

/// 恢复被卸载的内置插件：清墓碑 + 播种记录，紧接着重播一次（调用方拿到结果即可刷新）。
#[tauri::command]
pub fn plugin_restore_builtin(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<Vec<String>, String> {
    let root = plugins_root(&app)?;
    restore(&root, &plugin_id)?;
    let Some(bundled) = bundled_root(&app) else {
        return Ok(Vec::new());
    };
    let mut state = read_state_from(&state_path(&root));
    seed_from(&bundled, &root, &mut state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::scan::state_path;
    use crate::plugins::test_support::TempRoot;

    const DEMO: &str = "app.textox.demo";

    fn write_plugin(dir: &Path, id: &str, version: &str, default_enabled: bool) {
        std::fs::create_dir_all(dir).unwrap();
        let manifest = serde_json::json!({
            "id": id,
            "name": "Demo",
            "version": version,
            "minAppVersion": "2.3.8",
            "author": { "name": "Textox" },
            "defaultEnabled": default_enabled,
        });
        std::fs::write(dir.join("manifest.json"), manifest.to_string()).unwrap();
        std::fs::write(dir.join("main.js"), format!("console.log('{version}')")).unwrap();
    }

    fn manifest_version(root: &Path, id: &str) -> String {
        let text = std::fs::read_to_string(root.join(id).join("manifest.json")).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        value
            .get("version")
            .and_then(|version| version.as_str())
            .unwrap()
            .to_string()
    }

    fn load_state(root: &Path) -> PluginStateFile {
        read_state_from(&state_path(root))
    }

    #[test]
    fn seeds_once_and_respects_uninstalled() {
        let bundled = TempRoot::new("textox-seed-bundled");
        let data = TempRoot::new("textox-seed-data");
        write_plugin(
            &bundled.path().join("app.textox.alpha"),
            "app.textox.alpha",
            "1.0.0",
            true,
        );
        write_plugin(&bundled.path().join(DEMO), DEMO, "1.0.0", false);

        let mut state = PluginStateFile::default();
        let mut planted = seed_from(bundled.path(), data.path(), &mut state).unwrap();
        planted.sort();
        assert_eq!(planted, vec!["app.textox.alpha", DEMO]);
        // 首次播种按 defaultEnabled 自动启用
        assert_eq!(state.enabled, vec!["app.textox.alpha".to_string()]);
        assert_eq!(load_state(data.path()).seeded[DEMO].origin, "seed");

        // 第二次：幂等，不再复制
        let mut state = load_state(data.path());
        assert!(seed_from(bundled.path(), data.path(), &mut state)
            .unwrap()
            .is_empty());

        // 墓碑：内置插件卸载后不再播种
        std::fs::remove_dir_all(data.path().join(DEMO)).unwrap();
        let mut state = load_state(data.path());
        state.uninstalled.push(DEMO.to_string());
        write_state_to(&state_path(data.path()), &state).unwrap();

        let mut state = load_state(data.path());
        assert!(seed_from(bundled.path(), data.path(), &mut state)
            .unwrap()
            .is_empty());
        assert!(!data.path().join(DEMO).exists());
    }

    #[test]
    fn does_not_overwrite_user_install() {
        let bundled = TempRoot::new("textox-seed-bundled");
        let data = TempRoot::new("textox-seed-data");
        write_plugin(&bundled.path().join(DEMO), DEMO, "1.0.0", false);

        let mut state = PluginStateFile::default();
        assert_eq!(
            seed_from(bundled.path(), data.path(), &mut state).unwrap(),
            vec![DEMO.to_string()]
        );

        // 用户重装/升级到自己的版本
        let mut state = load_state(data.path());
        state.seeded.insert(
            DEMO.to_string(),
            SeedRecord {
                version: "0.9.0".to_string(),
                origin: "user".to_string(),
            },
        );
        write_state_to(&state_path(data.path()), &state).unwrap();
        write_plugin(&data.path().join(DEMO), DEMO, "0.9.0", false);

        // 资源升到 2.0.0 也不得覆盖用户版本
        write_plugin(&bundled.path().join(DEMO), DEMO, "2.0.0", true);

        let mut state = load_state(data.path());
        assert!(seed_from(bundled.path(), data.path(), &mut state)
            .unwrap()
            .is_empty());
        assert_eq!(manifest_version(data.path(), DEMO), "0.9.0");
        assert_eq!(load_state(data.path()).seeded[DEMO].origin, "user");
        assert!(state.enabled.is_empty());
    }

    #[test]
    fn skips_retired_plugin_even_when_still_present_in_bundle() {
        let bundled = TempRoot::new("textox-seed-bundled");
        let data = TempRoot::new("textox-seed-data");
        let retired = RETIRED_BUNDLED_PLUGINS[0];

        // 模拟旧版本留下的状态：资源里还有、用户目录里已播种
        write_plugin(&bundled.path().join(retired), retired, "1.0.1", true);
        write_plugin(&data.path().join(retired), retired, "1.0.1", true);
        let mut state = PluginStateFile::default();
        state.seeded.insert(
            retired.to_string(),
            SeedRecord {
                version: "1.0.1".to_string(),
                origin: "seed".to_string(),
            },
        );
        state.enabled.push(retired.to_string());

        seed_from(bundled.path(), data.path(), &mut state).unwrap();

        assert!(!data.path().join(retired).exists());
        assert!(!state.seeded.contains_key(retired));
        assert!(!state.enabled.iter().any(|id| id == retired));
    }

    #[test]
    fn prunes_retired_plugin_and_persists_when_bundled_dir_missing() {
        let bundled = TempRoot::new("textox-seed-bundled");
        let data = TempRoot::new("textox-seed-data");
        let retired = RETIRED_BUNDLED_PLUGINS[0];
        write_plugin(&data.path().join(retired), retired, "1.0.1", false);
        let mut state = PluginStateFile::default();
        state.seeded.insert(
            retired.to_string(),
            SeedRecord {
                version: "1.0.1".to_string(),
                origin: "seed".to_string(),
            },
        );

        // 资源目录整体缺失（开发模式）也要完成清理并落盘
        let missing = bundled.path().join("plugins");
        assert!(seed_from(&missing, data.path(), &mut state)
            .unwrap()
            .is_empty());

        assert!(!data.path().join(retired).exists());
        let persisted = load_state(data.path());
        assert!(!persisted.seeded.contains_key(retired));
    }

    #[test]
    fn keeps_user_installed_retired_plugin() {
        let bundled = TempRoot::new("textox-seed-bundled");
        let data = TempRoot::new("textox-seed-data");
        let retired = RETIRED_BUNDLED_PLUGINS[0];
        // 资源里的版本更高，但用户目录是手动安装来源，必须原样保留
        write_plugin(&bundled.path().join(retired), retired, "2.0.0", true);
        write_plugin(&data.path().join(retired), retired, "0.9.0", false);
        let mut state = PluginStateFile::default();
        state.seeded.insert(
            retired.to_string(),
            SeedRecord {
                version: "0.9.0".to_string(),
                origin: "user".to_string(),
            },
        );

        seed_from(bundled.path(), data.path(), &mut state).unwrap();
        assert_eq!(manifest_version(data.path(), retired), "0.9.0");
        assert_eq!(load_state(data.path()).seeded[retired].origin, "user");
    }

    #[test]
    fn upgrade_keeps_data_json_and_bumps_version() {
        let bundled = TempRoot::new("textox-seed-bundled");
        let data = TempRoot::new("textox-seed-data");
        write_plugin(&bundled.path().join(DEMO), DEMO, "1.0.0", true);

        let mut state = PluginStateFile::default();
        seed_from(bundled.path(), data.path(), &mut state).unwrap();
        let data_file = data.path().join(DEMO).join("data.json");
        let payload = r#"{"settings":{"limit":10},"plugin":{}}"#;
        std::fs::write(&data_file, payload).unwrap();

        write_plugin(&bundled.path().join(DEMO), DEMO, "2.0.0", true);
        let mut state = load_state(data.path());
        assert_eq!(
            seed_from(bundled.path(), data.path(), &mut state).unwrap(),
            vec![DEMO.to_string()]
        );

        assert_eq!(std::fs::read_to_string(&data_file).unwrap(), payload);
        assert_eq!(manifest_version(data.path(), DEMO), "2.0.0");
        assert_eq!(load_state(data.path()).seeded[DEMO].version, "2.0.0");
        // 换位成功后不得留下临时/备份目录
        assert!(!data.path().join(format!(".{DEMO}.tmp")).exists());
        assert!(!data.path().join(format!(".{DEMO}.bak")).exists());
    }

    /// 单个插件复制失败不得中断整轮：已成功的插件必须有 `seeded` 记录并落盘，
    /// 否则下次会被当成全新插件重播（可能把用户手动关掉的 defaultEnabled 再打开）。
    #[test]
    fn keeps_seeding_others_and_persists_state_when_one_plugin_fails() {
        let bundled = TempRoot::new("textox-seed-bundled");
        let data = TempRoot::new("textox-seed-data");
        write_plugin(&bundled.path().join(DEMO), DEMO, "1.0.0", true);
        write_plugin(
            &bundled.path().join("app.textox.other"),
            "app.textox.other",
            "1.0.0",
            false,
        );
        // 用普通文件占住 `.{DEMO}.tmp`：`copy_dir` 的 `create_dir_all` 会以 EEXIST 失败。
        // 比 chmod 000 可靠（root 下读权限仍成立），也不依赖平台。
        std::fs::write(data.path().join(format!(".{DEMO}.tmp")), "blocked").unwrap();

        let mut state = PluginStateFile::default();
        let error = seed_from(bundled.path(), data.path(), &mut state).unwrap_err();
        assert!(error.contains(DEMO), "{error}");

        // 失败者没有落盘，成功者照常播种
        assert!(!data.path().join(DEMO).exists());
        assert_eq!(manifest_version(data.path(), "app.textox.other"), "1.0.0");
        // 状态已落盘：其它插件的 seeded 记录必须存在
        let persisted = load_state(data.path());
        assert_eq!(persisted.seeded["app.textox.other"].origin, "seed");
        assert!(!persisted.seeded.contains_key(DEMO));
        // 失败者的 defaultEnabled 不得写进启用列表
        assert!(persisted.enabled.is_empty(), "{:?}", persisted.enabled);
    }

    /// 崩溃残局：旧目录已挪到 `.{id}.bak`、新目录还没换入。下次播种必须先把 `.bak`
    /// 复位（唯一的数据副本），再按升级处理，`data.json` 保留。
    #[test]
    fn restores_leftover_backup_when_target_missing() {
        let bundled = TempRoot::new("textox-seed-bundled");
        let data = TempRoot::new("textox-seed-data");
        write_plugin(&bundled.path().join(DEMO), DEMO, "2.0.0", true);

        // 手工预置遗留备份：旧 manifest + 用户数据，正式目录不存在
        let backup = data.path().join(format!(".{DEMO}.bak"));
        write_plugin(&backup, DEMO, "1.0.0", true);
        let payload = r#"{"settings":{"limit":10},"plugin":{}}"#;
        std::fs::write(backup.join("data.json"), payload).unwrap();

        let mut state = PluginStateFile::default();
        assert_eq!(
            seed_from(bundled.path(), data.path(), &mut state).unwrap(),
            vec![DEMO.to_string()]
        );

        assert!(data.path().join(DEMO).exists());
        assert_eq!(
            std::fs::read_to_string(data.path().join(DEMO).join("data.json")).unwrap(),
            payload
        );
        assert_eq!(manifest_version(data.path(), DEMO), "2.0.0");
        assert!(!backup.exists());
    }

    #[test]
    fn upgrade_does_not_re_enable() {
        let bundled = TempRoot::new("textox-seed-bundled");
        let data = TempRoot::new("textox-seed-data");
        write_plugin(&bundled.path().join(DEMO), DEMO, "1.0.0", true);

        let mut state = PluginStateFile::default();
        seed_from(bundled.path(), data.path(), &mut state).unwrap();
        assert_eq!(state.enabled, vec![DEMO.to_string()]);

        // 用户手动关掉
        state.enabled.retain(|id| id != DEMO);
        write_state_to(&state_path(data.path()), &state).unwrap();

        write_plugin(&bundled.path().join(DEMO), DEMO, "2.0.0", true);
        let mut state = load_state(data.path());
        seed_from(bundled.path(), data.path(), &mut state).unwrap();

        assert_eq!(manifest_version(data.path(), DEMO), "2.0.0");
        assert!(state.enabled.is_empty(), "{:?}", state.enabled);
    }

    #[test]
    fn skips_invalid_ids_and_broken_manifests_without_blocking_others() {
        let bundled = TempRoot::new("textox-seed-bundled");
        let data = TempRoot::new("textox-seed-data");
        std::fs::create_dir_all(bundled.path().join("bad")).unwrap();
        std::fs::write(bundled.path().join("bad/manifest.json"), "{}").unwrap();
        std::fs::create_dir_all(bundled.path().join("app.textox.broken")).unwrap();
        std::fs::write(
            bundled.path().join("app.textox.broken/manifest.json"),
            "{oops",
        )
        .unwrap();
        // 不是 JSON 对象也要跳过
        std::fs::create_dir_all(bundled.path().join("app.textox.array")).unwrap();
        std::fs::write(
            bundled.path().join("app.textox.array/manifest.json"),
            "[1,2]",
        )
        .unwrap();
        write_plugin(&bundled.path().join(DEMO), DEMO, "1.0.0", false);

        let mut state = PluginStateFile::default();
        let planted = seed_from(bundled.path(), data.path(), &mut state).unwrap();

        assert_eq!(planted, vec![DEMO.to_string()]);
        assert!(data.path().join(DEMO).exists());
        assert!(!data.path().join("bad").exists());
        assert!(!data.path().join("app.textox.broken").exists());
        assert!(!data.path().join("app.textox.array").exists());
    }

    #[test]
    fn restore_clears_records_and_reseeds() {
        let bundled = TempRoot::new("textox-seed-bundled");
        let data = TempRoot::new("textox-seed-data");
        write_plugin(&bundled.path().join(DEMO), DEMO, "1.0.0", true);

        let mut state = PluginStateFile::default();
        seed_from(bundled.path(), data.path(), &mut state).unwrap();
        // 模拟卸载：目录没了、留墓碑
        std::fs::remove_dir_all(data.path().join(DEMO)).unwrap();
        let mut state = load_state(data.path());
        state.uninstalled.push(DEMO.to_string());
        write_state_to(&state_path(data.path()), &state).unwrap();

        restore(data.path(), DEMO).unwrap();
        let after_restore = load_state(data.path());
        assert!(after_restore.uninstalled.is_empty());
        assert!(!after_restore.seeded.contains_key(DEMO));

        let mut state = after_restore;
        assert_eq!(
            seed_from(bundled.path(), data.path(), &mut state).unwrap(),
            vec![DEMO.to_string()]
        );
        assert!(data.path().join(DEMO).join("manifest.json").exists());
    }

    #[test]
    fn restore_rejects_invalid_ids() {
        let data = TempRoot::new("textox-seed-data");
        let error = restore(data.path(), "Not_A_Plugin").unwrap_err();
        assert!(error.contains("invalid plugin id"), "{error}");
    }

    #[test]
    fn missing_bundled_dir_is_not_an_error() {
        let bundled = TempRoot::new("textox-seed-bundled");
        let data = TempRoot::new("textox-seed-data");
        let missing = bundled.path().join("plugins");

        let mut state = PluginStateFile::default();
        assert!(seed_from(&missing, data.path(), &mut state)
            .unwrap()
            .is_empty());
    }

    #[test]
    #[cfg(unix)]
    fn skips_symlinks_inside_bundled_plugins() {
        let bundled = TempRoot::new("textox-seed-bundled");
        let data = TempRoot::new("textox-seed-data");
        let source = bundled.path().join(DEMO);
        write_plugin(&source, DEMO, "1.0.0", false);
        std::fs::write(bundled.path().join("secret.txt"), "top secret").unwrap();
        std::os::unix::fs::symlink(bundled.path().join("secret.txt"), source.join("leak.txt"))
            .unwrap();

        let mut state = PluginStateFile::default();
        seed_from(bundled.path(), data.path(), &mut state).unwrap();

        assert!(data.path().join(DEMO).join("manifest.json").exists());
        assert!(!data.path().join(DEMO).join("leak.txt").exists());
    }
}
