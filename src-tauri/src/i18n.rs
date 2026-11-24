//! 国际化 (i18n) 模块
//! 读取前端翻译文件，为 Rust 后端提供统一的翻译功能

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

// 嵌入前端翻译文件
const ZH_CN_JSON: &str = include_str!("../../src/i18n/locales/zh-CN.json");
const ZH_TW_JSON: &str = include_str!("../../src/i18n/locales/zh-TW.json");
const EN_US_JSON: &str = include_str!("../../src/i18n/locales/en-US.json");
const JA_JP_JSON: &str = include_str!("../../src/i18n/locales/ja-JP.json");
const KO_KR_JSON: &str = include_str!("../../src/i18n/locales/ko-KR.json");
const FR_FR_JSON: &str = include_str!("../../src/i18n/locales/fr-FR.json");
const DE_DE_JSON: &str = include_str!("../../src/i18n/locales/de-DE.json");
const ES_ES_JSON: &str = include_str!("../../src/i18n/locales/es-ES.json");
const IT_IT_JSON: &str = include_str!("../../src/i18n/locales/it-IT.json");
const PT_PT_JSON: &str = include_str!("../../src/i18n/locales/pt-PT.json");
const RU_RU_JSON: &str = include_str!("../../src/i18n/locales/ru-RU.json");
const AR_SA_JSON: &str = include_str!("../../src/i18n/locales/ar-SA.json");
const HI_IN_JSON: &str = include_str!("../../src/i18n/locales/hi-IN.json");
const VI_VN_JSON: &str = include_str!("../../src/i18n/locales/vi-VN.json");
const TH_TH_JSON: &str = include_str!("../../src/i18n/locales/th-TH.json");

/// 从 JSON 中提取 translations（兼容包装格式和扁平格式）
fn extract_translations(json: &str) -> Option<serde_json::Map<String, Value>> {
    let obj: serde_json::Map<String, Value> = serde_json::from_str(json).ok()?;
    if let Some(Value::Object(inner)) = obj.get("translations") {
        Some(inner.clone())
    } else {
        Some(obj)
    }
}

/// 全局翻译存储
static TRANSLATIONS: Lazy<HashMap<String, HashMap<String, String>>> = Lazy::new(|| {
    let mut map = HashMap::new();

    let locales = [
        ("zh-CN", ZH_CN_JSON),
        ("zh-TW", ZH_TW_JSON),
        ("en-US", EN_US_JSON),
        ("ja-JP", JA_JP_JSON),
        ("ko-KR", KO_KR_JSON),
        ("fr-FR", FR_FR_JSON),
        ("de-DE", DE_DE_JSON),
        ("es-ES", ES_ES_JSON),
        ("it-IT", IT_IT_JSON),
        ("pt-PT", PT_PT_JSON),
        ("ru-RU", RU_RU_JSON),
        ("ar-SA", AR_SA_JSON),
        ("hi-IN", HI_IN_JSON),
        ("vi-VN", VI_VN_JSON),
        ("th-TH", TH_TH_JSON),
    ];

    for (lang, json) in locales {
        if let Some(obj) = extract_translations(json) {
            let flat = flatten_json(obj, "");
            map.insert(lang.to_string(), flat);
        }
    }

    map
});

