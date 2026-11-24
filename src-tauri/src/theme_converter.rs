use crate::theme_manager::ThemeMeta;
use std::collections::HashMap;

const THEME_VAR_MAP: &[(&str, &str)] = &[
    ("--bg-color", "--background"),
    ("--text-color", "--foreground"),
    ("--side-bar-bg-color", "--sidebar"),
    ("--side-bar-text-color", "--sidebar-foreground"),
    ("--active-file-bg-color", "--sidebar-accent"),
    ("--active-file-text-color", "--sidebar-accent-foreground"),
    ("--primary-color", "--primary"),
    ("--primary-btn-border-color", "--border"),
    ("--item-hover-bg-color", "--accent"),
    ("--item-hover-text-color", "--accent-foreground"),
    ("--window-border", "--ring"),
    ("--select-text-bg-color", "--primary"),
    ("--select-text-font-color", "--primary-foreground"),
    ("--control-text-color", "--muted-foreground"),
    ("--control-text-hover-color", "--foreground"),
];

fn required_texto_variables() -> Vec<&'static str> {
    vec![
        "background",
        "foreground",
        "card",
        "card-foreground",
        "popover",
        "popover-foreground",
        "primary",
        "primary-foreground",
        "secondary",
        "secondary-foreground",
        "muted",
        "muted-foreground",
        "accent",
        "accent-foreground",
        "destructive",
        "border",
        "input",
        "ring",
        "chart-1",
        "chart-2",
        "chart-3",
        "chart-4",
        "chart-5",
        "sidebar",
        "sidebar-foreground",
        "sidebar-primary",
        "sidebar-primary-foreground",
        "sidebar-accent",
        "sidebar-accent-foreground",
        "sidebar-border",
        "sidebar-ring",
        "color-scheme",
    ]
}

fn default_value_for_variable(var_name: &str) -> &'static str {
    match var_name {
        "background" => "oklch(1 0 0)",
        "foreground" => "oklch(0.145 0 0)",
        "card" => "var(--background)",
        "card-foreground" => "var(--foreground)",
        "popover" => "var(--background)",
        "popover-foreground" => "var(--foreground)",
        "primary" => "oklch(0.205 0 0)",
        "primary-foreground" => "oklch(0.985 0 0)",
        "secondary" => "oklch(0.97 0 0)",
        "secondary-foreground" => "oklch(0.205 0 0)",
        "muted" => "var(--secondary)",
        "muted-foreground" => "oklch(0.556 0 0)",
        "accent" => "var(--secondary)",
        "accent-foreground" => "var(--foreground)",
        "destructive" => "oklch(0.577 0.245 27.325)",
        "border" => "oklch(0.922 0 0)",
        "input" => "var(--border)",
        "ring" => "oklch(0.708 0 0)",
        "chart-1" => "oklch(0.646 0.222 41.116)",
        "chart-2" => "oklch(0.6 0.118 184.704)",
        "chart-3" => "oklch(0.398 0.07 227.392)",
        "chart-4" => "oklch(0.828 0.189 84.429)",
        "chart-5" => "oklch(0.769 0.188 70.08)",
        "sidebar" => "var(--background)",
        "sidebar-foreground" => "var(--foreground)",
        "sidebar-primary" => "var(--primary)",
        "sidebar-primary-foreground" => "var(--primary-foreground)",
        "sidebar-accent" => "var(--secondary)",
        "sidebar-accent-foreground" => "var(--foreground)",
        "sidebar-border" => "var(--border)",
        "sidebar-ring" => "var(--ring)",
        "color-scheme" => "light",
        _ => "var(--background)",
    }
}

pub fn detect_theme_format(css: &str) -> bool {
    THEME_VAR_MAP
        .iter()
        .filter(|(css_var, _)| css.contains(css_var))
        .count()
        >= 3
}

