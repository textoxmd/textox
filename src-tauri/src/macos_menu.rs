//! macOS 菜单栏增强：给应用菜单项设置 SF Symbols 模板图标。
//!
//! Tauri 2 的菜单底层（muda）不支持 SF Symbols，也没有给自定义图标设置
//! 模板标记（isTemplate）的能力。系统原生 app 的菜单图标都是 SF Symbol
//! 模板图（黑色 + 透明，由 macOS 按菜单明暗自动着色），因此这里在菜单
//! 安装到 NSApp 之后，直接通过 AppKit 给对应菜单项设置系统符号图。

use log::{info, warn};
use objc2::define_class;
use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::MainThreadOnly;
use objc2::{sel, MainThreadMarker};
use objc2_app_kit::{
    NSApplication, NSFontWeightRegular, NSImage, NSImageSymbolConfiguration, NSMenu,
    NSMenuDelegate, NSMenuItem, NSWindow,
};
use objc2_foundation::{NSInteger, NSProcessInfo, NSString};

define_class!(
    /// "窗口"菜单代理：菜单每次显示前把应用条目重排到最前，
    /// 并禁用系统注入的"从组中移除窗口"。
    #[unsafe(super(NSObject))]
    #[name = "TextoxWindowMenuDelegate"]
    #[thread_kind = MainThreadOnly]
    #[ivars = ()]
    struct TextoxWindowMenuDelegate;

    unsafe impl NSObjectProtocol for TextoxWindowMenuDelegate {}
    unsafe impl NSMenuDelegate for TextoxWindowMenuDelegate {
        #[unsafe(method(menuNeedsUpdate:))]
        fn menu_needs_update(&self, menu: &NSMenu) {
            fix_window_menu(menu);
        }
    }
);

impl TextoxWindowMenuDelegate {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = mtm.alloc().set_ivars(());
        unsafe { msg_send![super(this), init] }
    }
}

/// 菜单项 SF Symbol 的磅值，与系统菜单图标一致
const MENU_ICON_POINT_SIZE: f64 = 16.0;

/// 给应用菜单（macOS 强制作为第一个菜单）中标题匹配的菜单项设置 SF Symbol 图标。
///
/// `icons` 为 `(菜单项标题, SF Symbol 名称)` 列表。
/// 必须在主线程、且菜单已经通过 `App::set_menu` 安装到 NSApp 之后调用。
pub fn set_menu_item_symbol_icons(icons: &[(&str, &str)]) {
    let Some(mtm) = main_thread_marker() else {
        warn!("set_menu_item_symbol_icons: not on main thread, skipping");
        return;
    };

    if !sf_symbols_available() {
        return;
    }

    unsafe {
        let app = NSApplication::sharedApplication(mtm);
        let Some(main_menu) = app.mainMenu() else {
            return;
        };
        // 第一个菜单项就是应用菜单（如 Textox）
        let Some(app_menu_item) = main_menu.itemAtIndex(0) else {
            return;
        };
        let Some(app_menu) = app_menu_item.submenu() else {
            return;
        };

        apply_icons(&app_menu, icons);
    }
}

/// 给菜单栏中标题匹配的顶级子菜单（如"窗口"）里的菜单项设置 SF Symbol 图标。
///
/// 必须在主线程、且菜单已经安装到 NSApp 之后调用。
pub fn set_submenu_item_symbol_icons(submenu_title: &str, icons: &[(&str, &str)]) {
    let Some(mtm) = main_thread_marker() else {
        warn!("set_submenu_item_symbol_icons: not on main thread, skipping");
        return;
    };

    if !sf_symbols_available() {
        return;
    }

    unsafe {
        let app = NSApplication::sharedApplication(mtm);
        let Some(main_menu) = app.mainMenu() else {
            return;
        };
        for index in 0..main_menu.numberOfItems() {
            let Some(item) = main_menu.itemAtIndex(index) else {
                continue;
            };
            let Some(submenu) = item.submenu() else {
                continue;
            };
            if submenu.title().to_string() == submenu_title {
                apply_icons(&submenu, icons);
                return;
            }
        }
    }
}

unsafe fn apply_icons(menu: &NSMenu, icons: &[(&str, &str)]) {
    for index in 0..menu.numberOfItems() {
        let Some(item) = menu.itemAtIndex(index) else {
            continue;
        };
        let title = item.title().to_string();
        if let Some((_, symbol)) = icons.iter().find(|(menu_title, _)| *menu_title == title) {
            set_symbol_icon(&item, symbol);
        }
    }
}

