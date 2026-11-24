//! WKWebView 打印会话（macOS）。
//!
//! 打印有两个坑，都会表现为「打印面板预览正常，但实际输出/存储为 PDF 是空白」：
//!
//! 1. wry 为了透明窗口把 WKWebView 的 `drawsBackground` 关掉了。保持关闭时打印
//!    系统会按「没有背景」处理页面，输出的 PDF 里内容缺失（深色主题下看起来就是
//!    一张白纸）。这里在打印前临时打开并强制重绘，打印结束再恢复原值。
//! 2. WKWebView 的打印是**异步绘制**的：`runOperation` 会在页面真正画出来之前
//!    就返回，于是打印作业拿到空内容。必须用
//!    `runOperationModalForWindow:delegate:didRunSelector:contextInfo:` 以 sheet
//!    方式运行，并在 `printOperationDidRun:success:contextInfo:` 回调里才算结束
//!    ——这个回调同时也是前端移除打印克隆体的时机（打印期间 DOM 必须保持不动）。
//!
//! 该模块的所有函数都只能在主线程调用（AppKit 要求）。

use std::ffi::CString;
use std::sync::Mutex;

use objc2::ffi::{class_addMethod, objc_allocateClassPair, objc_registerClassPair};
use objc2::runtime::{AnyClass, AnyObject, Sel};
use objc2::{class, msg_send, sel};
use objc2_foundation::NSString;
use tokio::sync::oneshot;

/// `printOperationDidRun:success:contextInfo:` 的类型编码。
/// BOOL 在 arm64 上是 C++ bool（`B`），在 x86_64 上是 signed char（`c`）。
#[cfg(target_arch = "aarch64")]
const DID_RUN_TYPES: &std::ffi::CStr = c"v@:@B^v";
#[cfg(not(target_arch = "aarch64"))]
const DID_RUN_TYPES: &std::ffi::CStr = c"v@:@c^v";

/// 一次打印会话。回调里需要 webView（恢复背景）与 delegate（释放）指针。
///
/// 该结构通过 `contextInfo` 指针交给 `NSPrintOperation`，回调时再取回，因此每个
/// operation 各持一份、互不干扰（多窗口并发打印不会串会话）。
struct Session {
    sender: oneshot::Sender<Result<(), String>>,
    webview: *mut AnyObject,
    delegate: *mut AnyObject,
    /// 打印前 drawsBackground 的原值；None 表示取不到（异常情况，不恢复）
    original_background: Option<bool>,
}

/// 已注册的委托类（注册一次即可）
static DELEGATE_CLASS: Mutex<Option<usize>> = Mutex::new(None);

/// 启动打印：打开 webView 背景 → 以 sheet 形式运行打印操作。
///
/// `sender` 一定会在打印面板关闭（打印完成或用户取消）后收到结果，前端据此
/// 移除克隆体；启动失败时也会立刻收到 Err，避免前端一直等待。
pub unsafe fn start(
    operation: *mut AnyObject,
    webview: *mut AnyObject,
    sender: oneshot::Sender<Result<(), String>>,
) {
    let original_background = enable_background(webview);

    let window: *mut AnyObject = msg_send![webview, window];
    if window.is_null() {
        // 没有窗口（例如窗口正在销毁）时退回阻塞式运行：此时无法挂 sheet，
        // 但仍要保证背景恢复与结果通知。
        log::warn!("print_session: webview has no window, falling back to runOperation");
        let _completed: bool = msg_send![operation, runOperation];
        if let Some(original) = original_background {
            restore_background(webview, original);
        }
        let _ = sender.send(Ok(()));
        return;
    }

    let delegate_class = delegate_class();
    if delegate_class.is_null() {
        restore_if_needed(webview, original_background);
        let _ = sender.send(Err("Failed to create print delegate class".into()));
        return;
    }

    let delegate: *mut AnyObject = msg_send![delegate_class, new];
    if delegate.is_null() {
        restore_if_needed(webview, original_background);
        let _ = sender.send(Err("Failed to create print delegate".into()));
        return;
    }

    // 每个 operation 各持一份 Session，通过 contextInfo 指针传给打印系统，回调
    // 时再取回。这样多窗口并发打印互不干扰；若像以前那样用单个全局槽位，后发起
    // 的打印会覆盖前一个，先结束的回调会串到别的会话上（提前发结果/恢复背景/释放
    // delegate），导致其中一次打印内容为空。
    let session = Box::into_raw(Box::new(Session {
        sender,
        webview,
        delegate,
        original_background,
    }));

    let did_run_selector = sel!(printOperationDidRun:success:contextInfo:);
    let _: () = msg_send![
        operation,
        runOperationModalForWindow: window,
        delegate: delegate,
        didRunSelector: did_run_selector,
        contextInfo: session as *mut std::ffi::c_void
    ];
}

