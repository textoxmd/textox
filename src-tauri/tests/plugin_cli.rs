//! 集成测试：跑真实 `plugin-cli` 二进制，覆盖安装 / 启停 / 卸载 / 安全模式。

use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use zip::write::SimpleFileOptions;
use zip::ZipWriter;

const BIN: &str = env!("CARGO_BIN_EXE_plugin-cli");
const ID: &str = "app.textox.cli-probe";

struct TempRoot(PathBuf);

impl TempRoot {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("textox-cli-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn manifest(id: &str, version: &str) -> String {
    format!(
        r#"{{"id":"{id}","name":"CLI Probe","version":"{version}","minAppVersion":"2.3.8","author":{{"name":"Textox"}}}}"#
    )
}

fn build_zip(entries: &[(String, String)]) -> Vec<u8> {
    let mut buffer = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut buffer);
        let options = SimpleFileOptions::default();
        for (name, content) in entries {
            writer.start_file(name.as_str(), options).unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        }
        writer.finish().unwrap();
    }
    buffer.into_inner()
}

fn valid_zip() -> Vec<u8> {
    build_zip(&[
        (format!("{ID}/manifest.json"), manifest(ID, "0.1.0")),
        (
            format!("{ID}/main.js"),
            "export default class extends Object {}".to_string(),
        ),
    ])
}

fn write_package(root: &TempRoot, bytes: &[u8]) -> PathBuf {
    let path = root.path().join(format!("{ID}.zip"));
    std::fs::write(&path, bytes).unwrap();
    path
}

fn cli(data_dir: &Path, args: &[&str]) -> Output {
    Command::new(BIN)
        .arg("--data-dir")
        .arg(data_dir)
        .args(args)
        .output()
        .expect("failed to run plugin-cli")
}

