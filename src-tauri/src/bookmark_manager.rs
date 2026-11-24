use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::AppHandle;
use tauri::Manager;

/// 目录书签数量上限：打开文档/目录时全量启动访问与扩权，
/// 超过上限后不再批量处理。
pub const MAX_DIRECTORY_BOOKMARKS: usize = 10;

#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2_foundation::NSURL;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkInfo {
    /// 存储书签时使用的路径（书签 key）
    pub path: String,
    /// "file" 或 "directory"
    pub kind: String,
    /// 书签当前是否可解析且目标存在
    pub valid: bool,
    /// 重新解析后的实际路径（文件移动后可能与 key 不同）
    pub resolved_path: Option<String>,
}

/// 书签类型：文件 / 目录 / 未知（旧版格式未记录类型）
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum BookmarkKind {
    File,
    Directory,
    Unknown,
}

#[derive(Debug, Clone)]
struct StoredBookmark {
    kind: BookmarkKind,
    data: Vec<u8>,
}

/// 持久化格式：{ kind, data(base64) }
#[derive(serde::Serialize, serde::Deserialize)]
struct PersistedBookmark {
    kind: BookmarkKind,
    data: String,
}

/// create 注册前的决策结果。
#[derive(Debug, PartialEq, Eq)]
enum CreateDecision {
    /// 已被有效祖先目录书签覆盖：无需重复注册（视为成功）。
    SkipCovered,
    /// 目录书签数量已达上限：拒绝新增。
    TooMany,
    /// 正常创建书签。
    Proceed,
}

pub struct BookmarkManager {
    bookmarks: Mutex<HashMap<PathBuf, StoredBookmark>>,
    active_guards: Mutex<Vec<ScopedAccessGuard>>,
    store_path: PathBuf,
}

impl BookmarkManager {
    pub fn new(app: &AppHandle) -> Self {
        let store_path = app
            .path()
            .app_data_dir()
            .unwrap_or_default()
            .join("bookmarks.json");
        let mut bookmarks = Self::load_from_disk(&store_path);
        // 旧格式书签（无类型信息）一次性迁移：解析后归类为文件/目录，
        // 无法解析的失效书签直接移除。迁移完成后不再残留 Unknown。
        let migrated = Self::migrate_unknown_kinds(&mut bookmarks);
        if migrated {
            // 旧目录书签完成归类后，重新清理被有效目录覆盖的冗余文件书签
            Self::prune_redundant(&mut bookmarks, Self::bookmark_valid);
        }
        let manager = Self {
            bookmarks: Mutex::new(bookmarks),
            active_guards: Mutex::new(Vec::new()),
            store_path,
        };
        if migrated {
            manager.persist();
        }
        manager
    }

    fn load_from_disk(path: &Path) -> HashMap<PathBuf, StoredBookmark> {
        let content = std::fs::read_to_string(path).unwrap_or_default();
        let map: HashMap<String, serde_json::Value> =
            serde_json::from_str(&content).unwrap_or_default();
        let mut bookmarks: HashMap<PathBuf, StoredBookmark> = map
            .into_iter()
            .filter_map(|(k, v)| {
                let stored = match v {
                    // 旧格式：纯 base64 字符串，无类型信息
                    serde_json::Value::String(s) => {
                        BASE64.decode(&s).ok().map(|data| StoredBookmark {
                            kind: BookmarkKind::Unknown,
                            data,
                        })
                    }
                    serde_json::Value::Object(o) => {
                        let kind = o
                            .get("kind")
                            .and_then(|k| k.as_str())
                            .map(|k| match k {
                                "file" => BookmarkKind::File,
                                "directory" => BookmarkKind::Directory,
                                _ => BookmarkKind::Unknown,
                            })
                            .unwrap_or(BookmarkKind::Unknown);
                        let data = o.get("data")?.as_str()?;
                        BASE64
                            .decode(data)
                            .ok()
                            .map(|data| StoredBookmark { kind, data })
                    }
                    _ => None,
                };
                stored.map(|s| (PathBuf::from(k), s))
            })
            .collect();
        Self::prune_redundant(&mut bookmarks, Self::bookmark_valid);
        bookmarks
    }

