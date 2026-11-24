use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{command, AppHandle, Manager};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TempFile {
    pub path: String,
    pub created_at: i64,
}

pub struct TempFileManager;

/// 判断 `path` 是否位于 `dir` 目录内（组件级词法匹配）。
/// 与字符串 `starts_with` 不同，`/tmp/textox/temp-evil/...` 不会被
/// 误判为位于 `/tmp/textox/temp` 内；同时拒绝 `.` / `..` 组件，
/// 防止 `<temp>/../../...` 这类词法逃逸绕过检查。
fn path_within_dir(path: &std::path::Path, dir: &std::path::Path) -> bool {
    if path.components().any(|c| {
        matches!(
            c,
            std::path::Component::CurDir | std::path::Component::ParentDir
        )
    }) {
        return false;
    }
    path.starts_with(dir)
}

/// 规范化后校验：解析符号链接（以及 `/tmp` → `/private/tmp` 这类别名）后，
/// `path` 必须仍然位于 `dir` 内。路径不存在或无法规范化时返回 `false`。
fn path_resolves_within_dir(path: &std::path::Path, dir: &std::path::Path) -> bool {
    let Ok(path_canon) = path.canonicalize() else {
        return false;
    };
    let dir_canon = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
    path_canon.starts_with(&dir_canon)
}

impl TempFileManager {
    fn temp_dir(app: &AppHandle) -> Result<PathBuf, String> {
        let dir = app
            .path()
            .temp_dir()
            .map_err(|e| e.to_string())?
            .join("textox")
            .join("temp");
        Ok(dir)
    }

    fn ensure_dir_exists(app: &AppHandle) -> Result<PathBuf, String> {
        let dir = Self::temp_dir(app)?;
        if !dir.exists() {
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        }
        Ok(dir)
    }