/// 自定义翻译文件结构
#[derive(Debug, Serialize, Deserialize)]
pub struct CustomTranslationFile {
    pub version: u32,
    pub lang: String,
    pub source: String,
    pub imported_at: String,
    pub name: Option<String>,
    pub translations: HashMap<String, HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CustomLangInfo {
    pub lang: String,
    pub name: String,
    pub hash: String,
}

const LATEST_VERSION: u32 = 1;
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10MB

/// 校验并解析导入的翻译文件
pub fn validate_translation_content(content: &str) -> Result<CustomTranslationFile, String> {
    let data: serde_json::Value =
        serde_json::from_str(content).map_err(|e| format!("JSON 解析失败: {}", e))?;

    let obj = data.as_object().ok_or("文件根节点必须是对象")?;

    // 支持两种格式：
    //   1. 标准导入格式：{ version, lang, translations: { ... } }
    //   2. 扁平格式：{ common: { save: "..." }, settings: { ... } }（兼容 make build 产物）

    let (translations, version, lang, source, imported_at, name) =
        if let Some(v) = obj.get("version").and_then(|v| v.as_u64()) {
            // 标准导入格式
            let ver = v as u32;
            if ver < 1 || ver > LATEST_VERSION {
                return Err(format!(
                    "不支持的版本: {}, 当前支持: 1-{}",
                    ver, LATEST_VERSION
                ));
            }
            let t = obj
                .get("translations")
                .and_then(|t| t.as_object())
                .ok_or("缺少 translations 字段")?;
            (
                t,
                ver,
                obj.get("lang")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                obj.get("source")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                obj.get("imported_at")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                obj.get("name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
            )
        } else {
            // 扁平格式：整个文件就是 translations
            (
                obj,
                LATEST_VERSION,
                String::new(),
                String::new(),
                String::new(),
                None,
            )
        };

    fn flatten_value(
        value: &Value,
        prefix: &str,
        out: &mut HashMap<String, String>,
    ) -> Result<(), String> {
        match value {
            Value::String(s) => {
                out.insert(prefix.to_string(), s.clone());
                Ok(())
            }
            Value::Object(obj) => {
                for (k, v) in obj {
                    let key = if prefix.is_empty() {
                        k.clone()
                    } else {
                        format!("{}.{}", prefix, k)
                    };
                    flatten_value(v, &key, out)?;
                }
                Ok(())
            }
            _ => Err(format!("{} 的值必须是字符串或对象", prefix)),
        }
    }

    let mut result = HashMap::new();

    for (ns, keys) in translations {
        let mut ns_map = HashMap::new();
        flatten_value(keys, "", &mut ns_map)?;
        result.insert(ns.clone(), ns_map);
    }

    Ok(CustomTranslationFile {
        version,
        lang,
        source,
        imported_at,
        name,
        translations: result,
    })
}

/// 获取自定义翻译目录路径
pub fn get_custom_translations_dir(app: &tauri::AppHandle) -> PathBuf {
    let config_dir = app.path().app_config_dir().unwrap_or_else(|_| {
        dirs::home_dir()
            .map(|h| h.join(".config/textox"))
            .unwrap_or_else(|| PathBuf::from("/tmp/textox"))
    });
    config_dir.join("translations")
}

/// 加载指定语言的自定义翻译（遍历所有文件匹配 lang）
pub fn load_custom_translation(
    app: &tauri::AppHandle,
    lang: &str,
) -> Option<CustomTranslationFile> {
    let dir = get_custom_translations_dir(app);
    if !dir.exists() {
        return None;
    }
    for entry in fs::read_dir(dir).ok()? {
        let entry = entry.ok()?;
        let path = entry.path();
        if path.extension()?.to_str()? != "json" {
            continue;
        }
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(validated) = validate_translation_content(&content) {
                if validated.lang == lang {
                    return Some(validated);
                }
            }
        }
    }
    None
}

/// 自定义翻译覆盖层（运行时加载，覆盖内置翻译）
static CUSTOM_TRANSLATIONS: Lazy<Mutex<HashMap<String, HashMap<String, String>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// 设置自定义翻译（应用启动时或导入后调用）
pub fn set_custom_translations(lang: &str, translations: HashMap<String, String>) {
    let mut map = CUSTOM_TRANSLATIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    map.insert(lang.to_string(), translations);
}

/// 当前语言设置
static CURRENT_LANG: Lazy<Mutex<String>> = Lazy::new(|| Mutex::new("zh-CN".to_string()));

/// 将嵌套的 JSON 对象扁平化为键值对
fn flatten_json(obj: serde_json::Map<String, Value>, prefix: &str) -> HashMap<String, String> {
    let mut result = HashMap::new();

    for (key, value) in obj {
        let new_key = if prefix.is_empty() {
            key
        } else {
            format!("{}.{}", prefix, key)
        };

        match value {
            Value::Object(nested) => {
                let nested_flat = flatten_json(nested, &new_key);
                result.extend(nested_flat);
            }
            Value::String(s) => {
                result.insert(new_key, s);
            }
            _ => {}
        }
    }

    result
}

/// 检测系统语言
fn detect_system_language() -> String {
    // 获取系统区域设置
    let locale = sys_locale::get_locale().unwrap_or_else(|| "zh-CN".to_string());

    // 根据系统语言返回对应的应用语言代码
    if locale.starts_with("zh") {
        // 区分简体中文和繁体中文
        if locale.contains("TW") || locale.contains("HK") || locale.contains("MO") {
            "zh-TW".to_string()
        } else {
            "zh-CN".to_string()
        }
    } else if locale.starts_with("ja") {
        "ja-JP".to_string()
    } else if locale.starts_with("ko") {
        "ko-KR".to_string()
    } else if locale.starts_with("fr") {
        "fr-FR".to_string()
    } else if locale.starts_with("de") {
        "de-DE".to_string()
    } else if locale.starts_with("es") {
        "es-ES".to_string()
    } else if locale.starts_with("it") {
        "it-IT".to_string()
    } else if locale.starts_with("pt") {
        "pt-PT".to_string()
    } else if locale.starts_with("ru") {
        "ru-RU".to_string()
    } else if locale.starts_with("ar") {
        "ar-SA".to_string()
    } else if locale.starts_with("hi") {
        "hi-IN".to_string()
    } else if locale.starts_with("vi") {
        "vi-VN".to_string()
    } else if locale.starts_with("th") {
        "th-TH".to_string()
    } else if locale.starts_with("en") {
        "en-US".to_string()
    } else {
        // 默认使用中文
        "zh-CN".to_string()
    }
}

/// 翻译结构体
pub struct I18n;

impl I18n {
    /// 创建新的翻译实例
    pub fn new(lang: &str) -> Self {
        Self::set_language(lang);
        Self
    }