fn cli_raw(args: &[&str]) -> Output {
    Command::new(BIN)
        .args(args)
        .output()
        .expect("failed to run plugin-cli")
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn state_json(data_dir: &Path) -> serde_json::Value {
    let text = std::fs::read_to_string(data_dir.join("plugins/plugins.json")).unwrap();
    serde_json::from_str(&text).unwrap()
}

fn install(root: &TempRoot, data_dir: &Path) {
    let package = write_package(root, &valid_zip());
    let output = cli(data_dir, &["install", package.to_str().unwrap()]);
    assert!(
        output.status.success(),
        "install failed: {}",
        stderr(&output)
    );
    // 脚本靠第一行判定安装成功，必须是 `installed <id>`
    let text = stdout(&output);
    let first = text.lines().next().unwrap_or_default();
    assert_eq!(first, format!("installed {ID}"), "{text}");
}

#[test]
fn install_then_list_shows_the_plugin() {
    let root = TempRoot::new();
    let data_dir = root.path().join("data");

    install(&root, &data_dir);
    let listed = cli(&data_dir, &["list"]);

    assert!(listed.status.success());
    let text = stdout(&listed);
    assert!(text.contains("id\tversion\tstate\terror"), "{text}");
    assert!(text.contains(ID), "{text}");
    assert!(text.contains("0.1.0"), "{text}");
    assert!(text.contains("disabled"), "{text}");
    assert!(data_dir.join("plugins").join(ID).join("main.js").exists());
}

#[test]
fn enable_and_disable_toggle_state() {
    let root = TempRoot::new();
    let data_dir = root.path().join("data");
    install(&root, &data_dir);

    let enabled = cli(&data_dir, &["enable", ID]);
    assert!(enabled.status.success(), "{}", stderr(&enabled));
    assert!(stdout(&cli(&data_dir, &["list"])).contains("enabled"));
    assert_eq!(state_json(&data_dir)["enabled"], serde_json::json!([ID]));

    let disabled = cli(&data_dir, &["disable", ID]);
    assert!(disabled.status.success(), "{}", stderr(&disabled));
    assert!(stdout(&cli(&data_dir, &["list"])).contains("disabled"));
    assert_eq!(state_json(&data_dir)["enabled"], serde_json::json!([]));
}

#[test]
fn uninstall_removes_directory_and_state() {
    let root = TempRoot::new();
    let data_dir = root.path().join("data");
    install(&root, &data_dir);
    assert!(cli(&data_dir, &["enable", ID]).status.success());

    let removed = cli(&data_dir, &["uninstall", ID]);

    assert!(removed.status.success(), "{}", stderr(&removed));
    assert!(!data_dir.join("plugins").join(ID).exists());
    assert_eq!(state_json(&data_dir)["enabled"], serde_json::json!([]));

    // 幂等：再删一次仍成功
    assert!(cli(&data_dir, &["uninstall", ID]).status.success());
}

#[test]
fn uninstall_does_not_print_the_empty_list_notice() {
    let root = TempRoot::new();
    let data_dir = root.path().join("data");
    install(&root, &data_dir);

    let removed = cli(&data_dir, &["uninstall", ID]);

    assert!(removed.status.success(), "{}", stderr(&removed));
    assert!(
        stdout(&removed).starts_with(&format!("uninstalled {ID}\n")),
        "{}",
        stdout(&removed)
    );
    // 空表提示只属于 list：卸载最后一个插件后 stderr 必须为空
    assert_eq!(stderr(&removed), "");
}

#[test]
fn rejects_invalid_package_and_exits_non_zero() {
    let root = TempRoot::new();
    let data_dir = root.path().join("data");
    let bytes = build_zip(&[
        (format!("{ID}/manifest.json"), manifest(ID, "0.1.0")),
        (format!("{ID}/main.js"), "x".to_string()),
        ("com.example.other/main.js".to_string(), "y".to_string()),
    ]);
    let package = write_package(&root, &bytes);

    let output = cli(&data_dir, &["install", package.to_str().unwrap()]);

    assert!(!output.status.success());
    assert!(stderr(&output).contains("top-level"), "{}", stderr(&output));
    assert!(!data_dir.join("plugins").join(ID).exists());
}

#[test]
fn safe_mode_switch_is_persisted() {
    let root = TempRoot::new();
    let data_dir = root.path().join("data");
    std::fs::create_dir_all(data_dir.join("plugins")).unwrap();

    assert!(cli(&data_dir, &["safe-mode", "off"]).status.success());
    assert_eq!(state_json(&data_dir)["safe_mode"], serde_json::json!(false));

    assert!(cli(&data_dir, &["safe-mode", "on"]).status.success());
    assert_eq!(state_json(&data_dir)["safe_mode"], serde_json::json!(true));
}

#[test]
fn list_reports_a_broken_manifest_in_the_error_column() {
    let root = TempRoot::new();
    let data_dir = root.path().join("data");
    let broken = data_dir.join("plugins").join("app.textox.broken");
    std::fs::create_dir_all(&broken).unwrap();
    std::fs::write(broken.join("manifest.json"), "{ not json").unwrap();

    let listed = cli(&data_dir, &["list"]);

    assert!(listed.status.success(), "{}", stderr(&listed));
    let text = stdout(&listed);
    let line = text
        .lines()
        .find(|line| line.starts_with("app.textox.broken"))
        .unwrap_or_else(|| panic!("missing broken plugin row: {text}"));
    let columns: Vec<&str> = line.split('\t').collect();
    assert_eq!(columns.len(), 4, "row must have four columns: {line}");
    assert_eq!(columns[1], "-", "{line}");
    assert_eq!(columns[2], "disabled", "{line}");
    assert!(columns[3].contains("invalid manifest"), "{line}");
}

#[test]
fn list_succeeds_when_the_data_dir_does_not_exist() {
    let root = TempRoot::new();
    let data_dir = root.path().join("missing-data");

    let listed = cli(&data_dir, &["list"]);

    assert!(listed.status.success(), "{}", stderr(&listed));
    assert_eq!(stdout(&listed), "id\tversion\tstate\terror\n");
    // 空态提示走 stderr，并带上实际数据根，便于确认看的是哪个目录
    let message = stderr(&listed);
    assert!(message.contains("no plugins installed"), "{message}");
    assert!(
        message.contains(&data_dir.display().to_string()),
        "{message}"
    );
    // 只读命令不应把数据目录建出来
    assert!(!data_dir.exists());
}

#[test]
fn rejects_repeated_data_dir() {
    let root = TempRoot::new();
    let first = root.path().join("first");
    let second = root.path().join("second");

    let output = cli_raw(&[
        "--data-dir",
        first.to_str().unwrap(),
        "--data-dir",
        second.to_str().unwrap(),
        "list",
    ]);

    assert!(!output.status.success());
    assert!(
        stderr(&output).contains("only one value"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn enable_rejects_an_uninstalled_plugin() {
    let root = TempRoot::new();
    let data_dir = root.path().join("data");

    let output = cli(&data_dir, &["enable", "app.textox.missing"]);

    assert!(!output.status.success());
    assert!(
        stderr(&output).contains("not installed"),
        "{}",
        stderr(&output)
    );
    // 未安装的 id 不得写进 plugins.json
    assert!(!data_dir.join("plugins").join("plugins.json").exists());
}
