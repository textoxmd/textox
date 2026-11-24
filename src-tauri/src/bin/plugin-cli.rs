//! 插件管理命令行：不依赖 `AppHandle`，直接用 `plugins::*` 的纯函数安装/卸载/启停/查询。
//!
//! 用法见 `USAGE`；错误一律打到 stderr 并以退出码 1 结束（不 panic，下游提前关管道也不 panic）。

use std::io::Write;
use std::path::{Path, PathBuf};

use texto_lib::plugins::install::{install_plugin_file, uninstall_plugin};
use texto_lib::plugins::paths::plugins_root_at;
use texto_lib::plugins::scan::{scan, set_enabled_in, set_safe_mode_in, InstalledPlugin};

const USAGE: &str = "\
用法：plugin-cli [--data-dir <dir>] <command>

命令：
  list                       列出已安装插件（id / version / state / error）
  install <file.zip>         安装 .zip（插件包）
  uninstall <id>             卸载（同时从 plugins.json 的 enabled 移除）
  enable <id>                写入 enabled 并列出结果
  disable <id>               取消 enabled
  safe-mode <on|off>         切换安全模式
  help                       打印用法

选项：
  --data-dir <dir>           覆盖数据根（默认 <appData>/com.texto.markdown；
                             Lite 版为 com.texto.markdown.lite，请用 --data-dir 指定）
";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    List,
    Install(PathBuf),
    Uninstall(String),
    Enable(String),
    Disable(String),
    SafeMode(bool),
    Help,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Args {
    pub data_dir: Option<PathBuf>,
    pub command: Command,
}

/// 手写解析（不引 clap）：`--data-dir` 只允许出现在子命令之前。
pub fn parse_args(argv: &[String]) -> Result<Args, String> {
    let mut data_dir: Option<PathBuf> = None;
    let mut index = 0;

    while index < argv.len() && argv[index] == "--data-dir" {
        if data_dir.is_some() {
            return Err("--data-dir accepts only one value".to_string());
        }
        let value = argv
            .get(index + 1)
            .ok_or_else(|| "--data-dir 需要一个目录参数".to_string())?;
        if value.starts_with("--") {
            return Err(format!("--data-dir requires a directory (got {value})"));
        }
        data_dir = Some(PathBuf::from(value));
        index += 2;
    }

    let command = argv.get(index).map(String::as_str).ok_or_else(|| {
        "缺少子命令（list / install / uninstall / enable / disable / safe-mode / help）".to_string()
    })?;
    let rest: Vec<&str> = argv[index + 1..].iter().map(String::as_str).collect();

    let expect_arg = |name: &str| -> Result<String, String> {
        match rest.as_slice() {
            [single] => Ok((*single).to_string()),
            [] => Err(format!("{name} 需要一个参数")),
            _ => Err(format!("{name} 只接受一个参数")),
        }
    };
    let expect_no_arg = || -> Result<(), String> {
        if rest.is_empty() {
            Ok(())
        } else {
            Err(format!("{command} 不接受额外参数"))
        }
    };

    let command = match command {
        "list" => {
            expect_no_arg()?;
            Command::List
        }
        "help" | "--help" | "-h" => {
            expect_no_arg()?;
            Command::Help
        }
        "install" => Command::Install(PathBuf::from(expect_arg("install")?)),
        "uninstall" => Command::Uninstall(expect_arg("uninstall")?),
        "enable" => Command::Enable(expect_arg("enable")?),
        "disable" => Command::Disable(expect_arg("disable")?),
        "safe-mode" => match expect_arg("safe-mode")?.as_str() {
            "on" => Command::SafeMode(true),
            "off" => Command::SafeMode(false),
            other => return Err(format!("safe-mode 只接受 on|off，收到 {other}")),
        },
        other => return Err(format!("未知子命令：{other}")),
    };

    Ok(Args { data_dir, command })
}

/// 默认数据根：`<appData>/com.texto.markdown`（与 Tauri 的 `app_data_dir()` 一致）。
///
/// Lite 版的 bundle identifier 是 `com.texto.markdown.lite`，该默认值对 Lite 不适用，
/// 请用 `--data-dir` 显式指定（CLI 无法感知当前 edition）。
fn default_data_dir() -> Result<PathBuf, String> {
    dirs::data_dir()
        .map(|dir| dir.join("com.texto.markdown"))
        .ok_or_else(|| "无法解析默认数据目录，请显式传 --data-dir".to_string())
}

fn manifest_field<'a>(manifest: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    manifest.get(key).and_then(|value| value.as_str())
}

/// 写一行到 stdout。下游 `head` / `grep -q` 提前关管道是正常用法，不视为错误。
fn emit(line: &str) -> Result<(), String> {
    match writeln!(std::io::stdout().lock(), "{line}") {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::BrokenPipe => Ok(()),
        Err(error) => Err(format!("write stdout: {error}")),
    }
}

/// 诊断输出走 stderr；stderr 被关闭或下游提前退出时静默忽略——
/// 这些只是提示，不应该让命令以 panic 收场。
fn note(line: &str) {
    let mut stderr = std::io::stderr().lock();
    let _ = writeln!(stderr, "{line}");
}

/// 读插件列表：首次使用目录还不存在时与 GUI 的 plugin_scan 语义对齐，视为没有插件。
/// 只判 exists()，不吞 scan 的错误——`<data-dir>/plugins` 是普通文件时仍应报 Not a directory。
fn list_plugins(root: &Path) -> Result<Vec<InstalledPlugin>, String> {
    if root.exists() {
        scan(root)
    } else {
        Ok(Vec::new())
    }
}