    /// 设置语言
    pub fn set_language(lang: &str) {
        let mut current = CURRENT_LANG.lock().unwrap_or_else(|e| e.into_inner());
        // 如果语言为空，则检测系统语言
        *current = if lang.is_empty() {
            detect_system_language()
        } else {
            lang.to_string()
        };
    }
}

/// 便捷函数：获取翻译（优先使用自定义翻译）
pub fn translate(key: &str) -> String {
    let lang = CURRENT_LANG
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();

    // 优先查找自定义翻译
    if let Ok(custom_map) = CUSTOM_TRANSLATIONS.lock() {
        if let Some(lang_map) = custom_map.get(&lang) {
            if let Some(value) = lang_map.get(key) {
                return value.clone();
            }
        }
    }

    // 尝试获取当前语言的翻译
    if let Some(lang_map) = TRANSLATIONS.get(&lang) {
        if let Some(value) = lang_map.get(key) {
            return value.clone();
        }
    }

    // 回退到英文
    if let Some(en_map) = TRANSLATIONS.get("en-US") {
        if let Some(value) = en_map.get(key) {
            return value.clone();
        }
    }

    // 再回退到中文
    if let Some(zh_map) = TRANSLATIONS.get("zh-CN") {
        if let Some(value) = zh_map.get(key) {
            return value.clone();
        }
    }

    // 如果都找不到，返回 key 本身
    key.to_string()
}

/// 导入翻译文件（Tauri 命令）
#[tauri::command]
pub fn import_translation_file(app: tauri::AppHandle, file_path: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    let content = fs::read_to_string(&path).map_err(|e| format!("无法读取文件: {}", e))?;

    if content.len() as u64 > MAX_FILE_SIZE {
        return Err("文件过大，最大支持 10MB".to_string());
    }

    let validated = validate_translation_content(&content)?;

    // 以内容 MD5 为文件名，避免重复导入
    let hash = format!("{:x}", md5::compute(content.as_bytes()));
    let dir = get_custom_translations_dir(&app);
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建目录: {}", e))?;

    let out_path = dir.join(format!("{}.json", hash));
    if out_path.exists() {
        return Err("该翻译文件已导入".to_string());
    }

    let output = CustomTranslationFile {
        version: LATEST_VERSION,
        lang: validated.lang.clone(),
        source: validated.source,
        imported_at: chrono::Utc::now().to_rfc3339(),
        name: validated.name.clone(),
        translations: validated.translations,
    };

    let json = serde_json::to_string_pretty(&output).map_err(|e| format!("序列化失败: {}", e))?;

    fs::write(&out_path, json).map_err(|e| format!("写入失败: {}", e))?;

    // 合并到运行时翻译表
    let mut flat = HashMap::new();
    for (ns, keys) in &output.translations {
        for (key, value) in keys {
            flat.insert(format!("{}.{}", ns, key), value.clone());
        }
    }
    set_custom_translations(&validated.lang, flat);

    // 通知前端刷新
    let _ = app.emit("custom-translation-imported", validated.lang);

    Ok(())
}

/// 读取自定义翻译（Tauri 命令）
#[tauri::command]
pub fn read_custom_translation(
    app: tauri::AppHandle,
    lang: String,
) -> Result<CustomTranslationFile, String> {
    load_custom_translation(&app, &lang).ok_or("没有自定义翻译".to_string())
}

/// 列出已导入自定义翻译的文件列表（Tauri 命令）
#[tauri::command]
pub fn list_custom_translations(app: tauri::AppHandle) -> Result<Vec<CustomLangInfo>, String> {
    let dir = get_custom_translations_dir(&app);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut result = vec![];
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let fname = entry.file_name().to_string_lossy().to_string();
        if !fname.ends_with(".json") {
            continue;
        }
        if let Some(stem) = fname.strip_suffix(".json") {
            if let Some(validated) = fs::read_to_string(entry.path())
                .ok()
                .and_then(|c| validate_translation_content(&c).ok())
            {
                let name = validated
                    .name
                    .filter(|n| !n.is_empty())
                    .unwrap_or_else(|| validated.lang.clone());
                result.push(CustomLangInfo {
                    lang: validated.lang,
                    name,
                    hash: stem.to_string(),
                });
            }
        }
    }
    result.sort_by(|a, b| a.lang.cmp(&b.lang));
    Ok(result)
}