/// 修复"窗口"菜单：
/// 1. 把应用自己的条目（最小化/缩放）移动到菜单最前；
/// 2. 禁用系统注入的"从组中移除窗口"。
///
/// macOS 会把窗口平铺/分组相关项注入到注册为系统窗口菜单（windowsMenu）的菜单里，
/// 这些项不是应用创建的，无法在菜单构建阶段移除，只能在运行时通过 AppKit 修改 enabled。
fn fix_window_menu(menu: &NSMenu) {
    // 已知的"从组中移除窗口"在各系统语言下的标题
    const REMOVE_FROM_GROUP_TITLES: &[&str] = &["从组中移除窗口", "Remove Window from Group"];
    // 窗口平铺项标题（填充/居中），这些不能禁用
    const TILING_ITEM_TITLES: &[&str] = &["填充", "居中", "Fill", "Center"];

    let mut app_items: Vec<Retained<NSMenuItem>> = Vec::new();
    // macOS 注入顺序：填充/居中 → 移动和调整大小/全屏幕平铺（子菜单）→ 从组中移除窗口
    let mut seen_system_submenu = false;

    for j in 0..menu.numberOfItems() {
        let Some(child) = menu.itemAtIndex(j) else {
            continue;
        };
        // 分隔符跳过
        if child.isSeparatorItem() {
            continue;
        }
        // 系统平铺子菜单（"移动和调整大小"、"全屏幕平铺"）
        if child.submenu().is_some() {
            seen_system_submenu = true;
            continue;
        }
        // 应用自己的菜单项（muda 统一使用 fireMenuItemAction:）
        if child.action() == Some(sel!(fireMenuItemAction:)) {
            app_items.push(child);
            continue;
        }
        // 窗口列表项（target 为 NSWindow 实例）跳过
        if let Some(target) = child.target() {
            if target.downcast_ref::<NSWindow>().is_some() {
                continue;
            }
        }
        // 系统注入的普通项：只禁用"从组中移除窗口"
        let title = child.title().to_string();
        let is_group_item = REMOVE_FROM_GROUP_TITLES.contains(&title.as_str());
        let is_tiling_item = TILING_ITEM_TITLES.contains(&title.as_str());
        if is_group_item || (seen_system_submenu && !is_tiling_item) {
            child.setEnabled(false);
        }
    }

    // 把应用自己的条目移到菜单最前（保持原有顺序）
    if !app_items.is_empty() {
        for item in app_items.iter().rev() {
            menu.removeItem(item);
        }
        for (idx, item) in app_items.iter().enumerate() {
            menu.insertItem_atIndex(item, idx as NSInteger);
        }
    }
}

/// 按标题找到"窗口"菜单并执行修复。
/// 必须在主线程、且菜单已经通过 `App::set_menu` 安装到 NSApp 之后调用。
pub fn disable_system_window_menu_items(window_menu_title: &str) {
    let Some(mtm) = main_thread_marker() else {
        warn!("disable_system_window_menu_items: not on main thread, skipping");
        return;
    };

    let app = NSApplication::sharedApplication(mtm);
    let Some(main_menu) = app.mainMenu() else {
        return;
    };
    for index in 0..main_menu.numberOfItems() {
        let Some(item) = main_menu.itemAtIndex(index) else {
            continue;
        };
        let Some(submenu) = item.submenu() else {
            continue;
        };
        if submenu.title().to_string() == window_menu_title {
            fix_window_menu(&submenu);
            break;
        }
    }
}

/// 给"窗口"菜单安装代理，菜单每次显示前都会重新修复（重排 + 禁用）。
/// 必须在主线程、且菜单已经通过 `App::set_menu` 安装到 NSApp 之后调用。
pub fn install_window_menu_delegate(window_menu_title: &str) {
    let Some(mtm) = main_thread_marker() else {
        warn!("install_window_menu_delegate: not on main thread, skipping");
        return;
    };

    let app = NSApplication::sharedApplication(mtm);
    let Some(main_menu) = app.mainMenu() else {
        return;
    };
    for index in 0..main_menu.numberOfItems() {
        let Some(item) = main_menu.itemAtIndex(index) else {
            continue;
        };
        let Some(submenu) = item.submenu() else {
            continue;
        };
        if submenu.title().to_string() != window_menu_title {
            continue;
        }
        let delegate = TextoxWindowMenuDelegate::new(mtm);
        submenu.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        // NSMenu.delegate 是弱引用，这里泄漏一份以保持存活
        std::mem::forget(delegate);
        fix_window_menu(&submenu);
        break;
    }
}

fn main_thread_marker() -> Option<MainThreadMarker> {
    MainThreadMarker::new()
}

/// SF Symbols 是 macOS 11+ 的 API，低版本系统直接跳过
fn sf_symbols_available() -> bool {
    let os = NSProcessInfo::processInfo().operatingSystemVersion();
    if os.majorVersion < 11 {
        info!("SF Symbols requires macOS 11+, skipping menu icons");
        false
    } else {
        true
    }
}

unsafe fn set_symbol_icon(item: &NSMenuItem, symbol: &str) {
    let name = NSString::from_str(symbol);
    let Some(image) = NSImage::imageWithSystemSymbolName_accessibilityDescription(&name, None)
    else {
        warn!("set_symbol_icon: SF Symbol '{}' not available", symbol);
        return;
    };
    // 用与系统菜单一致的 symbol configuration（16pt regular）渲染，
    // 而不是强制缩放到固定尺寸，保证笔画粗细和比例与系统应用一致
    let config = NSImageSymbolConfiguration::configurationWithPointSize_weight(
        MENU_ICON_POINT_SIZE,
        NSFontWeightRegular,
    );
    let Some(image) = image.imageWithSymbolConfiguration(&config) else {
        warn!("set_symbol_icon: failed to configure symbol '{}'", symbol);
        return;
    };
    // 模板图：黑色 + 透明，由 macOS 根据菜单明暗自动着色
    image.setTemplate(true);
    item.setImage(Some(&image));
}
