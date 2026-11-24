use log::{error, info};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

/// 文件系统事件类型
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub enum FsEventType {
    Create,
    Remove,
    Rename,
    Modify,
}

/// 修改事件的具体类型
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub enum ModifyKind {
    Data,
    Metadata,
    Any,
}

/// 文件系统事件数据
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FsEvent {
    pub event_type: FsEventType,
    pub path: String,
    pub old_path: Option<String>,
    pub is_directory: bool,
    /// 修改类型，仅当 event_type 为 Modify 时有意义
    pub modify_kind: Option<ModifyKind>,
    /// 事件发生时文件的修改时间（毫秒时间戳），用于前端廉价去噪
    pub mtime_ms: Option<i64>,
    /// 事件发生时文件大小
    pub size: Option<u64>,
}

/// 获取路径当前的修改时间和大小（文件不存在时返回 None）
fn path_stat(path: &Path) -> (Option<i64>, Option<u64>) {
    let Ok(meta) = std::fs::metadata(path) else {
        return (None, None);
    };
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);
    (mtime_ms, Some(meta.len()))
}

/// 路径监听状态
struct PathWatchState {
    /// Watcher 实例，需要保持在结构体中以维持文件监听活跃
    /// 当 PathWatchState 被移除时，watcher 会自动 drop 并停止监听
    _watcher: RecommendedWatcher,
    /// 订阅该路径的窗口集合
    subscribers: HashSet<String>,
    /// 引用计数
    ref_count: usize,
}

/// 文件监听管理器（路径级去重）
pub struct FileWatcherManager {
    /// 路径 -> 监听状态的映射
    paths: Arc<Mutex<HashMap<PathBuf, PathWatchState>>>,
    /// 窗口 -> 当前监听路径的映射（用于快速查找）
    window_paths: Arc<Mutex<HashMap<String, PathBuf>>>,
}

impl Default for FileWatcherManager {
    fn default() -> Self {
        Self::new()
    }
}