fn print_list(plugins: &[InstalledPlugin]) -> Result<(), String> {
    emit("id\tversion\tstate\terror")?;
    for plugin in plugins {
        let version = manifest_field(&plugin.manifest, "version").unwrap_or("-");
        let state_label = if plugin.enabled {
            "enabled"
        } else {
            "disabled"
        };
        let error = plugin.error.as_deref().unwrap_or_default();
        emit(&format!(
            "{}\t{}\t{}\t{}",
            plugin.id, version, state_label, error
        ))?;
    }
    Ok(())
}

fn command_name(command: &Command) -> &'static str {
    match command {
        Command::List => "list",
        Command::Install(_) => "install",
        Command::Uninstall(_) => "uninstall",
        Command::Enable(_) => "enable",
        Command::Disable(_) => "disable",
        Command::SafeMode(_) => "safe-mode",
        Command::Help => "help",
    }
}

fn dispatch(root: &Path, command: Command) -> Result<(), String> {
    match command {
        Command::List => {
            let plugins = list_plugins(root)?;
            print_list(&plugins)?;
            if plugins.is_empty() {
                note(&format!(
                    "plugin-cli: no plugins installed under {}",
                    root.display()
                ));
            }
            Ok(())
        }
        Command::Install(file) => {
            let id = install_plugin_file(root, &file)?;
            emit(&format!("installed {id}"))?;
            print_list(&list_plugins(root)?)
        }
        Command::Uninstall(id) => {
            uninstall_plugin(root, &id)?;
            emit(&format!("uninstalled {id}"))?;
            print_list(&list_plugins(root)?)
        }
        Command::Enable(id) => {
            if !root.join(&id).join("manifest.json").exists() {
                return Err(format!("plugin not installed: {id}"));
            }
            let state = set_enabled_in(root, &id, true)?;
            // 安全模式开启时第三方插件只会被标记 blocked，提示一下避免误判为 bug
            if state.safe_mode && !id.starts_with("app.textox.") {
                note("plugin-cli: safe mode is on, third-party plugins will not load until it is disabled");
            }
            emit(&format!("enabled {id}"))?;
            print_list(&list_plugins(root)?)
        }
        Command::Disable(id) => {
            set_enabled_in(root, &id, false)?;
            emit(&format!("disabled {id}"))?;
            print_list(&list_plugins(root)?)
        }
        Command::SafeMode(safe_mode) => {
            let state = set_safe_mode_in(root, safe_mode)?;
            emit(&format!("safe_mode {}", state.safe_mode))
        }
        Command::Help => unreachable!("help is handled before the data dir is resolved"),
    }
}

fn run(args: Args) -> Result<(), String> {
    if matches!(args.command, Command::Help) {
        emit(USAGE.trim_end())?;
        return Ok(());
    }

    let data_dir = match args.data_dir {
        Some(dir) => dir,
        None => default_data_dir()?,
    };
    let root = plugins_root_at(&data_dir);

    let name = command_name(&args.command);
    dispatch(&root, args.command).map_err(|error| format!("{name}: {error}"))
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let result = parse_args(&argv).and_then(run);
    if let Err(error) = result {
        note(&format!("plugin-cli: {error}"));
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_string()).collect()
    }

    #[test]
    fn parses_command_without_data_dir() {
        assert_eq!(
            parse_args(&argv(&["list"])).unwrap(),
            Args {
                data_dir: None,
                command: Command::List
            }
        );
    }

    #[test]
    fn parses_data_dir_before_the_command() {
        let parsed = parse_args(&argv(&[
            "--data-dir",
            "/tmp/x",
            "enable",
            "app.textox.demo",
        ]))
        .unwrap();
        assert_eq!(parsed.data_dir, Some(PathBuf::from("/tmp/x")));
        assert_eq!(
            parsed.command,
            Command::Enable("app.textox.demo".to_string())
        );

        assert_eq!(
            parse_args(&argv(&["--data-dir", "/tmp/x", "safe-mode", "off"]))
                .unwrap()
                .command,
            Command::SafeMode(false)
        );
    }

    #[test]
    fn rejects_unknown_command_and_missing_arguments() {
        assert!(parse_args(&argv(&["frobnicate"]))
            .unwrap_err()
            .contains("未知子命令"));
        assert!(parse_args(&argv(&["install"]))
            .unwrap_err()
            .contains("需要一个参数"));
        assert!(parse_args(&argv(&["safe-mode", "maybe"]))
            .unwrap_err()
            .contains("on|off"));
        assert!(parse_args(&argv(&["--data-dir"]))
            .unwrap_err()
            .contains("需要一个目录参数"));
        assert!(parse_args(&argv(&[])).unwrap_err().contains("缺少子命令"));
    }

    #[test]
    fn rejects_repeated_or_valueless_data_dir() {
        assert!(parse_args(&argv(&[
            "--data-dir",
            "/tmp/x",
            "--data-dir",
            "/tmp/y",
            "list"
        ]))
        .unwrap_err()
        .contains("only one value"));

        // 值看起来像另一个选项：多半是漏了目录，直接报错而不是当成路径
        assert!(parse_args(&argv(&["--data-dir", "--help"]))
            .unwrap_err()
            .contains("requires a directory"));

        assert_eq!(
            parse_args(&argv(&["--data-dir", "/tmp/x", "install", "a.zip"]))
                .unwrap()
                .command,
            Command::Install(PathBuf::from("a.zip"))
        );
    }
}
