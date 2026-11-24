use std::path::{Path, PathBuf};

use base64::Engine;
use tauri::AppHandle;

use super::paths::{plugins_root, resolve_inside};

const ALLOWED_EXT: &[&str] = &[
    "js", "mjs", "css", "json", "png", "jpg", "jpeg", "svg", "webp", "woff", "woff2", "wasm",
];
const MAX_ASSET_BYTES: u64 = 64 * 1024 * 1024;

fn ensure_asset_size(len: u64, max_bytes: u64) -> Result<(), String> {
    if len > max_bytes {
        return Err(format!("asset too large: {len} bytes"));
    }
    Ok(())
}

/// 读取插件包内资产，返回 base64。路径越界由 `resolve_inside` 拒绝
/// （`..`、绝对路径、符号链接逃逸），扩展名走白名单，大小上限为 `MAX_ASSET_BYTES`。
///
/// 传输格式固定为 base64，调用方峰值内存约 4/3 × 文件大小。
pub fn read_asset(root: &Path, plugin_id: &str, rel: &str) -> Result<String, String> {
    read_asset_limited(root, plugin_id, rel, MAX_ASSET_BYTES)
}

/// 同 `read_asset`，但大小上限可注入（便于用小文件覆盖超限分支）。
fn read_asset_limited(
    root: &Path,
    plugin_id: &str,
    rel: &str,
    max_bytes: u64,
) -> Result<String, String> {
    if rel.is_empty() {
        return Err("asset path is empty".to_string());
    }
    let target = resolve_inside(root, plugin_id, rel)?;
    let ext = target
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .ok_or_else(|| format!("asset has no extension: {rel}"))?;
    if !ALLOWED_EXT.contains(&ext.as_str()) {
        return Err(format!("extension not allowed: {ext}"));
    }
    let meta = std::fs::metadata(&target).map_err(|error| format!("read asset: {error}"))?;
    ensure_asset_size(meta.len(), max_bytes)?;
    let bytes = std::fs::read(&target).map_err(|error| format!("read asset: {error}"))?;
    // metadata 与 read 之间文件可能已被放大，按实际字节数再校验一次
    ensure_asset_size(bytes.len() as u64, max_bytes)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// 解析插件包内资产的绝对路径，并把它放行到 asset 协议 scope。
///
/// 给需要 `fetch` 大文件（如 56MB 的 pandoc wasm）的插件用：base64 走 IPC 的峰值内存
/// 约为文件大小 × 2.3，而 asset 协议可以直接流式读取。路径校验与 `plugin_read_asset`
/// 完全一致（`resolve_inside` + 扩展名白名单）。
pub fn asset_path(root: &Path, plugin_id: &str, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() {
        return Err("asset path is empty".to_string());
    }
    let target = resolve_inside(root, plugin_id, rel)?;
    let ext = target
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .ok_or_else(|| format!("asset has no extension: {rel}"))?;
    if !ALLOWED_EXT.contains(&ext.as_str()) {
        return Err(format!("extension not allowed: {ext}"));
    }
    Ok(target)
}

#[tauri::command(async)]
pub fn plugin_asset_path(
    app: AppHandle,
    plugin_id: String,
    path: String,
) -> Result<String, String> {
    let root = plugins_root(&app)?;
    let target = asset_path(&root, &plugin_id, &path)?;
    crate::extend_asset_scope_impl(app, target.to_string_lossy().into_owned())?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command(async)]
pub fn plugin_read_asset(
    app: AppHandle,
    plugin_id: String,
    path: String,
) -> Result<String, String> {
    let root = plugins_root(&app)?;
    read_asset(&root, &plugin_id, &path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::test_support::TempRoot;

    fn demo_with(files: &[(&str, &str)]) -> TempRoot {
        let root = TempRoot::new("textox-assets");
        let plugin_dir = root.path().join("app.textox.demo");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        for (rel, content) in files {
            let path = plugin_dir.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, content).unwrap();
        }
        root
    }

    #[test]
    fn allowlist_covers_script_style_and_font_assets() {
        for ext in ["js", "css", "woff2"] {
            assert!(ALLOWED_EXT.contains(&ext), "expected allowed: {ext}");
        }
        for ext in ["exe", "html"] {
            assert!(!ALLOWED_EXT.contains(&ext), "expected rejected: {ext}");
        }
    }

    #[test]
    fn reads_asset_content_as_base64() {
        let root = demo_with(&[("dist/index.js", "export const x = 1;")]);

        let encoded = read_asset(root.path(), "app.textox.demo", "dist/index.js").unwrap();
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap();
        assert_eq!(String::from_utf8(decoded).unwrap(), "export const x = 1;");
    }

    #[test]
    fn rejects_empty_path_and_disallowed_extension() {
        let root = demo_with(&[("dist/index.js", "x"), ("dist/run.exe", "x")]);

        assert_eq!(
            read_asset(root.path(), "app.textox.demo", "").unwrap_err(),
            "asset path is empty"
        );
        let error = read_asset(root.path(), "app.textox.demo", "dist/run.exe").unwrap_err();
        assert!(error.contains("extension not allowed"), "{error}");
    }

    #[test]
    fn rejects_assets_over_the_size_limit() {
        assert!(ensure_asset_size(MAX_ASSET_BYTES, MAX_ASSET_BYTES).is_ok());
        let error = ensure_asset_size(MAX_ASSET_BYTES + 1, MAX_ASSET_BYTES).unwrap_err();
        assert!(error.contains("asset too large"), "{error}");
    }

    #[test]
    fn reads_uppercase_extensions() {
        let root = TempRoot::new("textox-assets");
        let dir = root.path().join("app.textox.demo").join("dist");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.JS"), "x").unwrap();

        assert!(read_asset(root.path(), "app.textox.demo", "dist/index.JS").is_ok());
    }

    #[test]
    fn asset_path_resolves_inside_the_plugin_dir() {
        let root = demo_with(&[("pandoc.wasm", "wasm")]);

        let target = asset_path(root.path(), "app.textox.demo", "pandoc.wasm").unwrap();
        assert!(target.ends_with("app.textox.demo/pandoc.wasm"));

        assert!(asset_path(root.path(), "app.textox.demo", "../escape.wasm").is_err());
        assert!(asset_path(root.path(), "app.textox.demo", "run.exe").is_err());
    }

    #[test]
    fn rejects_assets_over_an_injected_limit() {
        let root = TempRoot::new("textox-assets");
        let dir = root.path().join("app.textox.demo").join("dist");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.js"), "0123456789").unwrap(); // 10 字节

        assert!(read_asset_limited(root.path(), "app.textox.demo", "dist/index.js", 10).is_ok());
        let error =
            read_asset_limited(root.path(), "app.textox.demo", "dist/index.js", 9).unwrap_err();
        assert!(error.contains("asset too large"), "{error}");
    }
}
