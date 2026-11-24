use crate::take_first_pending_open_file;
use tauri::command;

/// 前端调用：获取并清除第一个待打开的文件路径（给主窗口使用）
#[command]
pub fn check_pending_open_file() -> Option<String> {
    take_first_pending_open_file()
}