    /// 旧格式书签（无类型信息）的一次性迁移：解析后归类为文件/目录，
    /// 无法解析的失效书签直接移除。返回是否发生了变更（需要写回存储）。
    ///
    /// 幂等：迁移完成后不再存在 `Unknown` 条目，不会重复执行。
    fn migrate_unknown_kinds(bookmarks: &mut HashMap<PathBuf, StoredBookmark>) -> bool {
        let unknown_keys: Vec<PathBuf> = bookmarks
            .iter()
            .filter(|(_, b)| b.kind == BookmarkKind::Unknown)
            .map(|(p, _)| p.clone())
            .collect();
        if unknown_keys.is_empty() {
            return false;
        }
        let mut classified = 0usize;
        let mut dropped = 0usize;
        for key in unknown_keys {
            let Some(entry) = bookmarks.remove(&key) else {
                continue;
            };
            match Self::classify_unknown(&entry.data) {
                Some(kind) => {
                    bookmarks.insert(
                        key,
                        StoredBookmark {
                            kind,
                            data: entry.data,
                        },
                    );
                    classified += 1;
                }
                None => dropped += 1,
            }
        }
        if classified > 0 || dropped > 0 {
            log::info!(
                "Migrated old-format bookmarks: {} classified, {} stale removed",
                classified,
                dropped
            );
        }
        classified > 0 || dropped > 0
    }

    /// 解析旧格式书签并按其目标实际类型归类；无法解析（目标已移动/删除）时返回 None。
    fn classify_unknown(data: &[u8]) -> Option<BookmarkKind> {
        #[cfg(target_os = "macos")]
        {
            macos::resolve_path(data).ok().map(|p| {
                if p.is_dir() {
                    BookmarkKind::Directory
                } else {
                    BookmarkKind::File
                }
            })
        }
        #[cfg(not(target_os = "macos"))]
        {
            // 非 macOS 无法创建安全作用域书签，旧格式条目无有效数据，直接丢弃
            let _ = data;
            None
        }
    }

    fn persist(&self) {
        let bookmarks = self.bookmarks.lock().unwrap_or_else(|e| e.into_inner());
        let map: HashMap<String, PersistedBookmark> = bookmarks
            .iter()
            .map(|(k, v)| {
                (
                    k.to_string_lossy().to_string(),
                    PersistedBookmark {
                        kind: v.kind,
                        data: BASE64.encode(&v.data),
                    },
                )
            })
            .collect();
        if let Ok(json) = serde_json::to_string(&map) {
            let _ = std::fs::write(&self.store_path, json);
        }
    }

    /// 移除已被“仍然有效”的目录书签覆盖的文件书签（冗余记录）。
    ///
    /// 旧格式（Unknown）可能是目录，但被有效祖先目录覆盖时移除也是安全的——
    /// 访问权限由祖先目录书签提供，不会造成能力丢失。失效目录书签不作为
    /// 覆盖依据，避免误删仍可用的文件书签。
    fn prune_redundant(
        bookmarks: &mut HashMap<PathBuf, StoredBookmark>,
        dir_valid: impl Fn(&StoredBookmark) -> bool,
    ) {
        let dirs: Vec<PathBuf> = bookmarks
            .iter()
            .filter(|(_, b)| b.kind == BookmarkKind::Directory && dir_valid(b))
            .map(|(p, _)| p.clone())
            .collect();
        bookmarks.retain(|path, b| {
            if b.kind == BookmarkKind::Directory {
                return true;
            }
            !dirs.iter().any(|d| path.starts_with(d))
        });
    }

    fn covered_by_directory_with(
        &self,
        path: &Path,
        dir_valid: impl Fn(&StoredBookmark) -> bool,
    ) -> bool {
        let bookmarks = self.bookmarks.lock().unwrap_or_else(|e| e.into_inner());
        let mut current = path.parent();
        while let Some(p) = current {
            if let Some(b) = bookmarks.get(p) {
                // 只有仍可解析的目录书签才视为覆盖；失效目录书签不阻止
                // 记录文件书签，避免重启后该文件失去访问能力。
                if b.kind == BookmarkKind::Directory && dir_valid(b) {
                    return true;
                }
            }
            current = p.parent();
        }
        false
    }

