//! macOS Finder 标签（文件颜色）读写。
//!
//! Finder 里的"文件颜色"其实是标签的颜色，落盘在两处扩展属性：
//!
//! 1. `com.apple.metadata:_kMDItemUserTags`：二进制 plist 数组，元素形如
//!    `"名称\n颜色编号"`。编号沿用 System 7 时代的标签编号：
//!    1 灰、2 绿、3 紫、4 蓝、5 黄、6 红、7 橙。
//! 2. `com.apple.FinderInfo`：旧式 32 字节 FInfo/DInfo 结构，第 10 个字节
//!    （下标 9）的 bit 1-3 存放同一个编号，老系统和部分第三方工具只认这里。
//!
//! Foundation 的 `NSURLTagNamesKey` 只能读写标签名（写入时会补 `\n0`、读取时
//! 会截掉颜色编号），拿不到颜色，所以这里直接读写扩展属性。
//!
//! 注意：iCloud 云盘会改写标签里的颜色编号——实测写入 `红色\n6` 后同步层会在
//! 几十秒内改成 `红色\n1`（FinderInfo 的颜色位也一起变成 1）。Finder 是按标签
//! 名字显示颜色的，所以读取时以标准颜色标签名为准，编号只在自定义标签上用。
//! 只有编号 1 会被改写成 1，2~7 是文件自己的数据，因此读取时优先采信 2~7 的编号；
//! 编号为 1 时才回退到"标准标签名 → 颜色"的对应关系。
//!
//! 那张名字表来自 Finder 偏好 `FavoriteTagNames`，按位置对应颜色，前提是它保持
//! 系统默认的显示顺序。若在文件里观察到两个以上与默认顺序矛盾的标准标签，就认为
//! 用户改过标签顺序，此时不再使用名字表（颜色菜单隐藏、写入拒绝），只按编号和
//! FinderInfo 显示，宁可少显示也不显示错、写错。
//!
//! 兼容性：标签是 10.9 才有的功能，更老的系统只有 FinderInfo 里的颜色位，
//! 读取时会自动回退到那里；两处都读不到或系统不支持扩展属性（网络卷、
//! 非 HFS/APFS 文件系统）时按"没有颜色"处理，不报错也不影响目录读取。

/// 颜色键 → Finder 内部颜色编号（顺序即 Finder 标签默认显示顺序）
pub const COLORS: [(&str, u8); 7] = [
    ("red", 6),
    ("orange", 7),
    ("yellow", 5),
    ("green", 2),
    ("blue", 4),
    ("purple", 3),
    ("gray", 1),
];

/// 根据颜色键取 Finder 颜色编号
pub fn color_number(key: &str) -> Option<u8> {
    COLORS.iter().find(|(k, _)| *k == key).map(|(_, n)| *n)
}

