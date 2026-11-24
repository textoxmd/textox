use std::ffi::CString;

use log::info;
use objc2::ffi::{class_addMethod, objc_allocateClassPair, objc_registerClassPair};
use objc2::runtime::{AnyClass, AnyObject, Sel};
use objc2::{class, msg_send, sel, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSApplication, NSMenu, NSMenuItem};
use objc2_foundation::NSString;
use once_cell::sync::OnceCell;
use tauri::Manager;

const TAG_NEW_WINDOW: i32 = 10;

static HANDLER_INSTANCE: OnceCell<SendableId> = OnceCell::new();
static APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

struct SendableId(*mut AnyObject);
unsafe impl Send for SendableId {}
unsafe impl Sync for SendableId {}

pub fn setup_dock_menu(app: &tauri::AppHandle) {
    APP_HANDLE.set(app.clone()).ok();
    register_handler_class();
    register_dock_menu_delegate_method();
}

pub fn register_recent_document(path: &str) {
    unsafe {
        let _mtm = match MainThreadMarker::new() {
            Some(m) => m,
            None => {
                info!("register_recent_document: not on main thread, skipping");
                return;
            }
        };

        let ns_path = NSString::from_str(path);
        let url: *mut AnyObject = msg_send![
            class!(NSURL),
            fileURLWithPath: &*ns_path
        ];

        if url.is_null() {
            info!(
                "register_recent_document: failed to create NSURL for path: {}",
                path
            );
            return;
        }

        let controller: *mut AnyObject =
            msg_send![class!(NSDocumentController), sharedDocumentController];

        let _: () = msg_send![controller, noteNewRecentDocumentURL: url];
    }
}

fn register_handler_class() {
    let _ = HANDLER_INSTANCE.get_or_init(|| unsafe {
        let name = CString::new("TextoxDockMenuHandler").unwrap();
        let super_cls = class!(NSObject);
        let cls = objc_allocateClassPair(super_cls, name.as_ptr(), 0);
        if cls.is_null() {
            log::error!("Failed to allocate TextoxDockMenuHandler class");
            return SendableId(std::ptr::null_mut());
        }

        let sel = sel!(dockMenuItemAction:);
        let imp: unsafe extern "C-unwind" fn() = std::mem::transmute::<
            unsafe extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject),
            unsafe extern "C-unwind" fn(),
        >(handle_dock_action);
        class_addMethod(cls, sel, imp, c"v@:@".as_ptr());

        objc_registerClassPair(cls);

        let instance: *mut AnyObject = msg_send![cls, new];
        SendableId(instance)
    });
}

fn register_dock_menu_delegate_method() {
    unsafe {
        let mtm = match MainThreadMarker::new() {
            Some(m) => m,
            None => {
                log::error!("register_dock_menu_delegate_method must be called on main thread");
                return;
            }
        };
        let ns_app = NSApplication::sharedApplication(mtm);

        let delegate: *mut AnyObject = msg_send![&*ns_app, delegate];
        if delegate.is_null() {
            info!("dock_menu: no NSApp delegate found");
            return;
        }

        let delegate_class: *mut AnyClass = msg_send![delegate, class];
        let sel = sel!(applicationDockMenu:);

        let imp: unsafe extern "C-unwind" fn() = std::mem::transmute::<
            unsafe extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> *mut AnyObject,
            unsafe extern "C-unwind" fn(),
        >(handle_application_dock_menu);
        if class_addMethod(delegate_class, sel, imp, c"@@:@".as_ptr()).into() {
            info!("dock_menu: registered applicationDockMenu: on delegate");
        } else {
            info!("dock_menu: applicationDockMenu: already exists on delegate");
        }
    }
}

unsafe extern "C-unwind" fn handle_application_dock_menu(
    _this: &AnyObject,
    _cmd: Sel,
    _sender: *mut AnyObject,
) -> *mut AnyObject {
    let mtm = match MainThreadMarker::new() {
        Some(m) => m,
        None => return std::ptr::null_mut(),
    };

    let menu = NSMenu::initWithTitle(NSMenu::alloc(mtm), &NSString::from_str(""));
    menu.setAutoenablesItems(false);

    let handler = handler_instance();
    if handler.is_null() {
        return &*menu as *const NSMenu as *mut AnyObject;
    }

    let title = crate::i18n::translate("menu.new_window");
    let item = NSMenuItem::initWithTitle_action_keyEquivalent(
        NSMenuItem::alloc(mtm),
        &NSString::from_str(&title),
        Some(sel!(dockMenuItemAction:)),
        &NSString::from_str(""),
    );
    item.setTarget(Some(&*handler));
    item.setTag(TAG_NEW_WINDOW as isize);
    menu.addItem(&item);

    let raw = &*menu as *const NSMenu as *mut AnyObject;
    let _: () = msg_send![raw, autorelease];
    std::mem::forget(menu);
    raw
}

unsafe extern "C-unwind" fn handle_dock_action(
    _this: &AnyObject,
    _cmd: Sel,
    sender: *mut AnyObject,
) {
    let app = match APP_HANDLE.get() {
        Some(a) => a,
        None => return,
    };

    let tag: i32 = msg_send![sender, tag];
    if tag == TAG_NEW_WINDOW {
        if let Some(label) = crate::window_manager::take_reopen_window() {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.show();
                let _ = window.set_focus();
            }
        } else {
            let _ = crate::WINDOW_MANAGER.create_window(app, None, None, None);
        }
    }
}

fn handler_instance() -> *mut AnyObject {
    HANDLER_INSTANCE
        .get()
        .map(|s| s.0)
        .unwrap_or(std::ptr::null_mut())
}