    /// 目录书签是否仍可解析（可作为覆盖依据）。
    fn bookmark_valid(entry: &StoredBookmark) -> bool {
        #[cfg(target_os = "macos")]
        {
            macos::resolve_path(&entry.data).is_ok()
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = entry;
            true
        }
    }

    fn find_ancestor(&self, path: &Path) -> Option<(PathBuf, StoredBookmark)> {
        let bookmarks = self.bookmarks.lock().unwrap_or_else(|e| e.into_inner());
        let mut current = Some(path.to_path_buf());
        while let Some(ref p) = current {
            if let Some(entry) = bookmarks.get(p) {
                return Some((p.clone(), entry.clone()));
            }
            current = p.parent().map(|p| p.to_path_buf());
        }
        None
    }

    /// 决定 create 是否应注册：先判定是否被有效祖先目录书签覆盖
    /// （被覆盖的路径无需注册、也不占用上限名额），再检查目录书签数量上限。
    fn decide_create(
        &self,
        path: &Path,
        is_dir: bool,
        dir_valid: impl Fn(&StoredBookmark) -> bool,
    ) -> CreateDecision {
        if self.covered_by_directory_with(path, dir_valid) {
            return CreateDecision::SkipCovered;
        }
        if is_dir && self.directory_bookmark_paths().len() >= MAX_DIRECTORY_BOOKMARKS {
            return CreateDecision::TooMany;
        }
        CreateDecision::Proceed
    }

    /// 移除指定路径上的书签条目（若有）并持久化，返回是否发生了移除。
    fn remove_bookmark_at(&self, path: &Path) -> bool {
        let mut bookmarks = self.bookmarks.lock().unwrap_or_else(|e| e.into_inner());
        let removed = bookmarks.remove::<Path>(path.as_ref()).is_some();
        drop(bookmarks);
        if removed {
            self.persist();
        }
        removed
    }

    pub fn create(&self, path: &str) -> Result<(), String> {
        let path = PathBuf::from(path);
        #[cfg(target_os = "macos")]
        {
            let is_dir = path.is_dir();
            match self.decide_create(&path, is_dir, Self::bookmark_valid) {
                // 已被有效祖先目录书签覆盖：文件/子目录都无需重复记录。
                // 若同路径残留旧条目（此前误注册过），一并清掉，避免书签列表堆积。
                CreateDecision::SkipCovered => {
                    self.remove_bookmark_at(&path);
                    return Ok(());
                }
                // 目录授权有上限：超过后设置页/后端均拒绝新增
                CreateDecision::TooMany => {
                    return Err(format!(
                        "Too many directory bookmarks (max {})",
                        MAX_DIRECTORY_BOOKMARKS
                    ));
                }
                CreateDecision::Proceed => {}
            }

            let data = macos::create_bookmark(&path)?;
            let kind = if is_dir {
                BookmarkKind::Directory
            } else {
                BookmarkKind::File
            };
            let mut bookmarks = self.bookmarks.lock().unwrap_or_else(|e| e.into_inner());
            bookmarks.insert(path.clone(), StoredBookmark { kind, data });
            // 新授权一个目录后，其下已记录的文件书签全部冗余，一并移除
            if kind == BookmarkKind::Directory {
                bookmarks.retain(|p, b| !(b.kind == BookmarkKind::File && p.starts_with(&path)));
            }
            drop(bookmarks);
            self.persist();
        }
        #[cfg(not(target_os = "macos"))]
        {
            return Err("Security-scoped bookmarks are only supported on macOS".into());
        }
        #[cfg(target_os = "macos")]
        Ok(())
    }

    pub fn has(&self, path: &str) -> bool {
        self.find_ancestor(Path::new(path)).is_some()
    }

