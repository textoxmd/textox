// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager, RunEvent};

#[cfg(target_os = "macos")]
use objc2::{class, msg_send, MainThreadMarker};
#[cfg(target_os = "macos")]
use objc2_foundation::NSString;

// 存储 AppHandle 以供 Ctrl+C 处理器使用
static APP_HANDLE: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

fn main() {
    // release 模式下设置 panic hook，将崩溃信息写入本地日志。
    // 注意：必须先注册本 hook 再初始化 Sentry——sentry 0.49 的 panic
    // 处理器会自动把 panic 转发给之前注册的 hook，因此本地日志和
    // Sentry 上报可以同时生效，无需手动调用 capture_panic。
    #[cfg(not(debug_assertions))]
    std::panic::set_hook(Box::new(|panic_info| {
        let msg = panic_info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| panic_info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| format!("{:?}", panic_info.payload()));
        let location = panic_info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown".to_string());
        log::error!("PANIC: {} at {}", msg, location);
    }));

    // 初始化 Sentry 原生错误上报。返回的 guard 必须存活到进程退出，
    // 否则退出前待发送的事件可能来不及发出。
    let _sentry_guard = texto_lib::init_sentry();

    // 安装 Ctrl+C 信号处理器：放行窗口关闭，让事件循环自然退出
    if let Err(e) = ctrlc::set_handler(move || {
        if let Some(app_handle) = APP_HANDLE.get() {
            log::info!("Ctrl+C received, force closing all windows");
            texto_lib::window_manager::FORCE_EXIT.store(true, Ordering::SeqCst);
            for (_, window) in app_handle.webview_windows() {
                let _ = window.close();
            }
        }
    }) {
        // 设置失败不影响应用启动（仅 Ctrl+C 强制退出不可用）
        log::error!("Failed to set Ctrl+C handler: {}", e);
    }

    let app = match texto_lib::run_app() {
        Ok(app) => app,
        Err(e) => {
            log::error!("Failed to build Tauri application: {}", e);
            std::process::exit(1);
        }
    };

    // 用于标记应用是否已完全启动（主窗口已创建）
    let app_ready = Arc::new(AtomicBool::new(false));

    app.run(move |app_handle: &AppHandle, event| {
        match event {
            RunEvent::Ready => {
                // 存储 AppHandle 供 Ctrl+C 处理器使用
                let _ = APP_HANDLE.set(app_handle.clone());

                // 应用已准备好，标记为就绪
                app_ready.store(true, Ordering::SeqCst);

                // 处理命令行参数传入的文件
                if let Some(url) = std::env::args().nth(1) {
                    let is_dir = std::path::Path::new(&url).is_dir();
                    let is_file = url.ends_with(".md")
                        || url.ends_with(".markdown")
                        || url.ends_with(".mdown")
                        || url.ends_with(".mkd");
                    if is_dir || is_file {
                        log::info!(
                            "Adding {} from command line",
                            if is_dir { "directory" } else { "file" }
                        );
                        texto_lib::add_pending_open_file(url);
                    }
                }
            }
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            RunEvent::Opened { urls } => {
                for url in urls {
                    let url_str = url.to_string();
                    log::info!("File opened with app");
                    // 解析文件路径（URL 格式：file:///path/to/file.md）
                    if let Some(path) = url_str.strip_prefix("file://") {
                        // URL 解码，处理中文等特殊字符
                        let decoded_path =
                            urlencoding::decode(path).unwrap_or_else(|_| path.into());
                        let file_path: String = decoded_path.into_owned();

                        // macOS: 对通过 application:openURLs: 获得的路径启动安全域访问，
                        // 使后续 std::fs / NSFileManager 操作不再触发 sandbox 权限弹窗。
                        #[cfg(target_os = "macos")]
                        if let Some(_mtm) = MainThreadMarker::new() {
                            let ns_path = NSString::from_str(&file_path);
                            let nsurl: *mut objc2::runtime::AnyObject =
                                unsafe { msg_send![class!(NSURL), fileURLWithPath: &*ns_path] };
                            if !nsurl.is_null() {
                                let _: objc2::runtime::Bool = unsafe {
                                    msg_send![nsurl, startAccessingSecurityScopedResource]
                                };
                            }
                        }

                        // 应用已运行时，创建新窗口并存入对应路径
                        if app_ready.load(Ordering::SeqCst) {
                            log::info!("App is ready, creating new window for file");
                            let app_handle_clone = app_handle.clone();
                            let file_path_clone = file_path.clone();
                            let is_dir = std::path::Path::new(&file_path).is_dir();
                            tauri::async_runtime::spawn(async move {
                                let result = if is_dir {
                                    texto_lib::WINDOW_MANAGER.create_window(
                                        &app_handle_clone,
                                        None,
                                        None,
                                        Some(file_path_clone),
                                    )
                                } else {
                                    texto_lib::WINDOW_MANAGER.create_window(
                                        &app_handle_clone,
                                        None,
                                        Some(file_path_clone),
                                        None,
                                    )
                                };
                                if let Err(e) = result {
                                    log::error!("Failed to create window for file: {}", e);
                                }
                            });
                        } else {
                            // 应用未就绪（启动时通过右键打开），直接入队 PENDING_OPEN_FILES
                            // 前端初始化时会通过 check_pending_open_file 拿到它
                            log::info!("App not ready yet, adding file to pending queue directly");
                            texto_lib::add_pending_open_file(file_path);
                        }
                    }
                }
            }
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => {
                let handle = app_handle.clone();
                // 启动注入：配置了默认工作区时，Dock 点击创建的工作区窗口
                let workspace = {
                    let config = texto_lib::AppConfig::load(app_handle);
                    if config.startup_behavior == texto_lib::StartupBehavior::Workspace {
                        config.workspace_folder
                    } else {
                        None
                    }
                };
                tauri::async_runtime::spawn(async move {
                    let has_workspace = workspace.is_some();
                    let windows = handle.webview_windows();
                    if let Some((_, window)) = windows.into_iter().next() {
                        log::info!("Reopen event: dock icon clicked, focusing existing window");
                        let _ = window.show();
                        let _ = window.set_focus();
                    } else {
                        log::info!("Reopen event: no existing window, creating new one");
                        if let Ok(label) =
                            texto_lib::WINDOW_MANAGER.create_window(&handle, None, None, workspace)
                        {
                            if has_workspace {
                                texto_lib::window_manager::WINDOW_MANAGER
                                    .patch_window_info(&label, |info| {
                                        info.is_launch_workspace = true
                                    });
                            }
                            texto_lib::window_manager::store_reopen_window(&label);
                            log::info!("Reopen event: created window {}", label);
                        }
                    }
                });
            }
            #[cfg(target_os = "macos")]
            RunEvent::ExitRequested { api, .. }
                if !texto_lib::window_manager::QUIT_REQUESTED.load(Ordering::SeqCst) =>
            {
                log::info!("Exit requested but not quitting, staying in dock");
                api.prevent_exit();
            }
            _ => {}
        }
    });
}
