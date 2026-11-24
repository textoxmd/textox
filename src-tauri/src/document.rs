use serde::Serialize;
use tauri::{command, AppHandle};

use crate::temp_files::TempFileManager;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OpenDocumentKind {
    Temp,
    File,
    Directory,
    Missing,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpenDocument {
    pub kind: OpenDocumentKind,
    pub content: Option<String>,
}

/// 纯逻辑部分（不依赖 `AppHandle`，便于单测）：按 `is_temp` 与文件系统状态决定 kind 并读取内容。
///
/// 只有 `NotFound` 映射为 `Missing`（前端据此走「文件不存在」兜底）；其余 metadata 错误
/// 与读取错误一律返回带路径的 `Err`，交回前端已有的失败兜底，而不是伪装成文件不存在。
fn resolve_with(is_temp: bool, path: &str) -> Result<OpenDocument, String> {
    if is_temp {
        let content = std::fs::read_to_string(path).map_err(|e| format!("{}: {}", path, e))?;
        return Ok(OpenDocument {
            kind: OpenDocumentKind::Temp,
            content: Some(content),
        });
    }

    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(OpenDocument {
                kind: OpenDocumentKind::Missing,
                content: None,
            })
        }
        Err(e) => return Err(format!("{}: {}", path, e)),
    };

    if metadata.is_dir() {
        return Ok(OpenDocument {
            kind: OpenDocumentKind::Directory,
            content: None,
        });
    }

    if metadata.is_file() {
        let content = std::fs::read_to_string(path).map_err(|e| format!("{}: {}", path, e))?;
        return Ok(OpenDocument {
            kind: OpenDocumentKind::File,
            content: Some(content),
        });
    }

    Ok(OpenDocument {
        kind: OpenDocumentKind::Missing,
        content: None,
    })
}

/// 冷启动打开文档：一次调用完成 temp 判定 + 类型判定 + 内容读取。
#[command]
pub async fn open_document(app: AppHandle, path: String) -> Result<OpenDocument, String> {
    tokio::task::spawn_blocking(move || {
        let is_temp = TempFileManager::is_temp_path(&app, &path);
        resolve_with(is_temp, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);

    /// 生成系统临时目录下的唯一路径（进程 id + 纳秒 + 自增序号），避免并行测试互撞。
    fn unique_path(name: &str) -> std::path::PathBuf {
        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "textox-document-test-{}-{}-{}-{}",
            std::process::id(),
            nanos,
            seq,
            name
        ))
    }

    /// 测试结束自动清理（drop 时删除文件或目录）
    struct TempEntry {
        path: std::path::PathBuf,
        is_dir: bool,
    }

    impl Drop for TempEntry {
        fn drop(&mut self) {
            if self.is_dir {
                let _ = std::fs::remove_dir_all(&self.path);
            } else {
                let _ = std::fs::remove_file(&self.path);
            }
        }
    }

    fn create_file(name: &str, content: &str) -> (TempEntry, String) {
        let path = unique_path(name);
        std::fs::write(&path, content).expect("failed to write temp file");
        let path_str = path.to_string_lossy().to_string();
        (
            TempEntry {
                path,
                is_dir: false,
            },
            path_str,
        )
    }

    #[test]
    fn reads_temp_file() {
        let (_guard, path) = create_file("temp.md", "# temp");

        let doc = resolve_with(true, &path).expect("temp file should be readable");

        assert_eq!(doc.kind, OpenDocumentKind::Temp);
        assert_eq!(doc.content.as_deref(), Some("# temp"));
    }

    #[test]
    fn reads_regular_file() {
        let (_guard, path) = create_file("file.md", "# file");

        let doc = resolve_with(false, &path).expect("regular file should be readable");

        assert_eq!(doc.kind, OpenDocumentKind::File);
        assert_eq!(doc.content.as_deref(), Some("# file"));
    }

    #[test]
    fn detects_directory_without_content() {
        let path = unique_path("dir");
        std::fs::create_dir_all(&path).expect("failed to create temp dir");
        let _guard = TempEntry {
            path: path.clone(),
            is_dir: true,
        };

        let doc = resolve_with(false, &path.to_string_lossy()).expect("directory should resolve");

        assert_eq!(doc.kind, OpenDocumentKind::Directory);
        assert!(doc.content.is_none());
    }

    #[test]
    fn missing_path_resolves_to_missing() {
        let path = unique_path("missing.md");
        assert!(!path.exists());

        let doc =
            resolve_with(false, &path.to_string_lossy()).expect("missing path is not an error");

        assert_eq!(doc.kind, OpenDocumentKind::Missing);
        assert!(doc.content.is_none());
    }

    #[test]
    fn missing_temp_file_returns_error_with_path() {
        let path = unique_path("missing-temp.md");
        let path_str = path.to_string_lossy().to_string();
        assert!(!path.exists());

        let err = resolve_with(true, &path_str).expect_err("unreadable temp file must be an error");

        assert!(err.contains(&path_str), "error should contain path: {err}");
    }
}