pub fn convert_theme_css(css: &str) -> (String, Vec<String>) {
    let mut notes = Vec::new();

    let mut converted = css.to_string();
    let mut mapped_vars: Vec<String> = Vec::new();

    for (source_var, texto_var) in THEME_VAR_MAP {
        if converted.contains(source_var) {
            converted = converted.replace(source_var, texto_var);
            mapped_vars.push(texto_var[2..].to_string());
        }
    }

    let has_dark_mode = css.contains("#write") || css.contains("html");

    let mut extracted: HashMap<String, String> = HashMap::new();
    let mut seen_vars: Vec<String> = Vec::new();

    for line in converted.lines() {
        let trimmed = line.trim();
        if let Some((name, value)) = parse_css_var(trimmed) {
            extracted.insert(name.clone(), value);
            seen_vars.push(format!("--{}", name));
        }
    }

    let mut light_vars: Vec<(String, String)> = extracted
        .iter()
        .map(|(k, v)| (format!("--{}", k), v.clone()))
        .collect();

    let mut generated_vars: Vec<String> = Vec::new();
    for var_name in required_texto_variables() {
        let full_name = format!("--{}", var_name);
        if !seen_vars.contains(&full_name) {
            let default_val = resolve_default(var_name, &extracted);
            light_vars.push((full_name, default_val));
            generated_vars.push(var_name.to_string());
        }
    }

    let mut output = String::new();
    output.push_str("/* Converted from external theme */\n\n");
    output.push_str(":root {\n");
    for (name, value) in &light_vars {
        output.push_str(&format!("  {}: {};\n", name, value));
    }
    output.push_str("}\n");

    if has_dark_mode {
        output.push_str("\n.dark {\n");
        for (name, value) in &light_vars {
            output.push_str(&format!("  {}: {};\n", name, value));
        }
        output.push_str("}\n");
    }

    notes.push(format!("Mapped variables: {}", mapped_vars.join(", ")));
    if !generated_vars.is_empty() {
        notes.push(format!("Auto-generated: {}", generated_vars.join(", ")));
    }
    notes.push(format!("Dark mode detected: {}", has_dark_mode));

    (output, notes)
}

fn parse_css_var(line: &str) -> Option<(String, String)> {
    let line = line.trim_end_matches(';').trim_end_matches(',').trim();
    let colon_pos = line.find(':')?;
    let name = line[..colon_pos].trim().to_string();
    let value = line[colon_pos + 1..].trim().to_string();
    if name.starts_with("--") && !value.is_empty() {
        Some((name[2..].to_string(), value))
    } else {
        None
    }
}

fn resolve_default(var_name: &str, extracted: &HashMap<String, String>) -> String {
    let default_val = default_value_for_variable(var_name);
    if default_val.starts_with("var(--") {
        let inner = &default_val[6..default_val.len() - 1];
        if let Some(val) = extracted.get(inner) {
            return val.clone();
        }
    }
    default_val.to_string()
}

pub fn validate_css_security(css: &str) -> Result<(), String> {
    let lower = css.to_lowercase();
    if lower.contains("url(http") || lower.contains("url(https") {
        return Err(
            "CSS contains external URL references, which are not allowed for security reasons."
                .to_string(),
        );
    }
    if lower.contains("@import") {
        return Err("@import directives are not allowed for security reasons.".to_string());
    }
    if lower.contains("@font-face") {
        return Err("@font-face directives are not supported in themes.".to_string());
    }
    Ok(())
}

fn generate_theme_id(name: &str) -> String {
    let id = name
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if id.is_empty() {
        "imported-theme".to_string()
    } else {
        id
    }
}

pub fn create_meta_from_file(filename: &str, theme_type: &str) -> ThemeMeta {
    let stem = std::path::Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("imported-theme");
    let id = generate_theme_id(stem);
    let display = stem.replace(['-', '_'], " ");
    let name = display
        .split_whitespace()
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    ThemeMeta {
        id,
        name,
        version: "1.0.0".to_string(),
        author: None,
        description: None,
        theme_type: theme_type.to_string(),
        is_builtin: false,
        is_default: false,
        imported_from: Some(filename.to_string()),
        imported_at: Some(chrono::Utc::now().to_rfc3339()),
        conversion_notes: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_theme_id_slugifies() {
        assert_eq!(generate_theme_id("My Theme!"), "my-theme");
        assert_eq!(generate_theme_id("2024 年度报告"), "2024-年度报告");
        assert_eq!(generate_theme_id("already-kebab"), "already-kebab");
    }

    #[test]
    fn generate_theme_id_falls_back_when_empty() {
        // 纯符号/空白名称会产生空 id，必须回退，否则主题会写到 themes 根目录
        assert_eq!(generate_theme_id("!!!"), "imported-theme");
        assert_eq!(generate_theme_id("---"), "imported-theme");
        assert_eq!(generate_theme_id(""), "imported-theme");
    }

    #[test]
    fn generated_theme_id_is_always_a_safe_single_component() {
        for name in ["a/b", "../evil", ".", "..", "", "!!#@$", "x y z"] {
            let id = generate_theme_id(name);
            assert!(
                id == "imported-theme" || !id.is_empty(),
                "unexpected empty id for {:?}",
                name
            );
            let mut components = std::path::Path::new(&id).components();
            assert!(
                matches!(
                    components.next(),
                    Some(std::path::Component::Normal(c)) if c == id.as_str()
                ) && components.next().is_none(),
                "unsafe id {:?} generated from {:?}",
                id,
                name
            );
        }
    }
}
