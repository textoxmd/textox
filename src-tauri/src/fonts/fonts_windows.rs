use windows::Win32::Graphics::DirectWrite::*;

use crate::fonts::FontInfo;

pub fn get_system_fonts() -> Result<Vec<FontInfo>, String> {
    unsafe {
        let factory: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)
            .map_err(|e| format!("Failed to create DirectWrite factory: {}", e))?;

        let mut collection: Option<IDWriteFontCollection> = None;
        factory
            .GetSystemFontCollection(&mut collection, false)
            .map_err(|e| format!("Failed to get system font collection: {}", e))?;
        let collection = collection.ok_or("Failed to get system font collection")?;

        let count = collection.GetFontFamilyCount();

        let mut fonts = Vec::new();
        let mut seen_families = std::collections::HashSet::new();

        for i in 0..count {
            let family: IDWriteFontFamily = match collection.GetFontFamily(i) {
                Ok(f) => f,
                Err(_) => continue,
            };

            let family_name: Vec<u16> = match family.GetFamilyNames() {
                Ok(names) => {
                    let mut name_buf = [0u16; 512];
                    if let Ok(length) = names.GetStringLength(0) {
                        if length == 0 {
                            continue;
                        }
                        let len = (length as usize).min(name_buf.len() - 1);
                        if names.GetString(0, &mut name_buf[..len]).is_ok() {
                            name_buf[..len].to_vec()
                        } else {
                            continue;
                        }
                    } else {
                        continue;
                    }
                }
                Err(_) => continue,
            };

            let name = String::from_utf16_lossy(&family_name);
            if name.is_empty() || seen_families.contains(&name) {
                continue;
            }
            seen_families.insert(name.clone());

            fonts.push(FontInfo {
                family: name.clone(),
                name: name.clone(),
                postscript_name: name,
            });
        }

        fonts.sort_by(|a, b| a.family.cmp(&b.family));
        Ok(fonts)
    }
}