unsafe fn restore_if_needed(webview: *mut AnyObject, original: Option<bool>) {
    if let Some(original) = original {
        restore_background(webview, original);
    }
}

/// 打印前打开 webView 背景并强制重绘，返回原值供结束后恢复。
unsafe fn enable_background(webview: *mut AnyObject) -> Option<bool> {
    let key = NSString::from_str("drawsBackground");
    let current: *mut AnyObject = msg_send![webview, valueForKey: &*key];
    let original = if current.is_null() {
        None
    } else {
        let enabled: i8 = msg_send![current, boolValue];
        Some(enabled != 0)
    };

    let yes: *mut AnyObject = msg_send![class!(NSNumber), numberWithBool: true];
    let _: () = msg_send![webview, setValue: yes, forKey: &*key];
    // display 强制同步重绘，确保打印取到的是带背景的页面
    let _: () = msg_send![webview, display];
    original
}

unsafe fn restore_background(webview: *mut AnyObject, original: bool) {
    let key = NSString::from_str("drawsBackground");
    let value: *mut AnyObject = msg_send![class!(NSNumber), numberWithBool: original];
    let _: () = msg_send![webview, setValue: value, forKey: &*key];
}

/// 注册（或复用）NSPrintOperation 委托类。
fn delegate_class() -> *mut AnyClass {
    let mut guard = DELEGATE_CLASS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(ptr) = *guard {
        return ptr as *mut AnyClass;
    }

    unsafe {
        let name = CString::new("TextoxPrintOperationDelegate").expect("static name");
        let cls = objc_allocateClassPair(class!(NSObject), name.as_ptr(), 0);
        if cls.is_null() {
            log::error!("print_session: failed to allocate delegate class");
            return std::ptr::null_mut();
        }

        let imp: unsafe extern "C-unwind" fn() = std::mem::transmute::<
            unsafe extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject, i8, *mut std::ffi::c_void),
            unsafe extern "C-unwind" fn(),
        >(print_operation_did_run);
        class_addMethod(
            cls,
            sel!(printOperationDidRun:success:contextInfo:),
            imp,
            DID_RUN_TYPES.as_ptr(),
        );
        objc_registerClassPair(cls);

        *guard = Some(cls as usize);
        cls
    }
}

/// 打印结束回调：恢复背景、释放委托、通知调用方。
unsafe extern "C-unwind" fn print_operation_did_run(
    _this: &AnyObject,
    _cmd: Sel,
    _operation: *mut AnyObject,
    _success: i8,
    context: *mut std::ffi::c_void,
) {
    if context.is_null() {
        return;
    }
    // 取回 start 里 Box::into_raw 放进 contextInfo 的本次会话；Box 在函数结束时
    // drop，内存随之释放。
    let session = Box::from_raw(context as *mut Session);

    if let Some(original) = session.original_background {
        restore_background(session.webview, original);
    }
    // 委托由本模块持有，回调结束后释放
    let _: () = msg_send![session.delegate, release];

    // success 为 NO 也表示正常结束（用户取消），前端只需知道可以移除克隆体了
    let _ = session.sender.send(Ok(()));
}
