//! 商店地区解析。
//!
//! 优先级：TEXTO_STORE_REGION（仅调试）→ MAS 的 StoreKit storefront → 系统 locale → 未知。
//! 未知按中国大陆处理（最保守：不展示海外 provider）。
//!
//! 结果在进程内只缓存一次：换 App Store 地区或系统语言需要重启应用才生效。

use log::{info, warn};

#[derive(serde::Serialize, Clone, Debug, PartialEq)]
pub struct StoreRegion {
    /// StoreKit 为 ISO-3166-1 alpha-3，locale 为 alpha-2，无法判定时为 None
    pub country: Option<String>,
    /// "store" | "locale" | "unknown"
    pub source: String,
}

fn region_of(country: Option<String>) -> StoreRegion {
    let source = if country.is_some() {
        "store"
    } else {
        "unknown"
    };
    StoreRegion {
        country,
        source: String::from(source),
    }
}

/// 从 locale 字符串里取地区段（`zh-CN` / `en_US` / `zh-Hans-CN`）。
pub(crate) fn region_from_locale(locale: &str) -> Option<String> {
    let cleaned = locale.replace('_', "-");
    cleaned
        .split('-')
        .skip(1)
        .find(|part| part.len() == 2 && part.chars().all(|c| c.is_ascii_alphabetic()))
        .map(|part| part.to_ascii_uppercase())
}

#[allow(dead_code)] // 供后续 provider 地区门控使用
pub(crate) fn is_mainland(region: &StoreRegion) -> bool {
    matches!(region.country.as_deref(), None | Some("CN") | Some("CHN"))
}

/// 纯函数版本，便于单测。
pub(crate) fn resolve(env_override: &str, storefront: Option<String>, locale: &str) -> StoreRegion {
    let forced = env_override.trim().to_ascii_uppercase();
    if !forced.is_empty() {
        return StoreRegion {
            country: Some(forced),
            source: String::from("store"),
        };
    }
    if let Some(code) = storefront.filter(|c| !c.is_empty()) {
        return StoreRegion {
            country: Some(code),
            source: String::from("store"),
        };
    }
    if let Some(code) = region_from_locale(locale) {
        return StoreRegion {
            country: Some(code),
            source: String::from("locale"),
        };
    }
    region_of(None)
}

#[cfg(target_os = "macos")]
#[allow(deprecated)] // SKPaymentQueue::storefront 已标记废弃，但仍是读取商店地区的唯一方式
fn storefront_country(app: &tauri::AppHandle) -> Option<String> {
    use std::sync::mpsc;
    if !crate::store_review::is_mas_build() {
        return None;
    }
    let (tx, rx) = mpsc::channel();
    if let Err(e) = app.run_on_main_thread(move || {
        let code = unsafe {
            let queue = objc2_store_kit::SKPaymentQueue::defaultQueue();
            queue
                .storefront()
                .map(|storefront| storefront.countryCode().to_string())
        };
        let _ = tx.send(code);
    }) {
        warn!("storefront lookup could not dispatch to main thread, falling back: {e}");
        return None;
    }
    match rx.recv_timeout(std::time::Duration::from_millis(500)) {
        Ok(code) => code,
        Err(e) => {
            warn!("storefront lookup timed out or channel closed, falling back: {e}");
            None
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn storefront_country(_app: &tauri::AppHandle) -> Option<String> {
    None
}

/// 读取环境变量、storefront 与系统 locale 并解析地区（阻塞调用，勿在主线程直接执行）。
fn compute_region(app: &tauri::AppHandle) -> StoreRegion {
    let env = std::env::var("TEXTO_STORE_REGION").unwrap_or_default();
    let locale = sys_locale::get_locale().unwrap_or_default();
    // 有 env 覆盖时短路 StoreKit：否则仍会白等一次主线程调用。
    // 其 source 记为 "store" 是规格约定（调试路径与真实 storefront 共用该值）。
    let storefront = if env.trim().is_empty() {
        storefront_country(app)
    } else {
        None
    };
    resolve(&env, storefront, &locale)
}

/// 解析当前商店地区。
///
/// 结果是进程内缓存：换 App Store 地区或系统语言需要重启应用才生效。
/// 用 `async` 命令让实际计算落到阻塞线程池——若在主线程执行，
/// `run_on_main_thread` 会内联执行，`recv_timeout` 的超时守卫将失效。
#[tauri::command]
pub async fn get_store_region(app: tauri::AppHandle) -> StoreRegion {
    use std::sync::OnceLock;
    static CACHE: OnceLock<StoreRegion> = OnceLock::new();
    if let Some(cached) = CACHE.get() {
        return cached.clone();
    }
    let task = tauri::async_runtime::spawn_blocking(move || compute_region(&app));
    let region = task.await.unwrap_or_else(|e| {
        warn!("store region computation task failed, falling back: {e}");
        region_of(None)
    });
    let _ = CACHE.set(region.clone());
    info!(
        "store region resolved: country={:?} source={}",
        region.country, region.source
    );
    region
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_locale_region() {
        assert_eq!(region_from_locale("zh-CN"), Some("CN".into()));
        assert_eq!(region_from_locale("en_US"), Some("US".into()));
        assert_eq!(region_from_locale("zh-Hans-CN"), Some("CN".into()));
        assert_eq!(region_from_locale("en"), None);
        assert_eq!(region_from_locale(""), None);
    }

    #[test]
    fn mainland_detection() {
        assert!(is_mainland(&region_of(Some("CHN".into()))));
        assert!(is_mainland(&region_of(Some("CN".into()))));
        assert!(is_mainland(&region_of(None)));
        assert!(!is_mainland(&region_of(Some("USA".into()))));
    }

    #[test]
    fn env_override_wins() {
        let resolved = resolve("US", None, "zh-CN");
        assert_eq!(resolved.country.as_deref(), Some("US"));
        assert_eq!(resolved.source, "store");
    }

    #[test]
    fn storefront_then_locale() {
        assert_eq!(
            resolve("", Some("CHN".into()), "en-US").country.as_deref(),
            Some("CHN")
        );
        assert_eq!(resolve("", None, "en-US").country.as_deref(), Some("US"));
        assert_eq!(resolve("", None, "").country, None);
    }
}
