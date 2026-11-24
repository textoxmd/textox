//! 原生 macOS PNG 长图导出：先用 `WKPDFConfiguration` 捕获完整内容生成 PDF，
//! 再用 CoreGraphics 逐页光栅化、纵向拼成一张大图并编码为 PNG。
//! 仅 macOS 编译（调用方用 cfg 引入）。
//!
//! 为什么不用 `WKSnapshotConfiguration.rect`：它的 rect 是**视图坐标**且必须落在
//! 视图 bounds 内，无法离屏捕获视口之外的长内容（实测导出全空白）。而
//! `WKPDFConfiguration.rect` 是**页面坐标**，能拿到完整内容。

/// 输出高度上限（pt/CSS px），防止一次性分配过大位图。
pub const MAX_PNG_HEIGHT: f64 = 30000.0;

/// 页面尺寸（宽, 高，pt）× 倍率 → 拼接后的像素尺寸。
/// 超出高度上限返回含 "too tall" 的错误；空/非法尺寸返回 "Invalid PNG size"。
pub fn stacked_pixel_size(pages: &[(f64, f64)], scale: f64) -> Result<(usize, usize), String> {
    let width_pt = pages.iter().map(|p| p.0).fold(0.0_f64, f64::max);
    let height_pt: f64 = pages.iter().map(|p| p.1).sum();
    if !height_pt.is_finite() || height_pt > MAX_PNG_HEIGHT {
        return Err("Document is too tall to export as a single image".into());
    }
    if pages.is_empty() || width_pt <= 0.0 || height_pt <= 0.0 {
        return Err("Invalid PNG size".into());
    }
    Ok((
        (width_pt * scale).round() as usize,
        (height_pt * scale).round() as usize,
    ))
}

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::c_void;
    use std::sync::{Arc, Mutex};

    use objc2::runtime::NSObject;
    use objc2::{class, msg_send};
    use tauri::Manager;

    use super::{stacked_pixel_size, MAX_PNG_HEIGHT};

    /// 捕获区域（WKWebView 网页坐标，CSS px）。
    #[derive(Debug, serde::Deserialize)]
    pub struct PngCaptureRect {
        pub x: f64,
        pub y: f64,
        pub width: f64,
        pub height: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGSize {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGBitmapContextCreate(
            data: *mut c_void,
            width: usize,
            height: usize,
            bits_per_component: usize,
            bytes_per_row: usize,
            space: *mut c_void,
            bitmap_info: u32,
        ) -> *mut c_void;
        fn CGBitmapContextCreateImage(context: *mut c_void) -> *mut c_void;
        fn CGContextRelease(context: *mut c_void);
        fn CGImageRelease(image: *mut c_void);
        fn CGColorSpaceCreateDeviceRGB() -> *mut c_void;
        fn CGColorSpaceRelease(space: *mut c_void);

        // PDF 光栅化所需的 CoreGraphics API。
        fn CGDataProviderCreateWithData(
            info: *mut c_void,
            data: *const c_void,
            size: usize,
            release_data: *const c_void,
        ) -> *mut c_void;
        fn CGDataProviderRelease(provider: *mut c_void);
        fn CGPDFDocumentCreateWithProvider(provider: *mut c_void) -> *mut c_void;
        fn CGPDFDocumentRelease(document: *mut c_void);
        fn CGPDFDocumentGetNumberOfPages(document: *mut c_void) -> usize;
        /// 页码 1-based。
        fn CGPDFDocumentGetPage(document: *mut c_void, page_number: usize) -> *mut c_void;
        fn CGPDFPageGetBoxRect(page: *mut c_void, box_type: i32) -> CGRect;
        fn CGContextDrawPDFPage(context: *mut c_void, page: *mut c_void);
        fn CGContextSaveGState(context: *mut c_void);
        fn CGContextRestoreGState(context: *mut c_void);
        fn CGContextTranslateCTM(context: *mut c_void, tx: f64, ty: f64);
        fn CGContextScaleCTM(context: *mut c_void, sx: f64, sy: f64);
    }

    const K_CG_IMAGE_ALPHA_PREMULTIPLIED_LAST: u32 = 1;
    /// `kCGPDFMediaBox`：页面媒体盒，包含完整页面内容。
    const K_CG_PDF_MEDIA_BOX: i32 = 0;

    /// PDF 捕获：在主线程发起 `createPDFWithConfiguration:`，completion 回传 PDF 字节。
    async fn capture_pdf(window: &tauri::WebviewWindow, rect: &PngCaptureRect) -> Result<Vec<u8>, String> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let tx = Arc::new(Mutex::new(Some(tx)));
        // `with_webview` 的回调要求 `'static`，不能借用入参 rect，这里拷贝一份自有数据。
        let capture = PngCaptureRect {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
        };
        window
            .with_webview(move |webview| {
                let result = unsafe { capture_pdf_on_main(webview, tx.clone(), &capture) };
                if let Err(e) = result {
                    if let Some(tx) = tx.lock().unwrap_or_else(|e| e.into_inner()).take() {
                        let _ = tx.send(Err(e));
                    }
                }
            })
            .map_err(|e| e.to_string())?;

        // 必须带超时：若 WebKit 对某些 rect 不回调 completion，命令会永不 settle，
        // 前端 `runExclusiveExport` 的 finally 永不执行、单飞锁永久占用，
        // 之后整个会话的导出/打印都会静默失效。
        match tokio::time::timeout(std::time::Duration::from_secs(60), rx).await {
            // 通道里传的就是 `Result`（回调侧可能发 Err），这里原样传出
            Ok(Ok(inner)) => inner,
            Ok(Err(_)) => Err("PDF capture callback not invoked".to_string()),
            Err(_) => Err("WKWebView PDF capture timed out".to_string()),
        }
    }

    #[allow(clippy::type_complexity)]
    unsafe fn capture_pdf_on_main(
        webview: tauri::webview::PlatformWebview,
        tx: Arc<Mutex<Option<tokio::sync::oneshot::Sender<Result<Vec<u8>, String>>>>>,
        rect: &PngCaptureRect,
    ) -> Result<(), String> {
        use block2::RcBlock;
        let view = webview.inner() as *mut NSObject;

        let config: *mut NSObject = msg_send![class!(WKPDFConfiguration), new];
        if config.is_null() {
            return Err("Failed to create WKPDFConfiguration".into());
        }
        // `setRect:` 的入参必须是实现了 objc2 `Encode` 的类型：自定义的
        // `#[repr(C)] CGRect` 不满足该约束，因此这里用内存布局完全一致的
        // `NSRect`（CoreGraphics 的 FFI 仍用自定义结构体）。
        // 尺寸钳制到至少 1pt：零/负数尺寸等同于 null rect，会回退成整页捕获。
        let capture = objc2_foundation::NSRect::new(
            objc2_foundation::NSPoint::new(rect.x, rect.y),
            objc2_foundation::NSSize::new(rect.width.max(1.0), rect.height.max(1.0)),
        );
        let _: () = msg_send![config, setRect: capture];

        let handler = RcBlock::new(move |pdf_data: *mut NSObject, error: *mut NSObject| {
            // `WKPDFConfiguration` 用 `new` 创建（+1）。completion handler 只会被
            // 调用一次，调用时 WebKit 已不再需要该配置，因此在这里统一释放，覆盖所有
            // return 分支。（对比：`export_pdf` 的 `WKPDFConfiguration` 从不释放，是既有
            // 泄漏，此处不沿用。）若 handler 永不回调，这个配置会泄漏一次——由
            // `capture_pdf` 的超时兜底，量级可忽略。
            let _: () = msg_send![config, release];
            let send = |v: Result<Vec<u8>, String>| {
                if let Some(tx) = tx.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    let _ = tx.send(v);
                }
            };
            if !error.is_null() {
                let desc: *mut NSObject = msg_send![error, localizedDescription];
                let message = if !desc.is_null() {
                    let cstr: *const std::os::raw::c_char = msg_send![desc, UTF8String];
                    if !cstr.is_null() {
                        std::ffi::CStr::from_ptr(cstr).to_string_lossy().into_owned()
                    } else {
                        "WKWebView PDF capture failed".into()
                    }
                } else {
                    "WKWebView PDF capture failed".into()
                };
                send(Err(message));
                return;
            }
            if pdf_data.is_null() {
                send(Err("No PDF data received".into()));
                return;
            }
            let bytes: *const c_void = msg_send![pdf_data, bytes];
            let len: usize = msg_send![pdf_data, length];
            if bytes.is_null() || len == 0 {
                send(Err("PDF data has no backing buffer".into()));
                return;
            }
            // pdf_data 在回调期间保持有效，bytes 指向其内部缓冲区；
            // 立即 to_vec() 拷贝，避免指针在回调返回后悬垂。
            send(Ok(std::slice::from_raw_parts(bytes as *const u8, len).to_vec()));
        });

        let _: () = msg_send![view, createPDFWithConfiguration: config, completionHandler: &*handler];
        Ok(())
    }

    /// 把 PDF 逐页光栅化、纵向拼成一张大图并编码 PNG。
    ///
    /// 全部 CG 对象在函数内手动释放（裸指针没有 RAII），每个提前返回分支都会
    /// 释放已创建的对象；`Vec<u8>` 在光栅化期间保持存活，`CGDataProvider` 以
    /// `releaseData = null` 引用其缓冲区。
    fn rasterize_pdf_to_png(pdf: &[u8], scale: f64) -> Result<Vec<u8>, String> {
        // 该函数在 tokio worker 线程上运行，线程上没有 autorelease pool；
        // 下面会创建 `NSBitmapImageRep` 等 Objective-C 对象，显式建池。
        objc2::rc::autoreleasepool(|_pool| unsafe {
            let provider = CGDataProviderCreateWithData(
                std::ptr::null_mut(),
                pdf.as_ptr() as *const c_void,
                pdf.len(),
                std::ptr::null(),
            );
            if provider.is_null() {
                return Err("Failed to create CGDataProvider".into());
            }
            let doc = CGPDFDocumentCreateWithProvider(provider);
            // 文档会 retain provider，这里立即释放我们自己持有的 +1 引用。
            CGDataProviderRelease(provider);
            if doc.is_null() {
                return Err("Failed to open PDF document".into());
            }

            let page_count = CGPDFDocumentGetNumberOfPages(doc);
            if page_count == 0 {
                CGPDFDocumentRelease(doc);
                return Err("PDF document has no pages".into());
            }

            let mut pages: Vec<(f64, f64)> = Vec::with_capacity(page_count);
            let mut handles: Vec<*mut c_void> = Vec::with_capacity(page_count);
            for i in 1..=page_count {
                let page = CGPDFDocumentGetPage(doc, i);
                if page.is_null() {
                    CGPDFDocumentRelease(doc);
                    return Err(format!("PDF page {} is missing", i));
                }
                let media_box = CGPDFPageGetBoxRect(page, K_CG_PDF_MEDIA_BOX);
                pages.push((media_box.size.width, media_box.size.height));
                handles.push(page);
            }

            let (px_w, px_h) = match stacked_pixel_size(&pages, scale) {
                Ok(size) => size,
                Err(e) => {
                    CGPDFDocumentRelease(doc);
                    return Err(e);
                }
            };

            let space = CGColorSpaceCreateDeviceRGB();
            if space.is_null() {
                CGPDFDocumentRelease(doc);
                return Err("Failed to create color space".into());
            }
            let ctx = CGBitmapContextCreate(
                std::ptr::null_mut(),
                px_w,
                px_h,
                8,
                px_w * 4,
                space,
                K_CG_IMAGE_ALPHA_PREMULTIPLIED_LAST,
            );
            CGColorSpaceRelease(space);
            if ctx.is_null() {
                CGPDFDocumentRelease(doc);
                return Err("Failed to create bitmap context".into());
            }

            // 逐页自上而下摆放。Quartz 原点在左下，因此把自上而下的 pt 游标
            // 换算成 slot 底边 y：slot_bottom = 总高 - 游标 - 页高。
            // 位移量以像素为单位（位图上下文 1 单位 = 1 像素），故乘以 scale。
            let total_h_pt: f64 = pages.iter().map(|p| p.1).sum();
            let mut cursor = 0.0_f64;
            for (i, page) in handles.iter().enumerate() {
                let page_h = pages[i].1;
                let slot_bottom = total_h_pt - cursor - page_h;
                CGContextSaveGState(ctx);
                CGContextTranslateCTM(ctx, 0.0, slot_bottom * scale);
                CGContextScaleCTM(ctx, scale, scale);
                CGContextDrawPDFPage(ctx, *page);
                CGContextRestoreGState(ctx);
                cursor += page_h;
            }

            let big = CGBitmapContextCreateImage(ctx);
            CGContextRelease(ctx);
            CGPDFDocumentRelease(doc);
            if big.is_null() {
                return Err("Failed to create PNG image".into());
            }
            let png = encode_png(big);
            CGImageRelease(big);
            png
        })
    }

    /// CGImage → PNG 字节（NSBitmapImageRep）。
    ///
    /// `representationUsingType:` 会返回一个 autoreleased 的 `NSData`（整张 PNG，
    /// 可达数十 MB），没有 pool 时会永久泄漏并打运行时告警，因此这里显式建池。
    unsafe fn encode_png(cg_image: *mut c_void) -> Result<Vec<u8>, String> {
        objc2::rc::autoreleasepool(|_pool| {
            let rep_alloc: *mut NSObject = msg_send![class!(NSBitmapImageRep), alloc];
            let rep: *mut NSObject = msg_send![rep_alloc, initWithCGImage: cg_image];
            if rep.is_null() {
                return Err("Failed to create NSBitmapImageRep".into());
            }
            let props: *mut NSObject = msg_send![class!(NSDictionary), dictionary];
            // NSBitmapImageFileTypePNG == 4（NSUInteger）
            let data: *mut NSObject =
                msg_send![rep, representationUsingType: 4u64, properties: props];
            let result = if data.is_null() {
                Err("Failed to encode PNG".into())
            } else {
                let bytes: *const c_void = msg_send![data, bytes];
                let len: usize = msg_send![data, length];
                if bytes.is_null() {
                    Err("PNG data has no backing buffer".into())
                } else {
                    // bytes 指向 data 的内部缓冲区，data 是 autoreleased、由上面的
                    // pool 在闭包结束时排干，因此这里立即拷贝。
                    Ok(std::slice::from_raw_parts(bytes as *const u8, len).to_vec())
                }
            };
            // alloc + initWithCGImage: 是 +1，必须手动释放（裸指针没有 RAII）。
            let _: () = msg_send![rep, release];
            result
        })
    }

    #[tauri::command]
    pub async fn export_png(
        app: tauri::AppHandle,
        window: tauri::WebviewWindow,
        save_path: String,
        rect: PngCaptureRect,
        scale: f64,
    ) -> Result<(), String> {
        // 与 export_pdf 一致：优先使用发起调用的编辑器窗口，非编辑器窗口回退到主窗口
        let window = if crate::window_manager::is_editor_label(window.label()) {
            window
        } else {
            app.get_webview_window("main").ok_or("Main window not found")?
        };

        // fail-fast：页面坐标下的高度超过上限直接拒绝，避免无谓的 PDF 捕获与位图分配。
        if rect.height > MAX_PNG_HEIGHT {
            return Err("Document is too tall to export as a single image".into());
        }

        let pdf = capture_pdf(&window, &rect).await?;
        let png = rasterize_pdf_to_png(&pdf, scale)?;

        if let Some(bm) = app.try_state::<crate::bookmark_manager::BookmarkManager>() {
            let _ = bm.start_access(&save_path);
        }
        std::fs::write(&save_path, png).map_err(|e| format!("Failed to save PNG: {}", e))?;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
#[allow(unused_imports)] // `PngCaptureRect` 仅作为命令入参类型，无需在 crate 内被显式引用
pub use mac::{export_png, PngCaptureRect};

// `#[tauri::command]` 会在定义命令的模块里生成两个宏（`__cmd__*` / `__tauri_command_name_*`），
// 而 `generate_handler!` 会按「路径去掉最后一段」来查找它们。命令定义在 `mac` 子模块里，
// 这里把宏一并再导出，使 `png_export::export_png` 这一路径在处理器宏中可用。
#[cfg(target_os = "macos")]
pub use mac::{__cmd__export_png, __tauri_command_name_export_png};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_page_size_scales_by_factor() {
        assert_eq!(
            stacked_pixel_size(&[(900.0, 1200.0)], 2.0).unwrap(),
            (1800, 2400)
        );
    }

    #[test]
    fn multi_page_heights_are_summed_and_width_is_max() {
        assert_eq!(
            stacked_pixel_size(&[(900.0, 1000.0), (800.0, 500.0), (900.0, 250.0)], 2.0).unwrap(),
            (1800, 3500)
        );
    }

    #[test]
    fn over_the_cap_errors_with_too_tall() {
        let err = stacked_pixel_size(&[(800.0, 30001.0)], 1.0).unwrap_err();
        assert!(err.to_lowercase().contains("too tall"));
    }

    #[test]
    fn empty_pages_error_with_invalid_size() {
        assert_eq!(
            stacked_pixel_size(&[], 2.0).unwrap_err(),
            "Invalid PNG size"
        );
    }
}
