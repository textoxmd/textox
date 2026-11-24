//! 应用内评分
//!
//! - macOS：App Store 安装版本调用系统 `SKStoreReviewController` 弹出星号评分面板；
//!   非 App Store 构建（开发/直分发）回退为打开 App Store 评分页面。
//! - Windows：打开 Microsoft Store 评分页面。

#[cfg(target_os = "macos")]
use log::{error, info};

#[cfg(target_os = "macos")]
const MACOS_REVIEW_URL: &str =
    "macappstore://apps.apple.com/cn/app/texto-markdown-%E7%BC%96%E8%BE%91%E5%99%A8/id6762083180?action=write-review&mt=12";
#[cfg(target_os = "macos")]
const MACOS_LITE_REVIEW_URL: &str =
    "macappstore://apps.apple.com/cn/app/id6777365755?action=write-review&mt=12";
#[cfg(target_os = "windows")]
const WINDOWS_REVIEW_URL: &str = "ms-windows-store://review/?productid=9PM13WBD5SSC";

/// 请求系统评分弹窗。
///
/// 返回展示方式：`native`（系统评分面板）、`store`（打开商店评分页）、`none`（无操作）。
#[cfg(target_os = "macos")]
#[tauri::command]
#[allow(deprecated)] // SKStoreReviewController::requestReview 在 macOS 14 标记废弃但仍是标准做法
pub fn request_app_review(app: tauri::AppHandle) -> Result<&'static str, String> {
    // 开发构建（debug）直接调原生评分面板，方便本地测试（Apple 文档：开发模式下
    // StoreKit 总是显示评分视图，但提交按钮禁用）；也可用 TEXTO_FORCE_REVIEW=1
    // 强制正式构建走原生面板做验证。
    let force_native = cfg!(debug_assertions) || std::env::var_os("TEXTO_FORCE_REVIEW").is_some();
    if !force_native && !is_mas_build() {
        info!("Not an App Store build, opening App Store review page");
        open_macos_review_page();
        return Ok("store");
    }
    if objc2::runtime::AnyClass::get(c"SKStoreReviewController").is_none() {
        // macOS < 10.14 没有 SKStoreReviewController
        info!("SKStoreReviewController unavailable, opening App Store review page");
        open_macos_review_page();
        return Ok("store");
    }
    info!("Requesting system app review via StoreKit");
    // StoreKit/AppKit 的 UI 调用需要在主线程执行
    app.run_on_main_thread(|| unsafe {
        objc2_store_kit::SKStoreReviewController::requestReview();
    })
    .map(|_| "native")
    .map_err(|e| format!("Failed to dispatch review request: {e}"))
}

/// 打开 App Store 评分页面（用户主动点击入口时使用，避免直接触发系统评分面板）。
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn open_app_review_page() {
    open_macos_review_page();
}

#[cfg(target_os = "macos")]
pub(crate) fn is_mas_build() -> bool {
    use objc2_foundation::NSBundle;
    NSBundle::mainBundle().appStoreReceiptURL().is_some()
}

#[cfg(target_os = "macos")]
fn open_macos_review_page() {
    // Lite（免费版）与完整版在 Mac App Store 是独立 listing，评分链接各指各的
    let url = if cfg!(feature = "free-version") {
        MACOS_LITE_REVIEW_URL
    } else {
        MACOS_REVIEW_URL
    };
    if let Err(e) = std::process::Command::new("open").arg(url).spawn() {
        error!("Failed to open App Store review page: {e}");
    }
}

/// 请求系统评分（Windows 打开 Microsoft Store 评分页）。
#[cfg(target_os = "windows")]
#[tauri::command]
pub fn request_app_review() -> Result<&'static str, String> {
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", WINDOWS_REVIEW_URL])
        .spawn();
    Ok("store")
}

/// 打开 Microsoft Store 评分页。
#[cfg(target_os = "windows")]
#[tauri::command]
pub fn open_app_review_page() {
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", WINDOWS_REVIEW_URL])
        .spawn();
}

/// 其他平台：评分无可用商店，空操作。
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
pub fn request_app_review() -> Result<&'static str, String> {
    Ok("none")
}

/// 其他平台：空操作。
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
pub fn open_app_review_page() {}