/// 根据 Finder 颜色编号取颜色键
pub fn color_key(number: u8) -> Option<&'static str> {
    COLORS.iter().find(|(_, n)| *n == number).map(|(k, _)| *k)
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{color_key, color_number, COLORS};
    use objc2::AllocAnyThread;
    use objc2_foundation::{
        NSArray, NSData, NSDictionary, NSPropertyListFormat, NSPropertyListMutabilityOptions,
        NSPropertyListSerialization, NSString, NSUserDefaults,
    };
    use std::ffi::CString;
    use std::sync::OnceLock;

    const XATTR_TAGS: &str = "com.apple.metadata:_kMDItemUserTags";
    const XATTR_FINDER_INFO: &str = "com.apple.FinderInfo";

    /// 扩展属性大小上限（标签数据只有几百字节，超过说明数据异常）
    const MAX_XATTR_SIZE: isize = 64 * 1024;

    /// Finder 默认标签显示顺序，与偏好里 `FavoriteTagNames` 的顺序一致
    const DEFAULT_NAMES: [&str; 7] = [
        "Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Gray",
    ];

    /// 颜色键按 Finder 显示顺序排列
    pub(super) const KEYS_IN_ORDER: [&str; 7] =
        ["red", "orange", "yellow", "green", "blue", "purple", "gray"];

    /// 各语言下 7 个标准色标签的名字（顺序同 `KEYS_IN_ORDER`）
    ///
    /// 两个用途：一是给菜单提供本地化名字（按系统语言选），二是拼出下面那张
    /// 跨语言的"名字 → 颜色"识别表（所以不依赖系统语言，未在应用界面语言列表里的
    /// 系统语言也能认出颜色）。
    ///
    /// 这些名字全部抄自系统自带资源：
    /// `/System/Library/CoreServices/Finder.app/Contents/Resources/<lang>.lproj/LocalizableMerged.strings`
    /// 里的 `TG_COLOR_1..7`（`TG_COLOR_1` 灰、`2` 绿、`3` 紫、`4` 蓝、`5` 黄、`6` 红、`7` 橙，
    /// 与文件里的颜色编号一致）。改动前请对着那份资源重新核对，别凭印象写。
    pub(super) const BUILTIN_NAMES: [(&str, [&str; 7]); 39] = [
        ("ar", ["أحمر", "برتقالي", "أصفر", "أخضر", "أزرق", "أرجواني", "رمادي"]),
        ("ca", ["Vermella", "Taronja", "Groga", "Verda", "Blava", "Morada", "Grisa"]),
        ("cs", ["Červená", "Oranžová", "Žlutá", "Zelená", "Modrá", "Fialová", "Šedá"]),
        ("da", ["Rød", "Orange", "Gul", "Grøn", "Blå", "Lilla", "Grå"]),
        ("de", ["Rot", "Orange", "Gelb", "Grün", "Blau", "Lila", "Grau"]),
        ("el", ["Κόκκινο", "Πορτοκαλί", "Κίτρινο", "Πράσινο", "Μπλε", "Μοβ", "Γκρι"]),
        ("en", ["Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Gray"]),
        ("en-au", ["Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Grey"]),
        ("en-gb", ["Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Grey"]),
        ("es", ["Rojo", "Naranja", "Amarillo", "Verde", "Azul", "Morado", "Gris"]),
        ("es-419", ["Rojo", "Naranja", "Amarillo", "Verde", "Azul", "Morado", "Gris"]),
        (
            "fi",
            ["Punainen", "Oranssi", "Keltainen", "Vihreä", "Sininen", "Violetti", "Harmaa"],
        ),
        ("fr", ["Rouge", "Orange", "Jaune", "Vert", "Bleu", "Violet", "Gris"]),
        ("fr-ca", ["Rouge", "Orange", "Jaune", "Vert", "Bleu", "Violet", "Gris"]),
        ("he", ["אדום", "כתום", "צהוב", "ירוק", "כחול", "סגול", "אפור"]),
        ("hi", ["लाल", "नारंगी", "पीला", "हरा", "नीला", "जामुनी", "धूसर"]),
        (
            "hr",
            ["Crvena", "Narančasta", "Žuta", "Zelena", "Plava", "Ljubičasta", "Siva"],
        ),
        ("hu", ["Piros", "Narancs", "Sárga", "Zöld", "Kék", "Bíbor", "Szürke"]),
        ("id", ["Merah", "Oranye", "Kuning", "Hijau", "Biru", "Ungu", "Abu-Abu"]),
        ("it", ["Rosso", "Arancione", "Giallo", "Verde", "Blu", "Viola", "Grigio"]),
        (
            "ja",
            ["レッド", "オレンジ", "イエロー", "グリーン", "ブルー", "パープル", "グレイ"],
        ),
        (
            "ko",
            ["빨간색", "주황색", "노란색", "초록색", "파란색", "보라색", "회색"],
        ),
        ("ms", ["Merah", "Jingga", "Kuning", "Hijau", "Biru", "Ungu", "Kelabu"]),
        ("nl", ["Rood", "Oranje", "Geel", "Groen", "Blauw", "Paars", "Grijs"]),
        ("no", ["Rød", "Oransje", "Gul", "Grønn", "Blå", "Lilla", "Grå"]),
        (
            "pl",
            ["Czerwony", "Pomarańczowy", "Żółty", "Zielony", "Niebieski", "Purpurowy", "Szary"],
        ),
        ("pt-br", ["Vermelho", "Laranja", "Amarelo", "Verde", "Azul", "Roxo", "Cinza"]),
        ("pt-pt", ["Vermelho", "Laranja", "Amarelo", "Verde", "Azul", "Roxo", "Cinzento"]),
        ("ro", ["Roșu", "Portocaliu", "Galben", "Verde", "Albastru", "Mov", "Gri"]),
        (
            "ru",
            ["Красный", "Оранжевый", "Желтый", "Зеленый", "Синий", "Лиловый", "Серый"],
        ),
        ("sk", ["Červená", "Oranžová", "Žltá", "Zelená", "Modrá", "Fialová", "Sivá"]),
        (
            "sl",
            ["Rdeča", "Oranžna", "Rumena", "Zelena", "Modra", "Vijolična", "Siva"],
        ),
        ("sv", ["Röd", "Orange", "Gul", "Grön", "Blå", "Lila", "Grå"]),
        ("th", ["สีแดง", "สีส้ม", "สีเหลือง", "สีเขียว", "สีน้ำเงิน", "สีม่วง", "สีเทา"]),
        ("tr", ["Kırmızı", "Turuncu", "Sarı", "Yeşil", "Mavi", "Mor", "Gri"]),
        (
            "uk",
            ["Червоний", "Оранжевий", "Жовтий", "Зелений", "Синій", "Бузковий", "Сірий"],
        ),
        ("vi", ["Đỏ", "Cam", "Vàng", "Lục", "Lam", "Tía", "Xám"]),
        ("zh-hans", ["红色", "橙色", "黄色", "绿色", "蓝色", "紫色", "灰色"]),
        ("zh-hant", ["紅色", "橙色", "黃色", "綠色", "藍色", "紫色", "灰色"]),
    ];

    /// 额外收录的常见写法：macOS 用上表里的正式名，用户也可能自己建更短/别的写法
    pub(super) const EXTRA_NAME_VARIANTS: [(&str, &str); 28] = [
        // 中文简写
        ("红", "red"),
        ("紅", "red"),
        ("黄", "yellow"),
        ("黃", "yellow"),
        ("绿", "green"),
        ("綠", "green"),
        ("蓝", "blue"),
        ("藍", "blue"),
        ("紫", "purple"),
        ("灰", "gray"),
        // 日文短写（注意「青」在日文里可指蓝也可指绿，故意不收录）
        ("赤", "red"),
        ("緑", "green"),
        ("グレー", "gray"),
        // 韩文短写
        ("빨강", "red"),
        ("주황", "orange"),
        ("노랑", "yellow"),
        ("초록", "green"),
        ("파랑", "blue"),
        ("보라", "purple"),
        // 英文其它拼写
        ("Grey", "gray"),
        // 西/葡/俄/阿/印/泰/越 的常见异体
        ("Púrpura", "purple"),
        ("Cinza", "gray"),
        ("Жёлтый", "yellow"),
        ("بنفسجي", "purple"),
        ("बैंगनी", "purple"),
        ("ग्रे", "gray"),
        ("เทา", "gray"),
        ("Tím", "purple"),
    ];

    /// Finder 偏好里的标签名字表（只在可信时返回）
    static PREFS_NAMES: OnceLock<Option<[String; 7]>> = OnceLock::new();
    /// 菜单显示用的标签名字表（偏好 → 按系统语言的内置表 → 英文）
    static DISPLAY_NAMES: OnceLock<[String; 7]> = OnceLock::new();
    /// 识别用的跨语言名字表：任何语言的标准色标签名 → 颜色键
    static NAME_TO_COLOR: OnceLock<std::collections::HashMap<String, &'static str>> = OnceLock::new();

    /// 读取扩展属性
    pub(super) fn read_xattr(path: &str, name: &str) -> Option<Vec<u8>> {
        let c_path = CString::new(path).ok()?;
        let c_name = CString::new(name).ok()?;
        unsafe {
            let size = libc::getxattr(
                c_path.as_ptr(),
                c_name.as_ptr(),
                std::ptr::null_mut(),
                0,
                0,
                0,
            );
            if size <= 0 {
                return None;
            }
            // 标签数据应该很小，异常大的值当作无效数据忽略
            if size > MAX_XATTR_SIZE {
                return None;
            }
            let mut buf = vec![0u8; size as usize];
            let read = libc::getxattr(
                c_path.as_ptr(),
                c_name.as_ptr(),
                buf.as_mut_ptr() as *mut libc::c_void,
                buf.len(),
                0,
                0,
            );
            if read <= 0 {
                return None;
            }
            buf.truncate(read as usize);
            Some(buf)
        }
    }

    /// 写入扩展属性
    pub(super) fn write_xattr(path: &str, name: &str, value: &[u8]) -> Result<(), String> {
        let c_path = CString::new(path).map_err(|e| e.to_string())?;
        let c_name = CString::new(name).map_err(|e| e.to_string())?;
        let result = unsafe {
            libc::setxattr(
                c_path.as_ptr(),
                c_name.as_ptr(),
                value.as_ptr() as *const libc::c_void,
                value.len(),
                0,
                0,
            )
        };
        if result == 0 {
            Ok(())
        } else {
            Err(format!(
                "setxattr({}) failed: {}",
                name,
                std::io::Error::last_os_error()
            ))
        }
    }

    /// 删除扩展属性（不存在时视为成功）
    fn remove_xattr(path: &str, name: &str) -> Result<(), String> {
        let c_path = CString::new(path).map_err(|e| e.to_string())?;
        let c_name = CString::new(name).map_err(|e| e.to_string())?;
        unsafe {
            libc::removexattr(c_path.as_ptr(), c_name.as_ptr(), 0);
        }
        Ok(())
    }

    /// 解析 `_kMDItemUserTags` 的 plist，得到原始标签字符串（含颜色后缀）
    fn parse_tags(bytes: &[u8]) -> Vec<String> {
        unsafe {
            let data = NSData::with_bytes(bytes);
            let mut format = NSPropertyListFormat::XMLFormat_v1_0;
            let Ok(plist) = NSPropertyListSerialization::propertyListWithData_options_format_error(
                &data,
                NSPropertyListMutabilityOptions::Immutable,
                &mut format,
            ) else {
                return Vec::new();
            };
            let Some(array) = plist.downcast_ref::<NSArray>() else {
                return Vec::new();
            };
            array
                .to_vec()
                .iter()
                .filter_map(|item| item.downcast_ref::<NSString>())
                .map(|item| item.to_string())
                .collect()
        }
    }

    /// 把标签数组序列化为二进制 plist
    pub(super) fn serialize_tags(tags: &[String]) -> Result<Vec<u8>, String> {
        let strings: Vec<_> = tags.iter().map(|tag| NSString::from_str(tag)).collect();
        let array = NSArray::from_retained_slice(&strings);
        unsafe {
            let plist: &objc2::runtime::AnyObject =
                &*(objc2::rc::Retained::as_ptr(&array) as *const objc2::runtime::AnyObject);
            NSPropertyListSerialization::dataWithPropertyList_format_options_error(
                plist,
                NSPropertyListFormat::BinaryFormat_v1_0,
                0,
            )
            .map(|data| data.to_vec())
            .map_err(|e| e.localizedDescription().to_string())
        }
    }

    pub(super) fn read_tags(path: &str) -> Vec<String> {
        read_xattr(path, XATTR_TAGS)
            .map(|bytes| parse_tags(&bytes))
            .unwrap_or_default()
    }

    /// 读取 Finder 偏好里的标签列表（[0] 是"无颜色"占位，1..=7 为七种颜色）。
    ///
    /// 先直接解析偏好 plist 文件，失败再退回 `NSUserDefaults(suiteName:)`：
    /// 沙箱化的 App（Mac App Store 版）访问其它 App 的偏好域可能被拒绝。
    fn favorite_tag_names() -> Option<Vec<String>> {
        if let Some(names) = favorites_from_plist_file() {
            return Some(names);
        }
        let suite = NSString::from_str("com.apple.finder");
        let defaults = NSUserDefaults::initWithSuiteName(NSUserDefaults::alloc(), Some(&suite))?;
        let key = NSString::from_str("FavoriteTagNames");
        Some(
            defaults
                .arrayForKey(&key)?
                .to_vec()
                .iter()
                .filter_map(|item| item.downcast_ref::<NSString>())
                .map(|item| item.to_string())
                .collect(),
        )
    }

    /// 直接读 `~/Library/Preferences/com.apple.finder.plist`
    ///
    /// 沙箱里 `HOME` 会指向容器目录，所以通过 getpwuid 取真正的家目录。
    pub(super) fn favorites_from_plist_file() -> Option<Vec<String>> {
        let home = real_home_dir()?;
        let path = home.join("Library/Preferences/com.apple.finder.plist");
        let bytes = std::fs::read(path).ok()?;

        unsafe {
            let data = NSData::with_bytes(&bytes);
            let mut format = NSPropertyListFormat::XMLFormat_v1_0;
            let plist = NSPropertyListSerialization::propertyListWithData_options_format_error(
                &data,
                NSPropertyListMutabilityOptions::Immutable,
                &mut format,
            )
            .ok()?;
            let dict = plist.downcast_ref::<NSDictionary>()?;
            let key = NSString::from_str("FavoriteTagNames");
            let value = dict.objectForKey(&key)?;
            let array = value.downcast_ref::<NSArray>()?;
            Some(
                array
                    .to_vec()
                    .iter()
                    .filter_map(|item| item.downcast_ref::<NSString>())
                    .map(|item| item.to_string())
                    .collect(),
            )
        }
    }

    /// 真实家目录（沙箱下 `HOME`/`NSHomeDirectory()` 都指向容器）
    fn real_home_dir() -> Option<std::path::PathBuf> {
        unsafe {
            let mut entry: libc::passwd = std::mem::zeroed();
            let mut result: *mut libc::passwd = std::ptr::null_mut();
            let mut buf = vec![0u8; 4096];
            let status = libc::getpwuid_r(
                libc::getuid(),
                &mut entry,
                buf.as_mut_ptr() as *mut libc::c_char,
                buf.len(),
                &mut result,
            );
            if status != 0 || result.is_null() || entry.pw_dir.is_null() {
                return None;
            }
            let dir = std::ffi::CStr::from_ptr(entry.pw_dir).to_string_lossy().to_string();
            if dir.is_empty() {
                None
            } else {
                Some(std::path::PathBuf::from(dir))
            }
        }
    }

    /// 校验 Finder 偏好里的标签列表：必须是 8 项（[0] 为"无颜色"占位，
    /// 1..7 是七个颜色名且互不相同），否则无法按位置对应颜色，返回 `None`。
    pub(super) fn validate_names(items: &[String]) -> Option<[String; 7]> {
        if items.len() != 8 || !items[0].is_empty() {
            return None;
        }
        let names: [String; 7] = std::array::from_fn(|i| items[i + 1].clone());
        if names.iter().any(|name| name.is_empty()) {
            return None;
        }
        let mut seen = std::collections::HashSet::new();
        if !names.iter().all(|name| seen.insert(name.clone())) {
            return None;
        }
        Some(names)
    }

    /// 系统语言标签 → 依次匹配的表 key。
    ///
    /// 先精确匹配（`pt-BR` → `pt-br`），再退到语言（`de-AT` → `de`）；中文按简繁归到
    /// `zh-hans`/`zh-hant`（系统 locale 形如 `zh-Hans-CN`）。
    pub(super) fn locale_keys(locale: &str) -> Vec<String> {
        let lower = locale.replace('_', "-").to_lowercase();
        if lower.starts_with("zh") {
            let traditional = ["hant", "tw", "hk", "mo"]
                .iter()
                .any(|tag| lower.contains(tag));
            return vec![if traditional { "zh-hant" } else { "zh-hans" }.to_string()];
        }
        let mut keys = vec![lower.clone()];
        if let Some(language) = lower.split('-').next() {
            if language != lower {
                keys.push(language.to_string());
            }
        }
        keys
    }

    /// 按系统语言取内置的标准色标签名（只用于菜单显示名）
    pub(super) fn builtin_names_for_locale(locale: &str) -> Option<[String; 7]> {
        let keys = locale_keys(locale);
        keys.iter().find_map(|key| {
            BUILTIN_NAMES
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, names)| names.map(String::from))
        })
    }

    /// 识别用的名字表：跨语言、与系统语言无关
    ///
    /// 只要标签名是某个语言里的标准色名，就能认出颜色——中文系统上的英文标签、
    /// 日文系统上的中文标签都能认出来，沙箱里也不需要读 Finder 偏好。
    fn name_to_color() -> &'static std::collections::HashMap<String, &'static str> {
        NAME_TO_COLOR.get_or_init(|| {
            let mut map = std::collections::HashMap::new();
            for (_, names) in BUILTIN_NAMES.iter() {
                for (index, name) in names.iter().enumerate() {
                    if let Some(key) = KEYS_IN_ORDER.get(index) {
                        map.insert(name.to_lowercase(), *key);
                    }
                }
            }
            for (name, key) in EXTRA_NAME_VARIANTS.iter() {
                map.insert(name.to_lowercase(), *key);
            }
            map
        })
    }

    /// 按标签名识别颜色（不看系统语言）
    pub(super) fn color_key_for_tag_name(name: &str) -> Option<&'static str> {
        name_to_color().get(&name.trim().to_lowercase()).copied()
    }

    /// Finder 偏好里的名字表：内容完整、且每个名字都能和标准色对上时才可用
    ///
    /// 名字与颜色对不上说明用户改过标签顺序，此时不用于写入，避免写成别的颜色。
    fn prefs_names() -> Option<&'static [String; 7]> {
        PREFS_NAMES
            .get_or_init(|| {
                let names = favorite_tag_names().and_then(|items| validate_names(&items))?;
                let consistent = names.iter().enumerate().all(|(index, name)| {
                    color_key_for_tag_name(name)
                        .map(|key| Some(key) == KEYS_IN_ORDER.get(index).copied())
                        .unwrap_or(true)
                });
                if !consistent {
                    log::warn!("Finder 标签顺序与标准颜色不符，写入标签名这一步跳过");
                    return None;
                }
                Some(names)
            })
            .as_ref()
    }

    /// 菜单显示用的名字表：Finder 偏好 → 内置表（按系统语言）→ 英文
    ///
    /// 只影响界面上显示的文字，识别颜色走 `color_key_for_tag_name`。
    fn display_names() -> &'static [String; 7] {
        DISPLAY_NAMES.get_or_init(|| {
            if let Some(names) = prefs_names() {
                return names.clone();
            }
            let locale = sys_locale::get_locale().unwrap_or_default();
            builtin_names_for_locale(&locale).unwrap_or_else(|| DEFAULT_NAMES.map(String::from))
        })
    }

    /// 颜色键 → 写入用的标准标签名。
    ///
    /// 只有 Finder 偏好里的名字才用于写入：内置表是猜的，写错会新建重复标签，
    /// 拿不到就退回只写 FinderInfo 颜色位。
    fn name_for_key(key: &str) -> Option<&'static str> {
        let names = prefs_names()?;
        let index = KEYS_IN_ORDER.iter().position(|k| *k == key)?;
        names.get(index).map(|name| name.as_str())
    }

    /// 是否为标准颜色标签名（任何语言，用于识别并替换已有标签）
    fn is_standard_name(name: &str) -> bool {
        color_key_for_tag_name(name).is_some()
    }

    /// 标准颜色标签名对应的颜色键：先查跨语言名字表，再用 Finder 偏好兜底
    ///
    /// 跨语言表不依赖系统语言，也不依赖沙箱里读不到的 Finder 偏好。
    fn color_key_for_name(name: &str) -> Option<String> {
        if let Some(key) = color_key_for_tag_name(name) {
            return Some(key.to_string());
        }
        let names = prefs_names()?;
        let index = names.iter().position(|item| item == name)?;
        KEYS_IN_ORDER.get(index).map(|key| (*key).to_string())
    }

    /// 从标签字符串（`"名称\n颜色编号"`）里取颜色键
    ///
    /// 顺序与 Finder 实测行为一致：标准颜色标签**以名字为准**（实测 `红色\n4` 显示
    /// 红色、`紫色\n1` 显示紫色——标准标签的颜色定义在系统标签库里，编号只是副本，
    /// 会被 iCloud 抹平成 1）；名字不是标准色名时才看编号，自定义标签走这条路。
    fn color_from_tag(tag: &str) -> Option<String> {
        let mut parts = tag.splitn(2, '\n');
        let name = parts.next().unwrap_or_default();

        if let Some(key) = color_key_for_tag_name(name) {
            return Some(key.to_string());
        }

        let number = parts
            .next()
            .and_then(|suffix| suffix.trim().parse::<u8>().ok());

        if let Some(number) = number {
            if let Some(key) = color_key(number) {
                return Some(key.to_string());
            }
        }

        color_key_for_name(name)
    }

    /// 由现有标签规划写入后的标签列表。
    ///
    /// 只动"标准颜色标签"：它们会被替换掉；其它标签一概原样保留（标签是用户的，
    /// 颜色只是标签上的一个属性，不该由我们改写）。新颜色排在最前，因为 Finder
    /// 与我们的读取都以第一个带色标签为准。`label` 为 `None` 表示拿不到标准标签名
    /// （例如沙箱版）：不写标签，只靠 FinderInfo 颜色位。
    pub(super) fn plan_tags(existing: Vec<String>, label: Option<&str>, number: u8) -> Vec<String> {
        let mut tags: Vec<String> = existing
            .into_iter()
            .filter(|tag| {
                let name = tag.split('\n').next().unwrap_or_default();
                !is_standard_name(name)
            })
            .collect();
        if let Some(label) = label {
            tags.insert(0, format!("{}\n{}", label, number));
        }
        tags
    }

    /// 读取 `com.apple.FinderInfo` 里的旧式颜色编号
    fn legacy_color_number(path: &str) -> Option<u8> {
        let info = read_xattr(path, XATTR_FINDER_INFO)?;
        if info.len() < 10 {
            return None;
        }
        let number = (info[9] & 0x0E) >> 1;
        if number == 0 {
            None
        } else {
            Some(number)
        }
    }

    /// 写入/清除 `com.apple.FinderInfo` 的颜色位（保留其它标志位）
    fn write_legacy_color_number(path: &str, number: u8) -> Result<(), String> {
        let mut info = read_xattr(path, XATTR_FINDER_INFO).unwrap_or_else(|| vec![0u8; 32]);
        if info.len() < 32 {
            info.resize(32, 0);
        }
        info[9] = (info[9] & !0x0E) | ((number & 0x07) << 1);
        write_xattr(path, XATTR_FINDER_INFO, &info)
    }

    /// 读取文件颜色（颜色键）。标签优先，其次旧式 FinderInfo 颜色位。
    ///
    /// 颜色只是锦上添花：系统不支持扩展属性（网络卷、老文件系统等）或读取出现
    /// 任何意外时，一律按"没有颜色"处理，不影响目录树本身。
    pub fn read_color(path: &str) -> Option<String> {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| read_color_impl(path)))
            .ok()
            .flatten()
    }

    fn read_color_impl(path: &str) -> Option<String> {
        for tag in read_tags(path) {
            if let Some(key) = color_from_tag(&tag) {
                return Some(key);
            }
        }
        legacy_color_number(path)
            .and_then(color_key)
            .map(|key| key.to_string())
    }

    /// 设置文件颜色；`color` 为 `None` 时清除颜色。
    ///
    /// 只动标签上的颜色：标准颜色标签会被替换，自定义标签本身保留、颜色一并清掉，
    /// 保证"设置/清除"之后读写看到的是同一个颜色。名字表不可信时不写，避免写成
    /// 别的颜色或产生重复标签。
    pub fn write_color(path: &str, color: Option<&str>) -> Result<(), String> {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| write_color_impl(path, color)))
            .unwrap_or_else(|_| Err("Failed to update Finder tag color".to_string()))
    }

    fn write_color_impl(path: &str, color: Option<&str>) -> Result<(), String> {
        let number = match color {
            Some(key) => color_number(key).ok_or_else(|| format!("unknown color: {}", key))?,
            None => 0,
        };
        // 名字表不可用时只写 FinderInfo 颜色位，不凭空造标签名（否则会写出重复/错误的标签）
        let label = color.and_then(name_for_key);

        let tags = plan_tags(read_tags(path), label, number);

        if tags.is_empty() {
            remove_xattr(path, XATTR_TAGS)?;
        } else {
            write_xattr(path, XATTR_TAGS, &serialize_tags(&tags)?)?;
        }
        // 旧式颜色位给老系统和第三方工具看，写不进去（例如网络卷）不影响标签颜色
        let _ = write_legacy_color_number(path, number);
        Ok(())
    }

    /// 颜色选项（颜色键 + 显示用的标签名），顺序与 Finder 一致。
    ///
    /// 显示名字用系统语言的内置表兜底，识别颜色不依赖它。
    pub fn color_options() -> Vec<(String, String)> {
        std::panic::catch_unwind(|| options_for(display_names())).unwrap_or_default()
    }

    /// 纯函数：按名字表生成颜色选项（名字表总是有值：偏好 → 内置 → 英文）
    pub(super) fn options_for(names: &[String; 7]) -> Vec<(String, String)> {
        COLORS
            .iter()
            .enumerate()
            .map(|(index, (key, _))| {
                let label = names
                    .get(index)
                    .cloned()
                    .unwrap_or_else(|| DEFAULT_NAMES[index].to_string());
                (key.to_string(), label)
            })
            .collect()
    }
}

