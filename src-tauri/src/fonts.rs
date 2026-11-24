//! System font enumeration
//! macOS: Uses AppKit NSFontManager
//! Windows: Uses DirectWrite API
//! Other platforms: returns empty list

use serde::Serialize;

#[cfg(target_os = "windows")]
mod fonts_windows;

/// 会话级字体缓存：NSFontManager 枚举必须跑在主线程且首次会触发字体库懒加载，
/// 缓存后整个应用生命周期只枚举一次，避免每次打开设置窗口都阻塞主线程。
static FONT_CACHE: std::sync::OnceLock<Vec<FontInfo>> = std::sync::OnceLock::new();

/// Font information
#[derive(Serialize, Debug, Clone)]
pub struct FontInfo {
    /// Font family name (e.g., "Helvetica", "PingFang SC")
    pub family: String,
    /// Font display name (e.g., "Helvetica Regular")
    pub name: String,
    /// Font postscript name (unique identifier)
    pub postscript_name: String,
}

/// Get all available system fonts
#[cfg(target_os = "macos")]
pub fn get_system_fonts() -> Result<Vec<FontInfo>, String> {
    use std::collections::HashSet;

    use objc2::MainThreadMarker;
    use objc2_app_kit::NSFontManager;

    let mtm = MainThreadMarker::new().ok_or("Font enumeration must be called from main thread")?;
    log::info!("Getting system fonts using NSFontManager");

    let font_manager = NSFontManager::sharedFontManager(mtm);
    let families = font_manager.availableFontFamilies();

    let count = families.count();
    log::info!("Found {} font families", count);

    let mut fonts = Vec::new();
    let mut seen_families = HashSet::new();

    for i in 0..count {
        let family_obj = families.objectAtIndex(i);
        let family_name = family_obj.to_string();

        // Skip duplicates
        if seen_families.contains(&family_name) {
            continue;
        }
        seen_families.insert(family_name.clone());

        fonts.push(FontInfo {
            family: family_name.clone(),
            name: family_name.clone(),
            postscript_name: family_name,
        });
    }

    // Sort by family name
    fonts.sort_by(|a, b| a.family.cmp(&b.family));

    log::info!("Returning {} unique font families", fonts.len());
    Ok(fonts)
}

/// Get all available system fonts (Windows via DirectWrite)
#[cfg(target_os = "windows")]
pub fn get_system_fonts() -> Result<Vec<FontInfo>, String> {
    fonts_windows::get_system_fonts()
}

/// Get all available system fonts (other platforms fallback)
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn get_system_fonts() -> Result<Vec<FontInfo>, String> {
    Ok(Vec::new())
}

/// Get system fonts command for Tauri
/// Sync command runs on main thread, required for AppKit access
#[tauri::command]
pub fn get_system_fonts_command() -> Result<Vec<FontInfo>, String> {
    if let Some(fonts) = FONT_CACHE.get() {
        return Ok(fonts.clone());
    }
    let fonts = get_system_fonts()?;
    let _ = FONT_CACHE.set(fonts.clone());
    Ok(fonts)
}
