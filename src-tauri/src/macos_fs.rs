//! macOS 文件系统操作 - 使用 NSFileManager
//! 提供更好的 iCloud 支持和系统级文件协调

#[cfg(target_os = "macos")]
use objc2_foundation::{NSFileManager, NSString, NSURL};

/// 创建文件（使用 NSFileManager）
#[cfg(target_os = "macos")]
pub fn create_file_ns(path: &str) -> Result<(), String> {
    let ns_path = NSString::from_str(path);
    let _url = NSURL::fileURLWithPath(&ns_path);
    let file_manager = NSFileManager::defaultManager();

    let result = unsafe { file_manager.createFileAtPath_contents_attributes(&ns_path, None, None) };
    if result {
        Ok(())
    } else {
        Err("Failed to create file using NSFileManager".to_string())
    }
}

/// 创建文件夹（使用 NSFileManager）
#[cfg(target_os = "macos")]
pub fn create_folder_ns(path: &str) -> Result<(), String> {
    let ns_path = NSString::from_str(path);
    let file_manager = NSFileManager::defaultManager();

    unsafe {
        file_manager.createDirectoryAtPath_withIntermediateDirectories_attributes_error(
            &ns_path, false, None,
        )
    }
    .map_err(|e| e.localizedDescription().to_string())
}

/// 重命名/移动文件（使用 NSFileManager）
#[cfg(target_os = "macos")]
pub fn rename_file_ns(old_path: &str, new_path: &str) -> Result<(), String> {
    let src_path = NSString::from_str(old_path);
    let dst_path = NSString::from_str(new_path);
    let file_manager = NSFileManager::defaultManager();

    file_manager
        .moveItemAtPath_toPath_error(&src_path, &dst_path)
        .map_err(|e| e.localizedDescription().to_string())
}

/// 检查路径是否存在（使用 NSFileManager）
#[cfg(target_os = "macos")]
#[allow(dead_code)]
pub fn path_exists_ns(path: &str) -> bool {
    let ns_path = NSString::from_str(path);
    let file_manager = NSFileManager::defaultManager();
    file_manager.fileExistsAtPath(&ns_path)
}

/// 读取目录内容（使用 NSFileManager）
#[cfg(target_os = "macos")]
pub fn read_directory_ns(path: &str) -> Result<Vec<(String, String, bool)>, String> {
    let ns_path = NSString::from_str(path);
    let file_manager = NSFileManager::defaultManager();

    let contents = file_manager
        .contentsOfDirectoryAtPath_error(&ns_path)
        .map_err(|e| format!("Failed to read directory: {}", e.localizedDescription()))?;

    let mut entries = Vec::new();

    for i in 0..contents.count() {
        let item = contents.objectAtIndex(i);
        let name = item.to_string();

        // 过滤隐藏文件和系统文件
        if name == ".DS_Store" || name.starts_with('.') {
            continue;
        }

        // 构建完整路径
        let item_path = format!("{}/{}", path, name);
        let item_ns_path = NSString::from_str(&item_path);

        // 检查是否是目录
        let mut is_dir = objc2::runtime::Bool::NO;
        unsafe {
            file_manager.fileExistsAtPath_isDirectory(&item_ns_path, &mut is_dir);
        }

        entries.push((name, item_path, is_dir.as_bool()));
    }

    // 排序：目录在前，文件在后，按名称排序
    entries.sort_by(|a, b| match (a.2, b.2) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.0.to_lowercase().cmp(&b.0.to_lowercase()),
    });

    Ok(entries)
}

/// iCloud 文件状态
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct ICloudFileStatus {
    pub is_icloud: bool,
}

/// 检查文件是否是 iCloud 文件
#[cfg(target_os = "macos")]
pub fn is_icloud_file(path: &str) -> Result<ICloudFileStatus, String> {
    let ns_path = NSString::from_str(path);
    let url = NSURL::fileURLWithPath(&ns_path);
    let file_manager = NSFileManager::defaultManager();

    Ok(ICloudFileStatus {
        is_icloud: file_manager.isUbiquitousItemAtURL(&url),
    })
}

/// 删除文件（使用 NSFileManager 移到废纸篓）
#[cfg(target_os = "macos")]
#[allow(dead_code)]
pub fn trash_file_ns(path: &str) -> Result<(), String> {
    let ns_path = NSString::from_str(path);
    let url = NSURL::fileURLWithPath(&ns_path);
    let file_manager = NSFileManager::defaultManager();

    file_manager
        .trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|e| e.localizedDescription().to_string())
}

// 非 macOS 平台的空实现
#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
pub fn create_file_ns(_path: &str) -> Result<(), String> {
    Err("NSFileManager is only available on macOS".to_string())
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
pub fn create_folder_ns(_path: &str) -> Result<(), String> {
    Err("NSFileManager is only available on macOS".to_string())
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
pub fn read_directory_ns(_path: &str) -> Result<Vec<(String, String, bool)>, String> {
    Err("NSFileManager is only available on macOS".to_string())
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
pub fn rename_file_ns(_old_path: &str, _new_path: &str) -> Result<(), String> {
    Err("NSFileManager is only available on macOS".to_string())
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
pub fn path_exists_ns(_path: &str) -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn is_icloud_file(_path: &str) -> Result<ICloudFileStatus, String> {
    Ok(ICloudFileStatus { is_icloud: false })
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
pub fn trash_file_ns(_path: &str) -> Result<(), String> {
    Err("NSFileManager is only available on macOS".to_string())
}
