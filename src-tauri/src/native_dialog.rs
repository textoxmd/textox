use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

#[cfg(target_os = "macos")]
use crate::bookmark_manager::BookmarkManager;
#[cfg(target_os = "macos")]
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmDeleteResult {
    pub confirmed: bool,
    pub dont_ask_again: bool,
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAlert, NSAlertStyle, NSModalResponseOK, NSSavePanel};
    use objc2_foundation::{NSArray, NSString};

    use super::ConfirmDeleteResult;
    use crate::bookmark_manager::BookmarkManager;

    /// 显示原生保存面板选择 PDF 导出位置。委托给通用导出面板。
    pub fn show_save_pdf_panel(
        bm: &BookmarkManager,
        default_name: Option<String>,
    ) -> Result<Option<String>, String> {
        show_save_export_panel(bm, default_name, "pdf")
    }

    /// 显示原生保存面板选择导出位置，`extension` 为不带点的扩展名（如 "html"）。
    /// 与 PDF 一致：面板返回后立刻持有 security-scoped 访问，否则沙盒下写非当前目录会失败。
    pub fn show_save_export_panel(
        bm: &BookmarkManager,
        default_name: Option<String>,
        extension: &str,
    ) -> Result<Option<String>, String> {
        let mtm = MainThreadMarker::new().ok_or("Must be called from main thread")?;
        let panel = NSSavePanel::savePanel(mtm);
        panel.setCanCreateDirectories(true);

        let ext = NSString::from_str(extension);
        let allowed = NSArray::from_retained_slice(&[ext]);
        #[allow(deprecated)]
        panel.setAllowedFileTypes(Some(&allowed));

        if let Some(name) = default_name {
            panel.setNameFieldStringValue(&NSString::from_str(&name));
        }

        if panel.runModal() != NSModalResponseOK {
            return Ok(None);
        }
        let Some(url) = panel.URL() else {
            return Ok(None);
        };
        if !bm.hold_save_panel_url(url.clone()) {
            log::warn!("Failed to start security-scoped access for export path; write may fail");
        }
        let path = url
            .path()
            .ok_or_else(|| "Failed to read selected path".to_string())?
            .to_string();
        Ok(Some(path))
    }

    pub fn show_confirm_dialog(
        title: &str,
        message: &str,
        ok_label: &str,
        cancel_label: &str,
        suppression_label: &str,
    ) -> Result<ConfirmDeleteResult, String> {
        let mtm = MainThreadMarker::new().ok_or("Must be called from main thread")?;

        let alert = NSAlert::new(mtm);
        alert.setMessageText(&NSString::from_str(title));
        alert.setInformativeText(&NSString::from_str(message));
        alert.setAlertStyle(NSAlertStyle::Warning);
        alert.setShowsSuppressionButton(true);

        if let Some(btn) = alert.suppressionButton() {
            btn.setTitle(&NSString::from_str(suppression_label));
        }

        alert.addButtonWithTitle(&NSString::from_str(ok_label));
        alert.addButtonWithTitle(&NSString::from_str(cancel_label));

        let response = alert.runModal();

        let confirmed = response == 1000; // NSAlertFirstButtonReturn
        let dont_ask_again = alert
            .suppressionButton()
            .map(|btn| btn.state() != 0)
            .unwrap_or(false);

        Ok(ConfirmDeleteResult {
            confirmed,
            dont_ask_again,
        })
    }
}

#[cfg(not(target_os = "macos"))]
fn show_fallback_dialog<R: Runtime>(
    app_handle: &AppHandle<R>,
    title: &str,
    message: &str,
    ok_label: &str,
    cancel_label: &str,
) -> ConfirmDeleteResult {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

    let confirmed = app_handle
        .dialog()
        .message(message)
        .title(title)
        .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            ok_label.to_string(),
            cancel_label.to_string(),
        ))
        .blocking_show();

    ConfirmDeleteResult {
        confirmed,
        dont_ask_again: false,
    }
}

#[tauri::command]
pub async fn confirm_delete<R: Runtime>(
    app_handle: AppHandle<R>,
    title: String,
    message: String,
    ok_label: String,
    cancel_label: String,
    suppression_label: String,
) -> Result<ConfirmDeleteResult, String> {
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        app_handle
            .run_on_main_thread(move || {
                let result = macos::show_confirm_dialog(
                    &title,
                    &message,
                    &ok_label,
                    &cancel_label,
                    &suppression_label,
                );
                let _ = tx.send(result);
            })
            .map_err(|e| e.to_string())?;
        rx.await.map_err(|e| e.to_string())?
    }

    #[cfg(not(target_os = "macos"))]
    {
        let result = show_fallback_dialog(&app_handle, &title, &message, &ok_label, &cancel_label);
        Ok(result)
    }
}

/// 选择 PDF 导出路径。
///
/// macOS 上使用原生 NSSavePanel 并在面板返回后立刻持有 security-scoped
/// 访问权限，解决沙盒下“导出到非当前打开目录”时的写入权限失败问题。
/// 导出本身依赖 WKWebView 的 WKPDFConfiguration，仅 macOS 可用，因此
/// 该命令与 `export_pdf` 一样只在 macOS 上注册。
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn pick_pdf_save_path(
    app: tauri::AppHandle,
    default_name: Option<String>,
) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let app_for_main = app.clone();
    app.run_on_main_thread(move || {
        let bm = app_for_main.state::<BookmarkManager>();
        let result = macos::show_save_pdf_panel(&bm, default_name);
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    rx.await.map_err(|e| e.to_string())?
}

/// 选择通用导出路径（HTML / EPUB / PNG）。仅 macOS 注册；
/// 其他平台由前端走 tauri-plugin-dialog 的 save()。
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn pick_export_save_path(
    app: tauri::AppHandle,
    default_name: Option<String>,
    extension: String,
) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let app_for_main = app.clone();
    app.run_on_main_thread(move || {
        let bm = app_for_main.state::<BookmarkManager>();
        let result = macos::show_save_export_panel(&bm, default_name, &extension);
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    rx.await.map_err(|e| e.to_string())?
}