/// 移除指定 hash 的自定义翻译文件（Tauri 命令）
#[tauri::command]
pub fn remove_custom_translation(app: tauri::AppHandle, hash: String) -> Result<(), String> {
    let dir = get_custom_translations_dir(&app);
    let path = dir.join(format!("{}.json", hash));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("删除失败: {}", e))?;
    }
    let _ = app.emit("custom-translation-imported", "");
    Ok(())
}

/// 清除所有自定义翻译（Tauri 命令）
#[tauri::command]
pub fn clear_custom_translations(app: tauri::AppHandle) -> Result<(), String> {
    let dir = get_custom_translations_dir(&app);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("清除失败: {}", e))?;
    }
    // 清空运行时翻译表
    if let Ok(mut map) = CUSTOM_TRANSLATIONS.lock() {
        map.clear();
    }
    // 通知前端刷新
    let _ = app.emit("custom-translation-imported", "all");
    Ok(())
}

/// 便捷函数：带语言的翻译（优先使用自定义翻译）
#[allow(dead_code)]
pub fn translate_with_lang(lang: &str, key: &str) -> String {
    let lang = if lang.is_empty() {
        detect_system_language()
    } else {
        lang.to_string()
    };

    // 优先查找自定义翻译
    if let Ok(custom_map) = CUSTOM_TRANSLATIONS.lock() {
        if let Some(lang_map) = custom_map.get(&lang) {
            if let Some(value) = lang_map.get(key) {
                return value.clone();
            }
        }
    }

    // 尝试获取指定语言的翻译
    if let Some(lang_map) = TRANSLATIONS.get(&lang) {
        if let Some(value) = lang_map.get(key) {
            return value.clone();
        }
    }

    // 回退到英文
    if let Some(en_map) = TRANSLATIONS.get("en-US") {
        if let Some(value) = en_map.get(key) {
            return value.clone();
        }
    }

    // 再回退到中文
    if let Some(zh_map) = TRANSLATIONS.get("zh-CN") {
        if let Some(value) = zh_map.get(key) {
            return value.clone();
        }
    }

    // 如果都找不到，返回 key 本身
    key.to_string()
}
