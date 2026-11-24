use std::path::{Component, Path, PathBuf};

use tauri::Manager;

pub const PLUGIN_ID_MIN: usize = 8;
pub const PLUGIN_ID_MAX: usize = 96;
const PLUGIN_ID_MIN_SEGMENTS: usize = 3;
const PLUGIN_ID_MAX_SEGMENTS: usize = 8;

/// 与前端 `@texto/plugin` 的 `validatePluginId` 结构一致：
/// 3..=8 段、每段小写字母开头、段内仅 `[a-z0-9]` 与连字符、连字符后非空、总长 8..=96。
/// 保留 id（`app`、`markdown-editor`）段数不足 3，天然被拒，无需单独判断。
pub fn is_valid_plugin_id(id: &str) -> bool {
    if id.len() < PLUGIN_ID_MIN || id.len() > PLUGIN_ID_MAX || !id.is_ascii() {
        return false;
    }
    let segments: Vec<&str> = id.split('.').collect();
    if segments.len() < PLUGIN_ID_MIN_SEGMENTS || segments.len() > PLUGIN_ID_MAX_SEGMENTS {
        return false;
    }
    segments.iter().all(|segment| is_valid_segment(segment))
}

fn is_valid_segment(segment: &str) -> bool {
    let bytes = segment.as_bytes();
    if bytes
        .first()
        .is_none_or(|first| !first.is_ascii_lowercase())
    {
        return false;
    }
    segment.split('-').all(|part| {
        !part.is_empty()
            && part
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
    })
}

/// `<appData>/plugins`，不存在时创建。
pub fn plugins_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = plugins_root_at(
        &app.path()
            .app_data_dir()
            .map_err(|error| format!("resolve app data dir: {error}"))?,
    );
    std::fs::create_dir_all(&root).map_err(|error| format!("create plugins dir: {error}"))?;
    Ok(root)
}

/// 与 `plugins_root` 同构，但不依赖 `AppHandle`（CLI 与测试用）。
pub fn plugins_root_at(data_dir: &Path) -> PathBuf {
    data_dir.join("plugins")
}

/// 把包内相对路径解析到插件目录内，越界（`..`、绝对路径、符号链接逃逸）一律拒绝。
///
/// 目标必须已存在（`canonicalize` 语义）：文件缺失返回 `asset not found: ...`，
/// 插件目录缺失返回 `plugin dir not found: ...`，二者可区分。
/// 返回已规范化的绝对路径，调用方不要缓存（存在 TOCTOU 窗口）；
/// `rel` 为空时返回插件目录自身，调用方需自行拒绝空路径。
///
/// 本任务尚无 Tauri 命令消费它（任务 7 的 `plugin_read_asset` 会用到），先按契约实现并测试。
#[allow(dead_code)]
pub fn resolve_inside(root: &Path, id: &str, rel: &str) -> Result<PathBuf, String> {
    if !is_valid_plugin_id(id) {
        return Err(format!("invalid plugin id: {id}"));
    }
    let relative = Path::new(rel);
    if relative.is_absolute() {
        return Err(format!("absolute path not allowed: {rel}"));
    }
    if relative
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!("parent traversal not allowed: {rel}"));
    }
    let base = root.join(id);
    let base = base
        .canonicalize()
        .map_err(|error| format!("plugin dir not found: {error}"))?;
    let target = base
        .join(relative)
        .canonicalize()
        .map_err(|error| format!("asset not found: {error}"))?;
    if !target.starts_with(&base) {
        return Err(format!("resolved outside plugin dir: {}", target.display()));
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::test_support::TempRoot;

    const ACCEPTED: &[&str] = &[
        "app.textox.table",
        "io.github.acme.test",
        "com.example.my-plugin",
        "app.textox.sub-sup",
    ];

    const REJECTED: &[&str] = &[
        "table",
        "app.textox",
        "Com.textox.table",
        "com_texto.table",
        "com..table",
        "app.textox.-table",
        "app.textox.table-",
        "app",
        "markdown-editor",
        "a.b.c",
        "a.b.c.d.e.f.g.h.i",
    ];

    #[test]
    fn accepts_java_style_ids() {
        for id in ACCEPTED {
            assert!(is_valid_plugin_id(id), "expected valid: {id}");
        }
    }

    #[test]
    fn rejects_malformed_ids() {
        for id in REJECTED {
            assert!(!is_valid_plugin_id(id), "expected invalid: {id}");
        }
    }

    #[test]
    fn rejects_ids_outside_the_length_range() {
        assert!(!is_valid_plugin_id(&"a".repeat(97)));
        let len_96 = format!("{}.{}.{}", "a".repeat(30), "b".repeat(31), "c".repeat(33));
        assert_eq!(len_96.len(), 96);
        assert!(is_valid_plugin_id(&len_96));
    }

    #[test]
    fn resolve_inside_rejects_traversal_and_absolute_paths() {
        let root = TempRoot::new("textox-paths");
        let plugin_dir = root.path().join("app.textox.demo");
        std::fs::create_dir_all(plugin_dir.join("dist")).unwrap();
        std::fs::write(plugin_dir.join("dist/index.js"), "x").unwrap();

        assert!(resolve_inside(root.path(), "app.textox.demo", "dist/index.js").is_ok());
        assert!(resolve_inside(root.path(), "app.textox.demo", "../escape.js").is_err());
        assert!(resolve_inside(root.path(), "app.textox.demo", "/etc/passwd").is_err());
        assert!(resolve_inside(root.path(), "bad", "dist/index.js").is_err());
    }

    #[test]
    #[cfg(unix)]
    fn resolve_inside_rejects_symlink_escape() {
        let root = TempRoot::new("textox-paths");
        let plugin_dir = root.path().join("app.textox.demo");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(root.path().join("secret.txt"), "s").unwrap();
        std::os::unix::fs::symlink(root.path().join("secret.txt"), plugin_dir.join("link.txt"))
            .unwrap();

        let error = resolve_inside(root.path(), "app.textox.demo", "link.txt").unwrap_err();
        assert!(error.contains("outside plugin dir"), "{error}");
    }
}