impl FileWatcherManager {
    pub fn new() -> Self {
        Self {
            paths: Arc::new(Mutex::new(HashMap::new())),
            window_paths: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 开始监听指定窗口的目录
    pub fn watch(&self, window: &tauri::Window, root_path: String) -> Result<(), String> {
        let window_id = window.label().to_string();
        let path = PathBuf::from(&root_path);

        info!("[FileWatcher] Window '{}' requesting watch", window_id);

        let mut paths = self.paths.lock().unwrap_or_else(|e| e.into_inner());
        let mut window_paths = self.window_paths.lock().unwrap_or_else(|e| e.into_inner());

        // 检查该窗口是否已经在监听其他路径
        if let Some(old_path) = window_paths.get(&window_id) {
            if old_path == &path {
                info!("[FileWatcher] Window '{}' already watching", window_id);
                return Ok(());
            }
            // 取消对旧路径的订阅
            self.unsubscribe_from_path(&window_id, old_path, &mut paths);
        }

        // 检查路径是否已有监听
        if let Some(state) = paths.get_mut(&path) {
            // 已有监听，只需添加订阅者
            state.subscribers.insert(window_id.clone());
            state.ref_count += 1;
            let ref_count = state.ref_count;
            window_paths.insert(window_id.clone(), path);
            info!(
                "[FileWatcher] Added window '{}' to existing watcher (ref_count: {})",
                window_id, ref_count
            );
            return Ok(());
        }

        // 创建新的监听
        drop(paths); // 释放锁，避免在回调中死锁
        drop(window_paths);

        self.create_new_watcher(window, path)
    }

    /// 创建新的路径监听
    fn create_new_watcher(&self, window: &tauri::Window, path: PathBuf) -> Result<(), String> {
        let window_id = window.label().to_string();
        let app_handle = window.app_handle().clone();
        let path_for_callback = path.clone();

        let paths_arc = self.paths.clone();

        // 创建事件处理回调
        let mut debouncer = EventDebouncer::new();

        let watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                match res {
                    Ok(event) => {
                        info!(
                            "[FileWatcher] Raw fs event: kind={:?}, paths={:?}",
                            event.kind, event.paths
                        );

                        // 去重处理
                        if !debouncer.should_process(&event) {
                            return;
                        }

                        if let Some(fs_event) = Self::convert_event(event.clone()) {
                            let event_name = match fs_event.event_type {
                                FsEventType::Create => "fs:create",
                                FsEventType::Remove => "fs:remove",
                                FsEventType::Rename => "fs:rename",
                                FsEventType::Modify => "fs:modify",
                            };

                            info!(
                                "[FileWatcher] Emitting event: name={}, event={:?}",
                                event_name, fs_event
                            );

                            // 广播给所有订阅该路径的窗口
                            let paths_guard = paths_arc.lock().unwrap_or_else(|e| e.into_inner());
                            if let Some(state) = paths_guard.get(&path_for_callback) {
                                for subscriber in &state.subscribers {
                                    let _ = app_handle.emit_to(
                                        subscriber,
                                        event_name,
                                        fs_event.clone(),
                                    );
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error!("[FileWatcher] Error: {}", e);
                    }
                }
            },
            Config::default().with_poll_interval(std::time::Duration::from_millis(200)),
        )
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

        let mut watcher = watcher;

        // 递归监听整个目录
        watcher
            .watch(&path, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch path: {}", e))?;

        // 保存监听状态
        let mut subscribers = HashSet::new();
        subscribers.insert(window_id.clone());

        let state = PathWatchState {
            _watcher: watcher,
            subscribers,
            ref_count: 1,
        };

        let mut paths = self.paths.lock().unwrap_or_else(|e| e.into_inner());
        let mut window_paths = self.window_paths.lock().unwrap_or_else(|e| e.into_inner());

        paths.insert(path.clone(), state);
        window_paths.insert(window_id.clone(), path.clone());

        info!(
            "[FileWatcher] Created new watcher for: {} (window: {})",
            path.display(),
            window_id
        );

        Ok(())
    }

    /// 停止指定窗口的文件监听
    pub fn unwatch(&self, window_id: &str) -> Result<(), String> {
        // 与 watch()/create_new_watcher() 保持一致的加锁顺序（paths → window_paths），
        // 避免并发 watch/unwatch 时出现锁顺序反转死锁。
        let mut paths = self.paths.lock().unwrap_or_else(|e| e.into_inner());
        let mut window_paths = self.window_paths.lock().unwrap_or_else(|e| e.into_inner());

        if let Some(path) = window_paths.remove(window_id) {
            self.unsubscribe_from_path(window_id, &path, &mut paths);
        }

        Ok(())
    }

    /// 取消窗口对特定路径的订阅
    fn unsubscribe_from_path(
        &self,
        window_id: &str,
        path: &PathBuf,
        paths: &mut HashMap<PathBuf, PathWatchState>,
    ) {
        if let Some(state) = paths.get_mut(path) {
            state.subscribers.remove(window_id);

            if state.ref_count == 0 {
                info!(
                    "[FileWatcher] unsubscribe_from_path: ref_count already 0 for: {}",
                    path.display()
                );
                return;
            }
            state.ref_count -= 1;

            info!(
                "[FileWatcher] Removed window '{}' from watcher for: {} (ref_count: {})",
                window_id,
                path.display(),
                state.ref_count
            );

            // 如果没有订阅者了，停止监听
            if state.ref_count == 0 {
                info!(
                    "[FileWatcher] No more subscribers, stopping watcher for: {}",
                    path.display()
                );
                paths.remove(path);
            }
        }
    }

    /// 将 notify 事件转换为应用事件
    fn convert_event(event: Event) -> Option<FsEvent> {
        let kind = event.kind;

        match kind {
            EventKind::Create(_) => event.paths.first().map(|path| {
                let (mtime_ms, size) = path_stat(path);
                FsEvent {
                    event_type: FsEventType::Create,
                    path: path.to_string_lossy().to_string(),
                    old_path: None,
                    is_directory: path.is_dir(),
                    modify_kind: None,
                    mtime_ms,
                    size,
                }
            }),
            EventKind::Remove(_) => event.paths.first().map(|path| {
                let (mtime_ms, size) = path_stat(path);
                FsEvent {
                    event_type: FsEventType::Remove,
                    path: path.to_string_lossy().to_string(),
                    old_path: None,
                    is_directory: false,
                    modify_kind: None,
                    mtime_ms,
                    size,
                }
            }),
            EventKind::Modify(modify_kind) => {
                match modify_kind {
                    notify::event::ModifyKind::Name(notify::event::RenameMode::Both) => {
                        if event.paths.len() >= 2 {
                            let new_path = &event.paths[1];
                            let (mtime_ms, size) = path_stat(new_path);
                            Some(FsEvent {
                                event_type: FsEventType::Rename,
                                path: new_path.to_string_lossy().to_string(),
                                old_path: Some(event.paths[0].to_string_lossy().to_string()),
                                is_directory: new_path.is_dir(),
                                modify_kind: None,
                                mtime_ms,
                                size,
                            })
                        } else {
                            None
                        }
                    }
                    notify::event::ModifyKind::Name(notify::event::RenameMode::From) => {
                        // 在 macOS 上，重命名可能会分成 From 和 To 两个事件
                        // 但由于前端现在通过 Modify 事件刷新目录树，这里不需要特殊处理
                        None
                    }
                    notify::event::ModifyKind::Name(notify::event::RenameMode::To) => None,
                    _ => event.paths.first().map(|path| {
                        // 区分内容修改和元数据修改
                        let modify_kind = match modify_kind {
                            notify::event::ModifyKind::Data(_) => Some(ModifyKind::Data),
                            notify::event::ModifyKind::Metadata(_) => Some(ModifyKind::Metadata),
                            _ => Some(ModifyKind::Any),
                        };
                        let (mtime_ms, size) = path_stat(path);
                        FsEvent {
                            event_type: FsEventType::Modify,
                            path: path.to_string_lossy().to_string(),
                            old_path: None,
                            is_directory: path.is_dir(),
                            modify_kind,
                            mtime_ms,
                            size,
                        }
                    }),
                }
            }
            _ => None,
        }
    }

    /// 获取当前监听统计信息（用于调试）
    pub fn get_stats(&self) -> (usize, usize) {
        let paths = self.paths.lock().unwrap_or_else(|e| e.into_inner());
        let window_paths = self.window_paths.lock().unwrap_or_else(|e| e.into_inner());
        (paths.len(), window_paths.len())
    }
}

/// 事件去重器
struct EventDebouncer {
    /// (路径, 是否内容修改) -> 最后一次事件时间
    /// 按"路径 + 事件大类"去重：macOS 上一次真实写入会先产生 Metadata 事件、再产生
    /// Data(Content) 事件。若只按路径去重，Data 事件会被同批到达的 Metadata 事件吞掉，
    /// 导致真实内容变更丢失；若按完整事件类型去重，又无法合并一次写入产生的多个子事件。
    last_events: HashMap<(PathBuf, bool), std::time::Instant>,
}

impl EventDebouncer {
    fn new() -> Self {
        Self {
            last_events: HashMap::new(),
        }
    }

    fn should_process(&mut self, event: &Event) -> bool {
        let now = std::time::Instant::now();
        // 将去重时间从 100ms 延长到 300ms，更好地合并重复事件
        let debounce_duration = std::time::Duration::from_millis(300);

        // 清理过期事件（5秒前的记录）
        self.last_events.retain(|_, timestamp| {
            now.duration_since(*timestamp) < std::time::Duration::from_secs(5)
        });

        // 事件大类：内容修改（Data）单独一类，其余（元数据/重命名/增删）合并为一类
        let is_data = matches!(
            event.kind,
            notify::event::EventKind::Modify(notify::event::ModifyKind::Data(_))
        );

        // 检查是否需要处理（按 路径 + 事件大类 去重）
        for path in &event.paths {
            let key = (path.clone(), is_data);
            let is_duplicate = matches!(
                self.last_events.get(&key),
                Some(last_time) if now.duration_since(*last_time) < debounce_duration
            );
            // 无论是否重复都刷新时间戳，保证连续事件流能持续被合并
            self.last_events.insert(key, now);
            if is_duplicate {
                info!(
                    "[FileWatcher] Debouncing duplicate event: {:?} {:?}",
                    path, event.kind
                );
                return false;
            }
        }

        true
    }
}

// 全局文件监听管理器实例
use once_cell::sync::Lazy;
static FILE_WATCHER: Lazy<FileWatcherManager> = Lazy::new(FileWatcherManager::new);

/// 获取全局文件监听管理器
pub fn get_file_watcher() -> &'static FileWatcherManager {
    &FILE_WATCHER
}

/// Tauri 命令：开始监听目录
#[tauri::command]
pub async fn start_watching(window: tauri::Window, path: String) -> Result<(), String> {
    get_file_watcher().watch(&window, path)
}

/// Tauri 命令：停止监听
#[tauri::command]
pub async fn stop_watching(window: tauri::Window) -> Result<(), String> {
    get_file_watcher().unwatch(window.label())
}

/// Tauri 命令：获取监听统计（调试用）
#[tauri::command]
pub async fn get_watcher_stats() -> Result<(usize, usize), String> {
    Ok(get_file_watcher().get_stats())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn insert_state(mgr: &FileWatcherManager, path: &str, subscribers: &[&str], ref_count: usize) {
        let watcher = notify::recommended_watcher(|_res: Result<notify::Event, notify::Error>| {})
            .expect("failed to create watcher for test");
        mgr.paths.lock().unwrap_or_else(|e| e.into_inner()).insert(
            PathBuf::from(path),
            PathWatchState {
                _watcher: watcher,
                subscribers: subscribers.iter().map(|s| s.to_string()).collect(),
                ref_count,
            },
        );
        for sub in subscribers {
            mgr.window_paths
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(sub.to_string(), PathBuf::from(path));
        }
    }

    #[test]
    fn unwatch_removes_last_subscriber_and_stops_watcher() {
        let mgr = FileWatcherManager::new();
        insert_state(&mgr, "/tmp/watched", &["win1"], 1);

        mgr.unwatch("win1").unwrap();

        assert!(mgr
            .window_paths
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_empty());
        assert!(mgr
            .paths
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_empty());
    }

    #[test]
    fn unwatch_keeps_watcher_when_other_subscribers_remain() {
        let mgr = FileWatcherManager::new();
        insert_state(&mgr, "/tmp/watched", &["win1", "win2"], 2);

        mgr.unwatch("win1").unwrap();

        let paths = mgr.paths.lock().unwrap_or_else(|e| e.into_inner());
        let state = paths.get(Path::new("/tmp/watched")).expect("watcher kept");
        assert_eq!(state.ref_count, 1);
        assert!(!state.subscribers.contains("win1"));
        assert!(state.subscribers.contains("win2"));
        assert!(mgr
            .window_paths
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get("win2")
            .is_some());
    }

    #[test]
    fn unwatch_unknown_window_is_noop() {
        let mgr = FileWatcherManager::new();
        insert_state(&mgr, "/tmp/watched", &["win1"], 1);

        mgr.unwatch("ghost").unwrap();

        assert_eq!(mgr.paths.lock().unwrap_or_else(|e| e.into_inner()).len(), 1);
    }

    #[test]
    fn get_stats_returns_both_counts() {
        let mgr = FileWatcherManager::new();
        insert_state(&mgr, "/tmp/watched", &["win1", "win2"], 2);
        assert_eq!(mgr.get_stats(), (1, 2));
    }

    #[test]
    fn debouncer_dedupes_same_class_events() {
        let mut debouncer = EventDebouncer::new();

        // 同大类的重复事件应被合并
        let mut data_1 = notify::Event::new(notify::event::EventKind::Modify(
            notify::event::ModifyKind::Data(notify::event::DataChange::Content),
        ));
        data_1.paths.push(PathBuf::from("/tmp/a.md"));
        assert!(debouncer.should_process(&data_1));

        let mut data_2 = notify::Event::new(notify::event::EventKind::Modify(
            notify::event::ModifyKind::Data(notify::event::DataChange::Size),
        ));
        data_2.paths.push(PathBuf::from("/tmp/a.md"));
        assert!(!debouncer.should_process(&data_2));

        let mut meta_1 = notify::Event::new(notify::event::EventKind::Modify(
            notify::event::ModifyKind::Metadata(notify::event::MetadataKind::Any),
        ));
        meta_1.paths.push(PathBuf::from("/tmp/b.md"));
        assert!(debouncer.should_process(&meta_1));

        let mut meta_2 = notify::Event::new(notify::event::EventKind::Modify(
            notify::event::ModifyKind::Metadata(notify::event::MetadataKind::Extended),
        ));
        meta_2.paths.push(PathBuf::from("/tmp/b.md"));
        assert!(!debouncer.should_process(&meta_2));
    }

    #[test]
    fn debouncer_keeps_data_event_after_metadata_event() {
        let mut debouncer = EventDebouncer::new();

        // macOS 上同一次写入会先产生 Metadata 事件、再产生 Data(Content) 事件，
        // Data 事件绝不能被同批的 Metadata 事件吞掉
        let mut meta = notify::Event::new(notify::event::EventKind::Modify(
            notify::event::ModifyKind::Metadata(notify::event::MetadataKind::Any),
        ));
        meta.paths.push(PathBuf::from("/tmp/a.md"));
        assert!(debouncer.should_process(&meta));

        let mut data = notify::Event::new(notify::event::EventKind::Modify(
            notify::event::ModifyKind::Data(notify::event::DataChange::Content),
        ));
        data.paths.push(PathBuf::from("/tmp/a.md"));
        assert!(debouncer.should_process(&data));
    }

    #[test]
    fn debouncer_allows_different_paths() {
        let mut debouncer = EventDebouncer::new();

        let mut event_a = notify::Event::new(notify::event::EventKind::Any);
        event_a.paths.push(PathBuf::from("/tmp/a.md"));
        assert!(debouncer.should_process(&event_a));

        let mut event_b = notify::Event::new(notify::event::EventKind::Any);
        event_b.paths.push(PathBuf::from("/tmp/b.md"));
        assert!(debouncer.should_process(&event_b));
    }
}