#[cfg(target_os = "macos")]
pub use mac::{color_options, read_color, write_color};

// 非 macOS 平台：功能不可用，返回空实现
#[cfg(not(target_os = "macos"))]
pub fn color_options() -> Vec<(String, String)> {
    Vec::new()
}

#[cfg(not(target_os = "macos"))]
pub fn read_color(_path: &str) -> Option<String> {
    None
}

#[cfg(not(target_os = "macos"))]
pub fn write_color(_path: &str, _color: Option<&str>) -> Result<(), String> {
    Err("Finder tags are only available on macOS".to_string())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use crate::macos_tags::mac::{
        builtin_names_for_locale, color_key_for_tag_name, favorites_from_plist_file, locale_keys,
        options_for, plan_tags, read_tags, validate_names, write_xattr, BUILTIN_NAMES,
        EXTRA_NAME_VARIANTS, KEYS_IN_ORDER,
    };

    /// 每个用例用独立临时目录，避免并行执行时互相打扰
    fn temp_file(case: &str, name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("textox-tag-test-{}", case));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, "x").unwrap();
        path
    }

    #[test]
    fn round_trip_every_color() {
        let path = temp_file("round-trip", "round-trip.md");
        let path = path.to_str().unwrap();

        assert_eq!(read_color(path), None);
        for key in ["red", "orange", "yellow", "green", "blue", "purple", "gray"] {
            write_color(path, Some(key)).unwrap();
            assert_eq!(read_color(path).as_deref(), Some(key), "读取颜色 {}", key);
        }
        // 颜色标签不应累积（名字表不可用时只写 FinderInfo，可能没有标签）
        assert!(read_tags(path).len() <= 1, "颜色标签不应累积: {:?}", read_tags(path));

        write_color(path, None).unwrap();
        assert_eq!(read_color(path), None);
        assert!(read_tags(path).is_empty());
        cleanup("round-trip");
    }

    #[test]
    fn keeps_custom_tags() {
        let path = temp_file("custom-tag", "custom-tag.md");
        let path = path.to_str().unwrap();

        // 用户标签自带颜色（编号 4 = 蓝色）
        write_xattr_public(path, &["工作\n4".to_string()]);
        write_color(path, Some("blue")).unwrap();
        assert_eq!(read_color(path).as_deref(), Some("blue"));

        // 用户标签原样保留（名字和它自己的颜色都不动），标准颜色标签排在最前
        let tags = read_tags(path);
        assert!(tags.contains(&"工作\n4".to_string()), "自定义标签应原样保留: {:?}", tags);
        assert!(!tags[0].starts_with("工作"), "颜色标签应排在最前: {:?}", tags);

        // 清除标准颜色标签后用户标签还在；文件颜色回到用户标签自己的颜色
        write_color(path, None).unwrap();
        assert_eq!(read_tags(path), vec!["工作\n4".to_string()]);
        assert_eq!(
            read_color(path).as_deref(),
            Some("blue"),
            "颜色来自用户自己的标签时，我们不该抹掉它"
        );
        cleanup("custom-tag");
    }

    /// 写入后的标签规划：新颜色排最前、其它标签保留但去掉颜色、拿不到名字时不写标签
    #[test]
    fn plan_tags_keeps_other_tags_untouched() {
        let planned = plan_tags(vec!["工作\n4".to_string()], Some("Blue"), 4);
        // 用户自己的标签（含它自己的颜色）原样保留，只把新颜色放到最前
        assert_eq!(planned, vec!["Blue\n4".to_string(), "工作\n4".to_string()]);

        // 沙箱版拿不到标准标签名：不写标签，其它标签也不动
        let planned = plan_tags(vec!["工作\n4".to_string()], None, 4);
        assert_eq!(planned, vec!["工作\n4".to_string()]);

        // 清除标准颜色标签后，用户标签仍在（它自己的颜色也还在）
        let planned = plan_tags(
            vec!["蓝色\n4".to_string(), "工作\n4".to_string()],
            None,
            0,
        );
        assert_eq!(planned, vec!["工作\n4".to_string()]);
    }

    /// 名字表校验：只有完整的 8 项（空占位 + 七个互不相同的名字）才可用
    #[test]
    fn validate_names_is_strict() {
        let valid: Vec<String> = std::iter::once(String::new())
            .chain(["红", "橙", "黄", "绿", "蓝", "紫", "灰"].map(String::from))
            .collect();
        assert!(validate_names(&valid).is_some());

        // 少一项
        assert!(validate_names(&valid[..7]).is_none());
        // 首项不是空占位
        let mut wrong_first = valid.clone();
        wrong_first[0] = "红".to_string();
        assert!(validate_names(&wrong_first).is_none());
        // 有重复名字
        let mut duplicate = valid.clone();
        duplicate[2] = duplicate[1].clone();
        assert!(validate_names(&duplicate).is_none());
        // 有空名字
        let mut empty_name = valid.clone();
        empty_name[3] = String::new();
        assert!(validate_names(&empty_name).is_none());
    }

    /// 颜色菜单不能因为拿不到标签名字就消失（沙箱版曾因此完全没有颜色菜单）
    #[test]
    fn color_options_survive_missing_name_table() {
        let options = color_options();
        assert_eq!(options.len(), 7, "颜色菜单不应因名字表不可用而消失");
        let keys: Vec<&str> = options.iter().map(|(key, _)| key.as_str()).collect();
        assert_eq!(
            keys,
            ["red", "orange", "yellow", "green", "blue", "purple", "gray"]
        );
        assert!(options.iter().all(|(_, name)| !name.is_empty()));
    }

    /// 直接解析偏好文件这条路要能拿到可用的标签列表（拿不到就跳过，例如沙箱/CI）
    #[test]
    fn plist_file_source_parses_finder_preferences() {
        let Some(names) = favorites_from_plist_file() else {
            return;
        };
        assert_eq!(names.len(), 8, "偏好里的标签列表应为 8 项: {:?}", names);
        assert!(names[0].is_empty(), "首项应是空占位: {:?}", names);
    }

    /// 菜单标签用传入的名字表；缺项时退回英文名
    #[test]
    fn options_use_given_names() {
        let fallback: [String; 7] =
            ["Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Gray"].map(String::from);
        let fallback = options_for(&fallback);
        assert_eq!(fallback[0], ("red".to_string(), "Red".to_string()));
        assert_eq!(fallback[6], ("gray".to_string(), "Gray".to_string()));

        let localized: [String; 7] = ["红", "橙", "黄", "绿", "蓝", "紫", "灰"].map(String::from);
        let with_names = options_for(&localized);
        assert_eq!(with_names[0], ("red".to_string(), "红".to_string()));
        assert_eq!(with_names[2], ("yellow".to_string(), "黄".to_string()));
    }

    /// 内置多语言名字表取自系统自带的 `TG_COLOR_*`，这里抽查几个核对过的语言
    #[test]
    fn builtin_names_cover_common_locales() {
        assert_eq!(locale_keys("zh-Hans-CN"), vec!["zh-hans"]);
        assert_eq!(locale_keys("zh_TW"), vec!["zh-hant"]);
        assert_eq!(locale_keys("en-US"), vec!["en-us", "en"]);
        assert_eq!(locale_keys("de-AT"), vec!["de-at", "de"]);

        let zh = builtin_names_for_locale("zh-Hans-CN").unwrap();
        assert_eq!(zh[3], "绿色");
        assert_eq!(color_number("green"), Some(2));

        let en = builtin_names_for_locale("en-US").unwrap();
        assert_eq!(en[3], "Green");

        let fr = builtin_names_for_locale("fr-FR").unwrap();
        assert_eq!(fr[0], "Rouge");

        // 这几个语言之前写错过，值以 Finder 的 TG_COLOR_* 资源为准
        let ja = builtin_names_for_locale("ja-JP").unwrap();
        assert_eq!(ja[0], "レッド");
        assert_eq!(ja[6], "グレイ");
        let ko = builtin_names_for_locale("ko-KR").unwrap();
        assert_eq!(ko[0], "빨간색");
        let th = builtin_names_for_locale("th-TH").unwrap();
        assert_eq!(th[0], "สีแดง");
        let vi = builtin_names_for_locale("vi-VN").unwrap();
        assert_eq!(vi[5], "Tía");
        let ru = builtin_names_for_locale("ru-RU").unwrap();
        assert_eq!(ru[2], "Желтый");
        assert_eq!(ru[5], "Лиловый");

        // 应用界面没有的语言也覆盖到了（取的是系统资源里的名字）
        let pl = builtin_names_for_locale("pl-PL").unwrap();
        assert_eq!(pl[0], "Czerwony");
        let tr = builtin_names_for_locale("tr-TR").unwrap();
        assert_eq!(tr[3], "Yeşil");
        let nl = builtin_names_for_locale("nl-NL").unwrap();
        assert_eq!(nl[6], "Grijs");

        // 地区差异：葡语巴西/葡萄牙的灰色、英语英式的拼写
        assert_eq!(builtin_names_for_locale("pt-BR").unwrap()[6], "Cinza");
        assert_eq!(builtin_names_for_locale("pt-PT").unwrap()[6], "Cinzento");
        assert_eq!(builtin_names_for_locale("en-GB").unwrap()[6], "Grey");
        // 只给语言时退回语言级表项（de-AT → de）
        assert_eq!(builtin_names_for_locale("de-AT").unwrap()[0], "Rot");

        assert!(builtin_names_for_locale("xx-YY").is_none());
    }

    /// 识别表里同一个名字不能对应两种颜色（防手抄/抄错）
    #[test]
    fn name_table_has_no_conflicting_entries() {
        let mut seen: std::collections::HashMap<String, &'static str> =
            std::collections::HashMap::new();
        let mut conflicts = Vec::new();
        for (_, names) in BUILTIN_NAMES.iter() {
            for (index, name) in names.iter().enumerate() {
                let key = name.to_lowercase();
                let color = KEYS_IN_ORDER[index];
                if let Some(previous) = seen.insert(key.clone(), color) {
                    if previous != color {
                        conflicts.push(format!("{}: {} vs {}", name, previous, color));
                    }
                }
            }
        }
        for (name, color) in EXTRA_NAME_VARIANTS.iter() {
            let color: &'static str = color;
            let key = name.to_lowercase();
            if let Some(previous) = seen.insert(key.clone(), color) {
                if previous != color {
                    conflicts.push(format!("{}: {} vs {}", name, previous, color));
                }
            }
        }
        assert!(conflicts.is_empty(), "名字表冲突: {:?}", conflicts);
    }

    /// 识别按标签名直接查表：不分语言、不看系统语言，大小写和空白也能容错
    #[test]
    fn identifies_colors_by_name_across_languages() {
        // 中文（简繁）与旧写法
        assert_eq!(color_key_for_tag_name("红色"), Some("red"));
        assert_eq!(color_key_for_tag_name("綠色"), Some("green"));
        assert_eq!(color_key_for_tag_name("蓝"), Some("blue"));
        // 英文 / 法文 / 德文 / 日文 / 韩文 / 俄文 / 泰文
        assert_eq!(color_key_for_tag_name("Green"), Some("green"));
        assert_eq!(color_key_for_tag_name("vert"), Some("green"));
        assert_eq!(color_key_for_tag_name("Gelb"), Some("yellow"));
        assert_eq!(color_key_for_tag_name("  绿色  "), Some("green"));
        assert_eq!(color_key_for_tag_name("  緑  "), Some("green"));
        assert_eq!(color_key_for_tag_name("紫"), Some("purple"));
        assert_eq!(color_key_for_tag_name("빨강"), Some("red"));
        assert_eq!(color_key_for_tag_name("Серый"), Some("gray"));
        assert_eq!(color_key_for_tag_name("เทา"), Some("gray"));
        // 应用界面没有的语言（表里有系统资源中的名字，所以也能认出来）
        assert_eq!(color_key_for_tag_name("Kırmızı"), Some("red"));
        assert_eq!(color_key_for_tag_name("Czerwony"), Some("red"));
        assert_eq!(color_key_for_tag_name("Yeşil"), Some("green"));
        assert_eq!(color_key_for_tag_name("Zöld"), Some("green"));
        assert_eq!(color_key_for_tag_name("Bíbor"), Some("purple"));
        assert_eq!(color_key_for_tag_name("Biru"), Some("blue"));
        // 自定义标签不认识
        assert_eq!(color_key_for_tag_name("工作"), None);
        assert_eq!(color_key_for_tag_name(""), None);
    }

    #[test]
    fn reads_legacy_finder_info_label() {
        let path = temp_file("legacy-label", "legacy-label.md");
        let path = path.to_str().unwrap();

        // FinderInfo 下标 9 的 bit 1-3：颜色编号 6 = 红色
        let mut info = vec![0u8; 32];
        info[9] = 6 << 1;
        write_xattr(path, "com.apple.FinderInfo", &info).unwrap();
        assert_eq!(read_color(path).as_deref(), Some("red"));

        // 清除颜色时旧式颜色位一并清掉
        write_color(path, Some("green")).unwrap();
        assert_eq!(read_color(path).as_deref(), Some("green"));
        write_color(path, None).unwrap();
        assert_eq!(read_color(path), None);
        cleanup("legacy-label");
    }

    /// 颜色只是附加信息：任何异常数据都应被忽略而不是报错
    #[test]
    fn ignores_broken_metadata() {
        // 路径不存在
        assert_eq!(read_color("/private/tmp/textox-not-exists-3f9a1c"), None);

        // 标签 xattr 不是合法 plist
        let path = temp_file("broken-plist", "broken-plist.md");
        let path = path.to_str().unwrap();
        write_xattr(path, "com.apple.metadata:_kMDItemUserTags", b"not a plist").unwrap();
        assert_eq!(read_color(path), None);

        // 颜色编号超出范围
        write_xattr_public(path, &["工作\n99".to_string()]);
        assert_eq!(read_color(path), None);

        // 空标签数组
        write_xattr(path, "com.apple.metadata:_kMDItemUserTags", b"").unwrap();
        assert_eq!(read_color(path), None);

        // FinderInfo 里没有颜色位
        write_xattr(path, "com.apple.FinderInfo", &[0u8; 32]).unwrap();
        assert_eq!(read_color(path), None);

        // 未知颜色键不应写坏文件
        assert!(write_color(path, Some("chartreuse")).is_err());
        cleanup("broken-plist");
    }

    /// 标准颜色标签以名字为准（与 Finder 实测一致），自定义标签才看编号
    #[test]
    fn reads_color_by_name_when_number_is_rewritten() {
        let path = temp_file("icloud", "icloud.md");
        let path = path.to_str().unwrap();

        // 实测 iCloud 同步后的形态：名字保住，编号被写成 1，FinderInfo 也被写成 1
        let mut info = vec![0u8; 32];
        info[9] = 1 << 1;
        write_xattr(path, "com.apple.FinderInfo", &info).unwrap();

        write_xattr_public(path, &["红色\n1".to_string()]);
        assert_eq!(read_color(path).as_deref(), Some("red"));

        write_xattr_public(path, &["黄色\n1".to_string()]);
        assert_eq!(read_color(path).as_deref(), Some("yellow"));

        // Finder 里改成绿色、被 iCloud 改写编号后，必须还是绿色（之前会显示成灰色）
        write_xattr_public(path, &["绿色\n1".to_string()]);
        assert_eq!(read_color(path).as_deref(), Some("green"));

        // 英文标准标签同理
        write_xattr_public(path, &["Green\n1".to_string()]);
        assert_eq!(read_color(path).as_deref(), Some("green"));

        // 名字与编号冲突时以名字为准（实测 Finder 也是显示红色）
        write_xattr_public(path, &["红色\n4".to_string()]);
        assert_eq!(read_color(path).as_deref(), Some("red"));

        // 自定义标签没有名字线索，按编号取色（实测 Finder 显示蓝色）
        write_xattr_public(path, &["工作\n4".to_string()]);
        assert_eq!(read_color(path).as_deref(), Some("blue"));
        write_xattr_public(path, &["工作\n1".to_string()]);
        assert_eq!(read_color(path).as_deref(), Some("gray"));

        cleanup("icloud");
    }

    fn cleanup(case: &str) {
        let _ = std::fs::remove_dir_all(std::env::temp_dir().join(format!("textox-tag-test-{}", case)));
    }

    /// 写入用真实颜色编号（与 Finder 一致：红 6、橙 7、黄 5、绿 2、蓝 4、紫 3、灰 1），
    /// 标签与 FinderInfo 两处一致
    #[test]
    fn writes_same_color_number_as_finder() {
        let path = temp_file("numbers", "numbers.md");
        let path = path.to_str().unwrap();

        for (key, number) in [
            ("red", 6u8),
            ("orange", 7),
            ("yellow", 5),
            ("green", 2),
            ("blue", 4),
            ("purple", 3),
            ("gray", 1),
        ] {
            write_color(path, Some(key)).unwrap();

            let info = mac::read_xattr(path, "com.apple.FinderInfo").unwrap();
            assert_eq!((info[9] & 0x0E) >> 1, number, "{} 的 FinderInfo 颜色位", key);

            // 读不到系统标签名时只写 FinderInfo（沙箱版），此时没有标签可查
            let tags = read_tags(path);
            if !tags.is_empty() {
                assert!(
                    tags.iter().any(|tag| tag.ends_with(&format!("\n{}", number))),
                    "{} 应写入编号 {}: {:?}",
                    key,
                    number,
                    tags
                );
            }
        }
        cleanup("numbers");
    }

    /// 测试辅助：直接写入标签数组
    fn write_xattr_public(path: &str, tags: &[String]) {
        let bytes = mac::serialize_tags(tags).unwrap();
        write_xattr(path, "com.apple.metadata:_kMDItemUserTags", &bytes).unwrap();
    }

}