    pub fn revoke(&self, path: &str) {
        self.bookmarks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove::<Path>(path.as_ref());
        self.persist();
    }

    pub fn revoke_all(&self, paths: &[String]) {
        let mut bookmarks = self.bookmarks.lock().unwrap_or_else(|e| e.into_inner());
        for p in paths {
            bookmarks.remove::<Path>(p.as_ref());
        }
        drop(bookmarks);
        self.persist();
    }

    pub fn start_access(&self, path: &str) -> Result<(), String> {
        let (matched_path, data) = self
            .find_ancestor(Path::new(path))
            .ok_or_else(|| "no_bookmark".to_string())?;
        #[cfg(target_os = "macos")]
        {
            match macos::resolve_and_start(&data.data) {
                Ok(guard) => {
                    self.active_guards
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .push(guard);
                }
                Err(_) => {
                    self.revoke(&matched_path.to_string_lossy());
                    return Err("bookmark_stale".into());
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = data;
        }
        Ok(())
    }

    /// 应用启动时恢复全部书签的沙盒访问权限。
    ///
    /// 书签只负责持久化“用户授权过哪些位置”，重启后必须调用
    /// `startAccessingSecurityScopedResource` 才能真正读文件；
    /// 否则“打开方式/待打开文件”等不经过对话框的路径会因沙盒
    /// 无权限而失败（图片 403、文件读不到）。失效书签会被移除。
    pub fn start_all(&self) {
        let paths: Vec<String> = self
            .bookmarks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .keys()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        for path in paths {
            if let Err(err) = self.start_access(&path) {
                log::warn!("Failed to restore bookmark access for {}: {}", path, err);
            }
        }
    }

    /// 全部目录书签的路径（打开文档/目录时批量启动访问与扩权用）。
    pub fn directory_bookmark_paths(&self) -> Vec<PathBuf> {
        let bookmarks = self.bookmarks.lock().unwrap_or_else(|e| e.into_inner());
        bookmarks
            .iter()
            .filter(|(_, b)| b.kind == BookmarkKind::Directory)
            .map(|(p, _)| p.clone())
            .collect()
    }

    /// 列出全部书签及可用状态，供设置窗口的书签管理页使用。
    pub fn list(&self) -> Vec<BookmarkInfo> {
        let bookmarks = self.bookmarks.lock().unwrap_or_else(|e| e.into_inner());
        let mut items: Vec<BookmarkInfo> = bookmarks
            .iter()
            .map(|(path, entry)| {
                let key_path = path.to_string_lossy().to_string();
                #[cfg(target_os = "macos")]
                {
                    match macos::resolve_path(&entry.data) {
                        Ok(resolved) => {
                            let kind = match entry.kind {
                                BookmarkKind::Directory => "directory",
                                // 旧格式没有类型：解析后能确认是目录就用目录
                                _ if resolved.is_dir() => "directory",
                                _ => "file",
                            };
                            BookmarkInfo {
                                path: key_path,
                                resolved_path: Some(resolved.to_string_lossy().to_string()),
                                kind: kind.to_string(),
                                valid: resolved.exists(),
                            }
                        }
                        Err(_) => BookmarkInfo {
                            path: key_path,
                            resolved_path: None,
                            kind: match entry.kind {
                                BookmarkKind::Directory => "directory".to_string(),
                                _ => "file".to_string(),
                            },
                            valid: false,
                        },
                    }
                }
                #[cfg(not(target_os = "macos"))]
                {
                    let kind = match entry.kind {
                        BookmarkKind::Directory => "directory",
                        _ if path.is_dir() => "directory",
                        _ => "file",
                    };
                    BookmarkInfo {
                        path: key_path.clone(),
                        resolved_path: Some(key_path),
                        kind: kind.to_string(),
                        valid: path.exists(),
                    }
                }
            })
            .collect();
        items.sort_by(|a, b| a.path.cmp(&b.path));
        items
    }

    /// 持有由系统保存面板（NSSavePanel）返回的 security-scoped URL。
    ///
    /// 沙盒应用下保存面板返回的 URL 携带安全作用域，必须在面板关闭后立即
    /// 启动访问并保留 URL，否则稍后按路径写入会因沙盒权限失败。
    /// 访问权限一直保持到应用退出（与 `start_access` 的守卫生命周期一致）。
    #[cfg(target_os = "macos")]
    pub fn hold_save_panel_url(&self, url: Retained<NSURL>) -> bool {
        if !unsafe { url.startAccessingSecurityScopedResource() } {
            return false;
        }
        let url_ptr = Retained::into_raw(url) as usize;
        self.active_guards
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(ScopedAccessGuard { url_ptr });
        true
    }
}

pub struct ScopedAccessGuard {
    url_ptr: usize,
}

unsafe impl Send for ScopedAccessGuard {}

#[cfg(target_os = "macos")]
impl Drop for ScopedAccessGuard {
    fn drop(&mut self) {
        if self.url_ptr != 0 {
            unsafe {
                let url = self.url_ptr as *mut NSURL;
                let url_ref = &*url;
                url_ref.stopAccessingSecurityScopedResource();
                let _ = Retained::<NSURL>::from_raw(url);
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
impl Drop for ScopedAccessGuard {
    fn drop(&mut self) {}
}

#[cfg(target_os = "macos")]
mod macos {
    use std::path::Path;

    use objc2::rc::Retained;
    use objc2_foundation::{NSData, NSString, NSURL};

    use super::ScopedAccessGuard;

    pub fn create_bookmark(path: &Path) -> Result<Vec<u8>, String> {
        let ns_path = NSString::from_str(&path.to_string_lossy());
        let url = NSURL::fileURLWithPath(&ns_path);

        let data = url
            .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
                // 必须显式创建 security-scoped bookmark，才能在应用重启后恢复沙盒访问权限。
                objc2_foundation::NSURLBookmarkCreationOptions::WithSecurityScope,
                None,
                None,
            )
            .map_err(|e| format!("Failed to create bookmark: {}", e.localizedDescription()))?;

        let len = data.length();
        let mut buf = vec![0u8; len];
        unsafe {
            data.getBytes_length(
                std::ptr::NonNull::new(buf.as_mut_ptr().cast()).unwrap(),
                len,
            );
        }
        Ok(buf)
    }

    pub fn resolve_and_start(data: &[u8]) -> Result<ScopedAccessGuard, String> {
        let ns_data = unsafe { NSData::dataWithBytes_length(data.as_ptr().cast(), data.len()) };

        let mut is_stale = objc2::runtime::Bool::NO;

        let url = unsafe {
            NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                &ns_data,
                security_scope_resolution_options(),
                None,
                &mut is_stale,
            )
        }
        .map_err(|_| "bookmark_stale")?;

        if !unsafe { url.startAccessingSecurityScopedResource() } {
            return Err("Failed to start accessing".into());
        }

        let url_ptr = Retained::into_raw(url) as usize;
        Ok(ScopedAccessGuard { url_ptr })
    }

    /// 仅解析书签（不启动访问），用于书签列表的可用性检查。
    pub fn resolve_path(data: &[u8]) -> Result<std::path::PathBuf, String> {
        let ns_data = unsafe { NSData::dataWithBytes_length(data.as_ptr().cast(), data.len()) };

        let mut is_stale = objc2::runtime::Bool::NO;

        let url = unsafe {
            NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                &ns_data,
                security_scope_resolution_options(),
                None,
                &mut is_stale,
            )
        }
        .map_err(|_| "bookmark_stale")?;

        url.path()
            .map(|p| std::path::PathBuf::from(p.to_string()))
            .ok_or_else(|| "bookmark_no_path".to_string())
    }

    /// security-scoped 书签的解析选项：
    /// - WithSecurityScope：按安全作用域解析，恢复沙盒访问能力
    /// - WithoutUI：解析失败时不弹出系统 UI
    /// - WithoutImplicitStartAccessing：不隐式启动访问，由调用方显式管理
    fn security_scope_resolution_options() -> objc2_foundation::NSURLBookmarkResolutionOptions {
        use objc2_foundation::NSURLBookmarkResolutionOptions;
        NSURLBookmarkResolutionOptions::WithSecurityScope
            | NSURLBookmarkResolutionOptions::WithoutUI
            | NSURLBookmarkResolutionOptions::WithoutImplicitStartAccessing
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_ancestor_exact_match() {
        let mut map = HashMap::new();
        map.insert(
            PathBuf::from("/a/b/c"),
            StoredBookmark {
                kind: BookmarkKind::File,
                data: vec![1, 2, 3],
            },
        );
        let mgr = BookmarkManager {
            bookmarks: Mutex::new(map),
            active_guards: Mutex::new(Vec::new()),
            store_path: PathBuf::new(),
        };
        let r = mgr.find_ancestor(Path::new("/a/b/c"));
        assert!(r.is_some());
        assert_eq!(r.unwrap().0, PathBuf::from("/a/b/c"));
    }

    #[test]
    fn find_ancestor_parent_match() {
        let mut map = HashMap::new();
        map.insert(
            PathBuf::from("/a/b"),
            StoredBookmark {
                kind: BookmarkKind::Directory,
                data: vec![10],
            },
        );
        let mgr = BookmarkManager {
            bookmarks: Mutex::new(map),
            active_guards: Mutex::new(Vec::new()),
            store_path: PathBuf::new(),
        };
        let r = mgr.find_ancestor(Path::new("/a/b/c/d/file.md"));
        assert!(r.is_some());
        assert_eq!(r.unwrap().0, PathBuf::from("/a/b"));
    }

    #[test]
    fn find_ancestor_no_match() {
        let mgr = BookmarkManager {
            bookmarks: Mutex::new(HashMap::new()),
            active_guards: Mutex::new(Vec::new()),
            store_path: PathBuf::new(),
        };
        assert!(mgr.find_ancestor(Path::new("/x/y/z")).is_none());
    }

    #[test]
    fn find_ancestor_exact_beats_parent() {
        let mut map = HashMap::new();
        map.insert(
            PathBuf::from("/a"),
            StoredBookmark {
                kind: BookmarkKind::Directory,
                data: vec![1],
            },
        );
        map.insert(
            PathBuf::from("/a/b"),
            StoredBookmark {
                kind: BookmarkKind::Directory,
                data: vec![2],
            },
        );
        let mgr = BookmarkManager {
            bookmarks: Mutex::new(map),
            active_guards: Mutex::new(Vec::new()),
            store_path: PathBuf::new(),
        };
        let r = mgr.find_ancestor(Path::new("/a/b"));
        assert_eq!(r.unwrap().1.data, vec![2]);
    }

    #[test]
    fn covered_by_directory_detects_ancestor_dir() {
        let mut map = HashMap::new();
        map.insert(
            PathBuf::from("/a/b"),
            StoredBookmark {
                kind: BookmarkKind::Directory,
                data: vec![1],
            },
        );
        let mgr = BookmarkManager {
            bookmarks: Mutex::new(map),
            active_guards: Mutex::new(Vec::new()),
            store_path: PathBuf::new(),
        };
        assert!(mgr.covered_by_directory_with(Path::new("/a/b/c/file.md"), |_| true));
    }

    #[test]
    fn covered_by_directory_ignores_own_file_bookmark() {
        let mut map = HashMap::new();
        map.insert(
            PathBuf::from("/a/b/file.md"),
            StoredBookmark {
                kind: BookmarkKind::File,
                data: vec![1],
            },
        );
        let mgr = BookmarkManager {
            bookmarks: Mutex::new(map),
            active_guards: Mutex::new(Vec::new()),
            store_path: PathBuf::new(),
        };
        // 只有文件自身书签、没有祖先目录书签时，不应判定为“已覆盖”
        assert!(!mgr.covered_by_directory_with(Path::new("/a/b/file.md"), |_| true));
    }

    #[test]
    fn covered_by_directory_ignores_invalid_dir_bookmark() {
        let mut map = HashMap::new();
        map.insert(
            PathBuf::from("/a/b"),
            StoredBookmark {
                kind: BookmarkKind::Directory,
                data: vec![1],
            },
        );
        let mgr = BookmarkManager {
            bookmarks: Mutex::new(map),
            active_guards: Mutex::new(Vec::new()),
            store_path: PathBuf::new(),
        };
        // 目录书签无法解析时（失效），不应视为覆盖，文件书签仍应可记录
        assert!(!mgr.covered_by_directory_with(Path::new("/a/b/c/file.md"), |_| false));
    }

    #[test]
    fn prune_redundant_removes_covered_files() {
        let mut map = HashMap::new();
        map.insert(
            PathBuf::from("/a/b"),
            StoredBookmark {
                kind: BookmarkKind::Directory,
                data: vec![1],
            },
        );
        map.insert(
            PathBuf::from("/a/b/c/file.md"),
            StoredBookmark {
                kind: BookmarkKind::File,
                data: vec![2],
            },
        );
        map.insert(
            PathBuf::from("/x/y.md"),
            StoredBookmark {
                kind: BookmarkKind::File,
                data: vec![3],
            },
        );
        BookmarkManager::prune_redundant(&mut map, |_| true);
        assert!(map.contains_key(Path::new("/a/b")));
        assert!(!map.contains_key(Path::new("/a/b/c/file.md")));
        assert!(map.contains_key(Path::new("/x/y.md")));
    }

    #[test]
    fn prune_redundant_keeps_files_under_invalid_dir() {
        let mut map = HashMap::new();
        map.insert(
            PathBuf::from("/a/b"),
            StoredBookmark {
                kind: BookmarkKind::Directory,
                data: vec![1],
            },
        );
        map.insert(
            PathBuf::from("/a/b/c/file.md"),
            StoredBookmark {
                kind: BookmarkKind::File,
                data: vec![2],
            },
        );
        // 目录书签失效时不得修剪其下的文件书签，避免丢失仍可用的授权
        BookmarkManager::prune_redundant(&mut map, |_| false);
        assert!(map.contains_key(Path::new("/a/b")));
        assert!(map.contains_key(Path::new("/a/b/c/file.md")));
    }

    #[test]
    fn migrate_unknown_kinds_noop_when_clean() {
        let mut map = HashMap::new();
        map.insert(
            PathBuf::from("/a"),
            StoredBookmark {
                kind: BookmarkKind::Directory,
                data: vec![1],
            },
        );
        map.insert(
            PathBuf::from("/a/f.md"),
            StoredBookmark {
                kind: BookmarkKind::File,
                data: vec![2],
            },
        );
        assert!(!BookmarkManager::migrate_unknown_kinds(&mut map));
        assert_eq!(map.len(), 2);
    }

    #[test]
    fn migrate_unknown_kinds_removes_unresolvable_entries() {
        let mut map = HashMap::new();
        map.insert(
            PathBuf::from("/a"),
            StoredBookmark {
                kind: BookmarkKind::Unknown,
                data: vec![1, 2, 3],
            },
        );
        map.insert(
            PathBuf::from("/b/f.md"),
            StoredBookmark {
                kind: BookmarkKind::File,
                data: vec![4],
            },
        );
        assert!(BookmarkManager::migrate_unknown_kinds(&mut map));
        // 无法解析的旧书签被移除；已归类的条目不受影响
        assert!(!map.contains_key(Path::new("/a")));
        assert!(map.contains_key(Path::new("/b/f.md")));
    }

    fn manager_with(bookmarks: HashMap<PathBuf, StoredBookmark>) -> BookmarkManager {
        BookmarkManager {
            bookmarks: Mutex::new(bookmarks),
            active_guards: Mutex::new(Vec::new()),
            store_path: PathBuf::new(),
        }
    }

    fn dir_bookmarks(n: usize) -> HashMap<PathBuf, StoredBookmark> {
        (0..n)
            .map(|i| {
                (
                    PathBuf::from(format!("/d{i}")),
                    StoredBookmark {
                        kind: BookmarkKind::Directory,
                        data: vec![i as u8],
                    },
                )
            })
            .collect()
    }

    #[test]
    fn decide_create_skips_covered_directory() {
        let mgr = manager_with(dir_bookmarks(1));
        // 已注册父目录书签时，子目录无需再注册
        assert_eq!(
            mgr.decide_create(Path::new("/d0/sub"), true, |_| true),
            CreateDecision::SkipCovered
        );
    }

    #[test]
    fn decide_create_skips_covered_file() {
        let mgr = manager_with(dir_bookmarks(1));
        // 文件被目录书签覆盖时同样跳过（原有行为保持）
        assert_eq!(
            mgr.decide_create(Path::new("/d0/sub/file.md"), false, |_| true),
            CreateDecision::SkipCovered
        );
    }

    #[test]
    fn decide_create_skips_covered_dir_even_at_limit() {
        let mgr = manager_with(dir_bookmarks(MAX_DIRECTORY_BOOKMARKS));
        // 数量已达上限时，被覆盖的子目录仍应跳过注册，而不是误报超限
        assert_eq!(
            mgr.decide_create(Path::new("/d0/sub"), true, |_| true),
            CreateDecision::SkipCovered
        );
    }

    #[test]
    fn decide_create_rejects_uncovered_dir_at_limit() {
        let mgr = manager_with(dir_bookmarks(MAX_DIRECTORY_BOOKMARKS));
        // 未覆盖的新目录在达到上限后应被拒绝
        assert_eq!(
            mgr.decide_create(Path::new("/x/y"), true, |_| true),
            CreateDecision::TooMany
        );
    }

    #[test]
    fn decide_create_allows_file_at_dir_limit() {
        let mgr = manager_with(dir_bookmarks(MAX_DIRECTORY_BOOKMARKS));
        // 目录数量上限不影响文件书签
        assert_eq!(
            mgr.decide_create(Path::new("/x/y.md"), false, |_| true),
            CreateDecision::Proceed
        );
    }

    #[test]
    fn decide_create_does_not_skip_when_ancestor_invalid() {
        let mgr = manager_with(dir_bookmarks(1));
        // 祖先书签失效（无法解析）时不视为覆盖，子路径仍可正常注册
        assert_eq!(
            mgr.decide_create(Path::new("/d0/sub"), true, |_| false),
            CreateDecision::Proceed
        );
    }

    #[test]
    fn decide_create_does_not_skip_on_own_bookmark() {
        let mut map = HashMap::new();
        map.insert(
            PathBuf::from("/a/b"),
            StoredBookmark {
                kind: BookmarkKind::Directory,
                data: vec![1],
            },
        );
        let mgr = manager_with(map);
        // 只有路径自身书签、没有祖先目录书签时，不算“已覆盖”，应继续注册
        assert_eq!(
            mgr.decide_create(Path::new("/a/b"), true, |_| true),
            CreateDecision::Proceed
        );
    }

    #[test]
    fn remove_bookmark_at_clears_redundant_entry() {
        let mut map = dir_bookmarks(1);
        map.insert(
            PathBuf::from("/d0/sub"),
            StoredBookmark {
                kind: BookmarkKind::Directory,
                data: vec![2],
            },
        );
        let mgr = manager_with(map);
        // 跳过注册时清掉同路径的旧条目，但保留祖先书签
        assert!(mgr.remove_bookmark_at(Path::new("/d0/sub")));
        let bookmarks = mgr.bookmarks.lock().unwrap_or_else(|e| e.into_inner());
        assert!(!bookmarks.contains_key(Path::new("/d0/sub")));
        assert!(bookmarks.contains_key(Path::new("/d0")));
    }

    #[test]
    fn remove_bookmark_at_returns_false_when_absent() {
        let mgr = manager_with(dir_bookmarks(1));
        // 路径上没有旧条目时不做清理，祖先书签保持不动
        assert!(!mgr.remove_bookmark_at(Path::new("/d0/sub")));
        let bookmarks = mgr.bookmarks.lock().unwrap_or_else(|e| e.into_inner());
        assert!(bookmarks.contains_key(Path::new("/d0")));
    }
}