    pub fn list_temp_files(app: &AppHandle) -> Result<Vec<TempFile>, String> {
        let dir = Self::temp_dir(app)?;
        if !dir.exists() {
            return Ok(vec![]);
        }
        let mut files = vec![];
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            // 临时目录由应用独占，列出其中的所有文件（不再限定 .md）：
            // 其他文件类型编辑器（如白板）的临时文件也要能被恢复。
            if path.is_file() {
                let metadata = entry.metadata().map_err(|e| e.to_string())?;
                let created_at = metadata
                    .created()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);
                files.push(TempFile {
                    path: path.to_string_lossy().to_string(),
                    created_at,
                });
            }
        }
        files.sort_by_key(|f| f.created_at);
        Ok(files)
    }

    pub fn create_temp_file(
        app: &AppHandle,
        content: &str,
        extension: Option<&str>,
    ) -> Result<TempFile, String> {
        let dir = Self::ensure_dir_exists(app)?;
        let id = Uuid::new_v4().to_string();
        // 扩展名白名单校验（仅 ASCII 字母数字），避免路径注入；缺省为 md。
        let ext = extension
            .map(str::trim)
            .filter(|e| !e.is_empty() && e.chars().all(|c| c.is_ascii_alphanumeric()))
            .unwrap_or("md");
        let file_path = dir.join(format!("{}.{}", id, ext));
        std::fs::write(&file_path, content).map_err(|e| e.to_string())?;
        Ok(TempFile {
            path: file_path.to_string_lossy().to_string(),
            created_at: Utc::now().timestamp(),
        })
    }

    pub fn delete_temp_file(app: &AppHandle, path: &str) -> Result<(), String> {
        let path = PathBuf::from(path);
        // 仅允许删除临时目录内的文件，防止前端误传任意路径
        if !Self::is_temp_path(app, &path.to_string_lossy()) {
            return Err("Path is outside the temp directory".to_string());
        }
        if path.exists() {
            // 词法检查已拒绝 `..`；文件存在时再做规范化校验，
            // 防止通过临时目录内的符号链接指向目录外文件。
            let dir = Self::temp_dir(app)?;
            if !path_resolves_within_dir(&path, &dir) {
                return Err("Path is outside the temp directory".to_string());
            }
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn read_temp_file(path: &str) -> Result<String, String> {
        std::fs::read_to_string(path).map_err(|e| e.to_string())
    }

    pub fn is_temp_path(app: &AppHandle, path: &str) -> bool {
        if let Ok(dir) = Self::temp_dir(app) {
            path_within_dir(PathBuf::from(path).as_path(), &dir)
        } else {
            false
        }
    }

    pub fn cleanup_old_temp_files(app: &AppHandle) -> Result<(), String> {
        let dir = Self::temp_dir(app)?;
        if !dir.exists() {
            return Ok(());
        }
        let now = Utc::now().timestamp();
        let seven_days = 7 * 24 * 60 * 60;
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            // 清理所有类型的旧临时文件（不再限定 .md）
            if path.is_file() {
                if let Ok(metadata) = entry.metadata() {
                    if let Ok(created) = metadata.created() {
                        if let Ok(duration) = created.duration_since(std::time::UNIX_EPOCH) {
                            if now - duration.as_secs() as i64 > seven_days {
                                let _ = std::fs::remove_file(&path);
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }
}

#[command]
pub async fn list_temp_files(app: AppHandle) -> Result<Vec<TempFile>, String> {
    TempFileManager::list_temp_files(&app)
}

#[command]
pub async fn create_temp_file(
    app: AppHandle,
    content: String,
    extension: Option<String>,
) -> Result<TempFile, String> {
    TempFileManager::create_temp_file(&app, &content, extension.as_deref())
}

#[command]
pub async fn delete_temp_file(app: AppHandle, path: String) -> Result<(), String> {
    TempFileManager::delete_temp_file(&app, &path)
}

#[command]
pub async fn read_temp_file(path: String) -> Result<String, String> {
    TempFileManager::read_temp_file(&path)
}

#[command]
pub async fn is_temp_path(app: AppHandle, path: String) -> Result<bool, String> {
    Ok(TempFileManager::is_temp_path(&app, &path))
}

#[command]
pub async fn cleanup_temp_files(app: AppHandle) -> Result<(), String> {
    TempFileManager::cleanup_old_temp_files(&app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn path_within_dir_matches_components_not_string_prefix() {
        let dir = std::path::Path::new("/tmp/textox/temp");
        assert!(path_within_dir(Path::new("/tmp/textox/temp/a.md"), dir));
        assert!(path_within_dir(Path::new("/tmp/textox/temp/sub/b.md"), dir));
        assert!(path_within_dir(Path::new("/tmp/textox/temp"), dir));
        // 同级目录 "temp-evil" 不应匹配（旧实现会因字符串前缀误判）
        assert!(!path_within_dir(
            Path::new("/tmp/textox/temp-evil/a.md"),
            dir
        ));
        // 父目录不是目标目录
        assert!(!path_within_dir(Path::new("/tmp/textox/a.md"), dir));
    }

    #[test]
    fn path_within_dir_rejects_dotdot_escape() {
        let dir = std::path::Path::new("/tmp/textox/temp");
        assert!(!path_within_dir(
            Path::new("/tmp/textox/temp/../../etc/passwd"),
            dir
        ));
        assert!(!path_within_dir(
            Path::new("/tmp/textox/temp/sub/../escape.md"),
            dir
        ));
        // 内部 "." 会被 Path::components 归一化掉，等价于 temp 内路径，属无害放行
        assert!(path_within_dir(Path::new("/tmp/textox/temp/./x.md"), dir));
        assert!(!path_within_dir(Path::new("../outside.md"), dir));
        assert!(!path_within_dir(Path::new("./x.md"), dir));
        assert!(!path_within_dir(Path::new("."), dir));
        assert!(!path_within_dir(Path::new(".."), dir));
    }

    #[test]
    fn path_within_dir_rejects_relative_escape() {
        let dir = std::path::Path::new("/tmp/textox/temp");
        assert!(!path_within_dir(Path::new("/etc/passwd"), dir));
        assert!(!path_within_dir(Path::new(""), dir));
    }

    #[test]
    fn path_resolves_within_dir_rejects_symlink_escape() {
        let base = std::env::temp_dir().join(format!("textox-tmp-test-{}", std::process::id()));
        let inside = base.join("inside");
        let outside = base.join("outside");
        std::fs::create_dir_all(&inside).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        std::fs::write(inside.join("a.md"), "x").unwrap();
        std::fs::write(outside.join("victim.md"), "x").unwrap();
        assert!(path_resolves_within_dir(&inside.join("a.md"), &inside));
        assert!(!path_resolves_within_dir(
            &inside.join("missing.md"),
            &inside
        ));

        // 临时目录内的符号链接指向目录外：规范化后必须被拒绝
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            symlink(&outside, inside.join("escape")).unwrap();
            assert!(!path_resolves_within_dir(
                &inside.join("escape").join("victim.md"),
                &inside
            ));
        }

        let _ = std::fs::remove_dir_all(&base);
    }
}
