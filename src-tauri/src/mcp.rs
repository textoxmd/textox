//! 最小 MCP（Model Context Protocol）服务端原型。
//!
//! 目标：让外部 AI 客户端（opencode / Claude 等）通过 Streamable HTTP 调用 Textox
//! 的应用内能力，验证「编辑器 → 外部 agent」这条链路。
//!
//! 形态说明：
//! - 只监听 `127.0.0.1`，不对外网暴露；端口取设置里的 `AppConfig.mcp_port`
//!   （默认 38471，`TEXTO_MCP_PORT` 可覆盖，仅开发调试用）。
//! - 由设置 → 实验功能里的开关控制（`AppConfig.mcp_enabled`，默认关闭），
//!   `set_config` 落盘后调用 [`apply`] 即时启停（端口变化也会重启监听）。
//! - 协议只实现 MCP 的 `initialize` / `ping` / `tools/list` / `tools/call`，
//!   响应固定为 `application/json`（不带 SSE），足够单机 agent 使用。
//! - 需要前端状态的工具经 `mcp-rpc` 事件转发给**一个**目标窗口（见 [`resolve_window`]：
//!   显式 `window` 参数 → 当前聚焦窗口 → 最近聚焦窗口 → `main` → 首个窗口），
//!   前端处理后 `emit('mcp-rpc-response')` 回传（带自身 label，便于校验投递目标），
//!   本模块按 id 唤醒等待方。没有可用窗口时立即报错，不会白等 10s。
//!
//! 这不是最终形态：正式接入需要补 Origin/Token 强校验、SSE、resources 与插件能力桥接。

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Listener, Manager};

pub const DEFAULT_PORT: u16 = 38471;
/// 前端响应超时：窗口未加载/已关闭时不要把 HTTP 请求挂死。
const FRONTEND_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_HEAD_BYTES: usize = 64 * 1024;
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;

static NEXT_RPC_ID: AtomicU64 = AtomicU64::new(1);
/// 等待中的前端调用：id → (应答通道, 目标窗口 label)。
type PendingMap = HashMap<u64, (mpsc::Sender<Value>, String)>;
static PENDING: once_cell::sync::Lazy<Mutex<PendingMap>> =
    once_cell::sync::Lazy::new(|| Mutex::new(HashMap::new()));

/// 最近获得焦点的编辑器窗口 label（窗口失去焦点时仍能作为回退目标）。
static LAST_FOCUSED: once_cell::sync::Lazy<Mutex<Option<String>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

/// 记录最近获得焦点的编辑器窗口（由 lib.rs 的窗口事件调用）。
pub fn note_focused_window(label: &str) {
    if !crate::window_manager::is_editor_label(label) {
        return;
    }
    if let Ok(mut slot) = LAST_FOCUSED.lock() {
        *slot = Some(label.to_string());
    }
}

/// 运行中的服务实例。
struct Running {
    port: u16,
    stop: Arc<AtomicBool>,
    /// 服务线程句柄：停止时用来确认监听 socket 已经释放（否则同端口重开会撞上自己）。
    handle: Option<std::thread::JoinHandle<()>>,
}

/// 对外暴露的服务状态（设置页展示用）。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    pub url: String,
    pub error: Option<String>,
}

static SERVER: once_cell::sync::Lazy<Mutex<Option<Running>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));
static LAST_ERROR: once_cell::sync::Lazy<Mutex<Option<String>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));
static RESPONSE_LISTENER_READY: AtomicBool = AtomicBool::new(false);

/// 期望监听的端口：环境变量 > 设置（须 ≥1024）> 默认值。
pub fn desired_port(app: &AppHandle) -> u16 {
    if let Some(port) = std::env::var("TEXTO_MCP_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
    {
        return port;
    }
    let configured = crate::AppConfig::load(app).mcp_port;
    if configured >= 1024 {
        configured
    } else {
        DEFAULT_PORT
    }
}

pub fn url_for(port: u16) -> String {
    format!("http://127.0.0.1:{port}/mcp")
}

pub fn status(app: &AppHandle) -> McpStatus {
    let running_port = SERVER.lock().ok().and_then(|guard| guard.as_ref().map(|running| running.port));
    let port = running_port.unwrap_or_else(|| desired_port(app));
    McpStatus {
        enabled: crate::AppConfig::load(app).mcp_enabled,
        running: running_port.is_some(),
        port,
        url: url_for(port),
        error: LAST_ERROR.lock().ok().and_then(|guard| guard.clone()),
    }
}

/// 按配置启停服务（幂等；端口变了会重启监听；失败原因记录在状态里）。
pub fn apply(app: &AppHandle, enabled: bool) {
    if !enabled {
        stop();
        return;
    }
    let desired = desired_port(app);
    let current = SERVER.lock().ok().and_then(|guard| guard.as_ref().map(|running| running.port));
    if current == Some(desired) {
        return;
    }
    if current.is_some() {
        stop();
    }
    start(app, desired);
}

fn start(app: &AppHandle, port: u16) {
    let Ok(mut guard) = SERVER.lock() else {
        return;
    };
    if guard.is_some() {
        return;
    }

    // 关闭后旧线程最多再跑一个轮询周期（80ms）才释放端口；这里短暂重试，
    // 避免「关掉马上再打开」因为 AddrInUse 直接失败。
    let mut bound = None;
    for attempt in 0..20 {
        match TcpListener::bind(("127.0.0.1", port)) {
            Ok(listener) => {
                bound = Some(listener);
                break;
            }
            Err(err) if attempt < 19 => {
                log::debug!("[mcp] bind retry {attempt}: {err}");
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(err) => {
                let message = format!("端口 {port} 被占用：{err}");
                log::warn!("[mcp] failed to bind 127.0.0.1:{port}: {err}");
                if let Ok(mut slot) = LAST_ERROR.lock() {
                    *slot = Some(message);
                }
                return;
            }
        }
    }
    let Some(listener) = bound else {
        return;
    };
    if let Err(err) = listener.set_nonblocking(true) {
        log::warn!("[mcp] failed to set nonblocking: {err}");
        if let Ok(mut slot) = LAST_ERROR.lock() {
            *slot = Some(format!("无法切换非阻塞模式：{err}"));
        }
        return;
    }

    ensure_response_listener(app);

    let stop = Arc::new(AtomicBool::new(false));
    let server_app = app.clone();
    let server_stop = stop.clone();
    let spawned = std::thread::Builder::new()
        .name("textox-mcp".into())
        .spawn(move || serve(server_app, listener, server_stop));
    match spawned {
        Ok(handle) => {
            log::info!("[mcp] listening on {}", url_for(port));
            if let Ok(mut slot) = LAST_ERROR.lock() {
                *slot = None;
            }
            *guard = Some(Running {
                port,
                stop,
                handle: Some(handle),
            });
        }
        Err(err) => {
            log::warn!("[mcp] failed to spawn server thread: {err}");
            if let Ok(mut slot) = LAST_ERROR.lock() {
                *slot = Some(format!("无法启动服务线程：{err}"));
            }
        }
    }
}

fn stop() {
    let running = SERVER.lock().ok().and_then(|mut guard| guard.take());
    let Some(running) = running else {
        // 没有在跑也要把上次的绑定错误清掉，避免状态里残留过期原因。
        if let Ok(mut slot) = LAST_ERROR.lock() {
            *slot = None;
        }
        return;
    };
    running.stop.store(true, Ordering::Relaxed);
    log::info!("[mcp] stopping server on port {}", running.port);
    if let Ok(mut slot) = LAST_ERROR.lock() {
        *slot = None;
    }
    let Some(handle) = running.handle else {
        return;
    };
    // 轮询周期 80ms，正常情况很快退出；在请求处理中则可能更久，
    // 此时交给后台 join，不阻塞设置页的调用方。
    let deadline = Instant::now() + Duration::from_millis(300);
    while !handle.is_finished() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    if handle.is_finished() {
        let _ = handle.join();
    } else {
        std::thread::spawn(move || {
            let _ = handle.join();
        });
    }
}

/// `mcp-rpc-response` 是全局事件，只注册一次；重复注册会拿到同一份响应多次。
fn ensure_response_listener(app: &AppHandle) {
    if RESPONSE_LISTENER_READY.swap(true, Ordering::SeqCst) {
        return;
    }
    let response_app = app.clone();
    response_app.listen("mcp-rpc-response", |event| {
        let Ok(payload) = serde_json::from_str::<Value>(event.payload()) else {
            return;
        };
        let Some(id) = payload.get("id").and_then(Value::as_u64) else {
            return;
        };
        // 先核对来源窗口再取走通道：多窗口下别的窗口可能回同一个 id，
        // 提前 remove 会让真正的应答无处可投（表现为「桥接通道已断开」）。
        let sender = PENDING.lock().ok().and_then(|mut map| {
            let target = map.get(&id).map(|(_, target)| target.clone())?;
            if let Some(from) = payload.get("window").and_then(Value::as_str) {
                if from != target {
                    log::debug!("[mcp] 丢弃来自 {from} 的应答（目标 {target}）");
                    return None;
                }
            }
            map.remove(&id)
        });
        if let Some((sender, _)) = sender {
            let _ = sender.send(payload);
        }
    });
}

fn serve(app: AppHandle, listener: TcpListener, stop: Arc<AtomicBool>) {
    while !stop.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, _)) => {
                // accept 出来的流不一定继承非阻塞标志，显式设回阻塞 + 读超时。
                let _ = stream.set_nonblocking(false);
                if let Err(err) = handle(&app, stream) {
                    log::debug!("[mcp] request failed: {err}");
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(80));
            }
            Err(err) => {
                log::debug!("[mcp] accept failed: {err}");
                break;
            }
        }
    }
    log::info!("[mcp] server stopped");
}

struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn handle(app: &AppHandle, mut stream: TcpStream) -> std::io::Result<()> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
    let Some(request) = read_request(&mut stream)? else {
        return Ok(());
    };

    // 本地回环服务仍需防 DNS rebinding：浏览器发起的跨站请求一定带 Origin。
    if let Some(origin) = request.headers.get("origin") {
        if !is_local_origin(origin) {
            log::warn!("[mcp] rejected origin: {origin}");
            return respond(&mut stream, "403 Forbidden", br#"{"error":"origin not allowed"}"#);
        }
    }
    match request.headers.get("host") {
        Some(host) if is_local_host(host) => {}
        Some(host) => {
            log::warn!("[mcp] rejected host: {host}");
            return respond(&mut stream, "403 Forbidden", br#"{"error":"host not allowed"}"#);
        }
        None => {
            return respond(&mut stream, "400 Bad Request", br#"{"error":"missing host header"}"#);
        }
    }

    if let Some(expected) = std::env::var("TEXTO_MCP_TOKEN").ok().filter(|t| !t.is_empty()) {
        let provided = request
            .headers
            .get("authorization")
            .map(String::as_str)
            .unwrap_or_default();
        if provided != format!("Bearer {expected}") {
            return respond(&mut stream, "401 Unauthorized", br#"{"error":"unauthorized"}"#);
        }
    }

    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/health") => respond(&mut stream, "200 OK", br#"{"ok":true}"#),
        ("POST", "/mcp") => {
            let content_type = request
                .headers
                .get("content-type")
                .map(String::as_str)
                .unwrap_or_default();
            if !is_json_content_type(content_type) {
                log::warn!("[mcp] rejected content-type: {content_type}");
                return respond(
                    &mut stream,
                    "415 Unsupported Media Type",
                    br#"{"error":"content-type must be application/json"}"#,
                );
            }
            let payload: Value = match serde_json::from_slice(&request.body) {
                Ok(payload) => payload,
                Err(err) => {
                    let body = json!({
                        "jsonrpc": "2.0",
                        "id": Value::Null,
                        "error": { "code": -32700, "message": format!("parse error: {err}") }
                    });
                    return respond(&mut stream, "400 Bad Request", body.to_string().as_bytes());
                }
            };

            match dispatch(app, &payload) {
                Some(response) => {
                    let body = response.to_string();
                    respond(&mut stream, "200 OK", body.as_bytes())
                }
                // 通知（无 id）按规范回 202，无响应体。
                None => respond(&mut stream, "202 Accepted", b""),
            }
        }
        ("GET", "/mcp") => respond(&mut stream, "405 Method Not Allowed", br#"{"error":"SSE not supported"}"#),
        ("DELETE", "/mcp") => respond(&mut stream, "405 Method Not Allowed", br#"{"error":"no session"}"#),
        _ => respond(&mut stream, "404 Not Found", br#"{"error":"not found"}"#),
    }
}

/// 只允许回环 origin：必须**精确**匹配 host，不能用前缀
/// （否则 `http://localhost.evil.com` 会通过）。
fn is_local_origin(origin: &str) -> bool {
    let origin = origin.trim().to_ascii_lowercase();
    let Some((scheme, rest)) = origin.split_once("://") else {
        return false;
    };
    match scheme {
        // Tauri 在 Windows / Linux 上的自定义协议源；macOS 为 tauri://localhost。
        "tauri" => matches!(rest.split('/').next().unwrap_or_default(), "localhost" | "tauri.localhost"),
        "http" | "https" => {
            let authority = rest.split('/').next().unwrap_or_default();
            matches!(
                host_of(authority).as_str(),
                "127.0.0.1" | "localhost" | "::1"
            )
        }
        _ => false,
    }
}

/// 从 `host[:port]` / `[::1]:port` 里取出 host（小写）。
fn host_of(authority: &str) -> String {
    let authority = authority.trim().to_ascii_lowercase();
    if let Some(rest) = authority.strip_prefix('[') {
        return rest.split(']').next().unwrap_or_default().to_string();
    }
    authority.split(':').next().unwrap_or_default().to_string()
}

/// `Host` 头同样只允许回环：防 DNS rebinding 把 attacker.com 指到 127.0.0.1。
fn is_local_host(host: &str) -> bool {
    matches!(host_of(host).as_str(), "127.0.0.1" | "localhost" | "::1")
}

/// POST 必须声明 JSON：挡住浏览器用 `text/plain` 发「简单请求」绕过预检。
fn is_json_content_type(value: &str) -> bool {
    value
        .split(';')
        .next()
        .map(|mime| mime.trim().eq_ignore_ascii_case("application/json"))
        .unwrap_or(false)
}

fn read_request(stream: &mut TcpStream) -> std::io::Result<Option<Request>> {
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];

    let head_end = loop {
        if let Some(position) = find_double_crlf(&buffer) {
            break position;
        }
        if buffer.len() > MAX_HEAD_BYTES {
            return Ok(None);
        }
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Ok(None);
        }
        buffer.extend_from_slice(&chunk[..read]);
    };

    let head = String::from_utf8_lossy(&buffer[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > MAX_BODY_BYTES {
        return Ok(None);
    }

    let mut body = buffer[head_end + 4..].to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(content_length);

    Ok(Some(Request {
        method,
        path,
        headers,
        body,
    }))
}

fn find_double_crlf(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn respond(stream: &mut TcpStream, status: &str, body: &[u8]) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

fn dispatch(app: &AppHandle, request: &Value) -> Option<Value> {
    let method = request.get("method").and_then(Value::as_str).unwrap_or_default();
    let id = request.get("id").cloned().filter(|value| !value.is_null());
    // 通知（notifications/initialized 等）不需要响应。
    let id = id?;
    let params = request.get("params").cloned().unwrap_or(Value::Null);

    let outcome = match method {
        "initialize" => Ok(initialize_result(params)),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_definitions() })),
        "tools/call" => Ok(call_tool(app, &params)),
        other => Err((-32601, format!("method not found: {other}"))),
    };

    Some(match outcome {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message }
        }),
    })
}

fn initialize_result(params: Value) -> Value {
    let protocol_version = params
        .get("protocolVersion")
        .and_then(Value::as_str)
        .unwrap_or("2025-06-18");

    json!({
        "protocolVersion": protocol_version,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": {
            "name": "textox",
            "version": env!("CARGO_PKG_VERSION"),
        },
        "instructions": "Textox 是一个 Markdown 编辑器。你可以用 textox_get_active_document 读取用户当前正在编辑的文档（含光标行列），用 textox_set_selection 移动光标或选中文本，用 textox_insert_text 在光标处插入（可在 params 里直接给 line/column；默认逐字呈现，stream:false 为整段插入），用 textox_replace_document 整篇替换 Markdown（一次性写入，不逐字），用 textox_open_document 打开文件，用 textox_list_recent_documents 查看最近打开且仍有书签的文件，用 textox_create_entry 在当前工作区新建文件/文件夹。写操作会立即反映到用户界面上，但不会自动保存。逐字插入期间编辑器会锁住人工输入并显示「AI 正在输入」提示。行列口径：line 从 1 开始，column 从 1 开始。多窗口时默认作用于当前聚焦窗口，可用 window 参数指定目标窗口（标签见 textox_app_info 的 windows）。"
    })
}

fn tool_definitions() -> Value {
    json!([
        {
            "name": "textox_app_info",
            "description": "返回 Textox 应用信息（版本、edition、编辑器窗口列表，以及默认会作用于哪个窗口 activeWindow）。",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "textox_get_active_document",
            "description": "读取目标窗口（默认当前聚焦窗口）当前正在编辑的文档：路径、Markdown 全文、是否未保存、当前模式、选区（start/end，行列均从 1 起）、当前工作区根目录，以及实际读取的窗口 label。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "window": { "type": "string", "description": "可选：目标窗口 label（不传则用当前聚焦窗口）" }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "textox_set_selection",
            "description": "移动目标窗口（默认当前聚焦窗口）的光标（或选中一段文本）。行列口径：line/column 均从 1 开始，column 是行内第几个字符，行尾为「该行字符数 + 1」。只给 start 时折叠为光标。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "start": {
                        "type": "object",
                        "description": "起点",
                        "properties": {
                            "line": { "type": "integer", "description": "行号，从 1 开始" },
                            "column": { "type": "integer", "description": "列号，从 1 开始" }
                        },
                        "required": ["line", "column"],
                        "additionalProperties": false
                    },
                    "end": {
                        "type": "object",
                        "description": "终点（不传则把光标折叠到 start）",
                        "properties": {
                            "line": { "type": "integer", "description": "行号，从 1 开始" },
                            "column": { "type": "integer", "description": "列号，从 1 开始" }
                        },
                        "required": ["line", "column"],
                        "additionalProperties": false
                    },
                    "window": { "type": "string", "description": "可选：目标窗口 label（不传则用当前聚焦窗口）" }
                },
                "required": ["start"],
                "additionalProperties": false
            }
        },
        {
            "name": "textox_insert_text",
            "description": "把一段文本插入到 Textox 当前文档（不自动保存）。默认按打字机节奏逐字呈现：期间编辑器会锁住人工输入并显示「AI 正在输入」提示，适合需要让用户看到写入过程的场景；传 stream:false 则整段一次性插入。不传 line/column 时插入到当前光标处（替换当前选区）；传了就先把光标移到该位置再插入。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string", "description": "要插入的 Markdown 文本" },
                    "line": { "type": "integer", "description": "可选：插入位置行号，从 1 开始" },
                    "column": { "type": "integer", "description": "可选：插入位置列号，从 1 开始" },
                    "stream": { "type": "boolean", "description": "是否逐字呈现（默认 true）；false 为整段一次性插入" },
                    "window": { "type": "string", "description": "可选：目标窗口 label（不传则用当前聚焦窗口）" }
                },
                "required": ["text"],
                "additionalProperties": false
            }
        },
        {
            "name": "textox_replace_document",
            "description": "用给定的 Markdown 整篇替换目标窗口（默认当前聚焦窗口）的当前文档（按一次普通编辑处理：用户可撤销，会自动标记为未保存，不会自动保存到磁盘）。整篇替换是一次性写入，不走打字机逐字效果；需要用户看到写入过程请用 textox_insert_text。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "markdown": { "type": "string", "description": "新的 Markdown 全文" },
                    "window": { "type": "string", "description": "可选：目标窗口 label（不传则用当前聚焦窗口）" }
                },
                "required": ["markdown"],
                "additionalProperties": false
            }
        },
        {
            "name": "textox_list_recent_documents",
            "description": "列出 Textox 最近打开的文档（最多 5 个），并标注每一项当前是否仍有有效书签（macOS 沙箱下书签是再次打开的前提）、目标是否还存在、以及书签解析后的真实路径。",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "textox_create_entry",
            "description": "在目标窗口（默认当前聚焦窗口）打开的工作区（文件夹）里新建文件或文件夹。path 可写绝对路径，也可写相对工作区根目录的相对路径；不允许写到工作区之外。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "相对工作区根的路径或绝对路径，例如 notes/todo.md" },
                    "kind": { "type": "string", "enum": ["file", "folder"], "description": "默认 file" },
                    "content": { "type": "string", "description": "可选：新建文件时的初始内容" },
                    "open": { "type": "boolean", "description": "可选：新建文件后是否立即在目标窗口打开，默认 false" },
                    "window": { "type": "string", "description": "可选：目标窗口 label（不传则用当前聚焦窗口）" }
                },
                "required": ["path"],
                "additionalProperties": false
            }
        },
        {
            "name": "textox_open_document",
            "description": "在目标窗口（默认当前聚焦窗口）中打开指定路径的 Markdown 文件。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "绝对路径" },
                    "window": { "type": "string", "description": "可选：目标窗口 label（不传则用当前聚焦窗口）" }
                },
                "required": ["path"],
                "additionalProperties": false
            }
        }
    ])
}

fn call_tool(app: &AppHandle, params: &Value) -> Value {
    let name = params.get("name").and_then(Value::as_str).unwrap_or_default();
    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    let requested_window = args.get("window").and_then(Value::as_str);

    let outcome: Result<String, String> = (|| -> Result<String, String> {
        match name {
            "textox_app_info" => Ok(app_info(app)),
            "textox_list_recent_documents" => list_recent_documents(app),
            "textox_get_active_document" => {
                let window = resolve_window(app, requested_window)?;
                rpc_frontend(app, &window, "activeDocument", json!({}))
            }
            "textox_insert_text" => {
                let window = resolve_window(app, requested_window)?;
                insert_text(app, &window, &args)
            }
            "textox_set_selection" => {
                let window = resolve_window(app, requested_window)?;
                set_selection(app, &window, &args)
            }
            "textox_replace_document" => {
                let window = resolve_window(app, requested_window)?;
                let markdown = args
                    .get("markdown")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "缺少参数 markdown".to_string())?;
                rpc_frontend(app, &window, "replaceDocument", json!({ "markdown": markdown }))
            }
            "textox_create_entry" => {
                let window = resolve_window(app, requested_window)?;
                rpc_frontend(
                    app,
                    &window,
                    "createEntry",
                    json!({
                        "kind": args.get("kind").and_then(Value::as_str).unwrap_or("file"),
                        "path": args.get("path").cloned().unwrap_or(Value::Null),
                        "content": args.get("content").cloned().unwrap_or(Value::Null),
                        "open": args.get("open").and_then(Value::as_bool).unwrap_or(false),
                    }),
                )
            }
            "textox_open_document" => {
                let window = resolve_window(app, requested_window)?;
                let path = args
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "缺少参数 path".to_string())?;
                open_document(app, &window, path)
            }
            other => Err(format!("unknown tool: {other}")),
        }
    })();

    match outcome {
        Ok(text) => json!({
            "content": [{ "type": "text", "text": text }],
            "isError": false
        }),
        Err(text) => json!({
            "content": [{ "type": "text", "text": text }],
            "isError": true
        }),
    }
}

/// 编辑器窗口的稳定排序键：`main` 最前，其余按 `window-N` 的数字序
/// （避免字符串序把 `window-10` 排到 `window-2` 前面）。
fn window_order(label: &str) -> (u8, u64, &str) {
    if label == "main" {
        return (0, 0, label);
    }
    let index = label
        .strip_prefix("window-")
        .and_then(|rest| rest.parse::<u64>().ok())
        .unwrap_or(u64::MAX);
    (1, index, label)
}

/// 当前能承接 MCP 请求的编辑器窗口（`main` / `window-*`，排除设置等非编辑器窗口）。
fn editor_windows(app: &AppHandle) -> Vec<(String, bool)> {
    let mut windows: Vec<(String, bool)> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| crate::window_manager::is_editor_label(label))
        .map(|(label, window)| {
            let focused = window.is_focused().unwrap_or(false);
            (label, focused)
        })
        .collect();
    windows.sort_by(|a, b| window_order(&a.0).cmp(&window_order(&b.0)));
    windows
}

fn available_windows_text(windows: &[(String, bool)]) -> String {
    if windows.is_empty() {
        return "无".to_string();
    }
    windows
        .iter()
        .map(|(label, _)| label.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

/// 决定这次请求投递给哪个窗口。
///
/// 顺序：显式 `window` 参数 → 当前聚焦窗口 → 最近聚焦窗口 → `main` → 首个窗口。
/// 一个可用窗口都没有时立即报错，而不是让调用方白等 10s 超时。
pub(crate) fn resolve_window(app: &AppHandle, requested: Option<&str>) -> Result<String, String> {
    let windows = editor_windows(app);
    if let Some(requested) = requested.map(str::trim).filter(|label| !label.is_empty()) {
        if windows.iter().any(|(label, _)| label == requested) {
            return Ok(requested.to_string());
        }
        return Err(format!(
            "窗口 {requested} 不存在（当前可用的编辑器窗口：{}）",
            available_windows_text(&windows)
        ));
    }
    if windows.is_empty() {
        return Err(
            "没有已打开的编辑器窗口：请先在 Textox 中新建或打开一个窗口，再让 agent 继续。"
                .to_string(),
        );
    }
    if let Some((label, _)) = windows.iter().find(|(_, focused)| *focused) {
        return Ok(label.clone());
    }
    if let Some(label) = LAST_FOCUSED.lock().ok().and_then(|slot| slot.clone()) {
        if windows.iter().any(|(candidate, _)| *candidate == label) {
            return Ok(label);
        }
    }
    Ok(windows[0].0.clone())
}

/// 把实际命中的窗口 label 合进工具返回值，方便调用方断言「写到了哪个窗口」。
fn attach_window(value: Value, window: &str) -> Value {
    match value {
        Value::Object(mut map) => {
            map.insert("window".to_string(), json!(window));
            Value::Object(map)
        }
        Value::Null => json!({ "window": window }),
        other => json!({ "window": window, "result": other }),
    }
}


fn app_info(app: &AppHandle) -> String {
    let edition = if cfg!(feature = "free-version") { "lite" } else { "full" };
    let windows: Vec<String> = editor_windows(app).into_iter().map(|(label, _)| label).collect();
    // 默认目标窗口：没有窗口时为 null，调用方可以据此判断后续写入会失败。
    let active_window = resolve_window(app, None).ok();
    let info = json!({
        "name": "Textox",
        "version": app.package_info().version.to_string(),
        "edition": edition,
        "windows": windows,
        "activeWindow": active_window,
    });
    serde_json::to_string_pretty(&info).unwrap_or_else(|_| info.to_string())
}

fn insert_text(app: &AppHandle, window: &str, args: &Value) -> Result<String, String> {
    let text = args
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| "缺少参数 text".to_string())?;
    let mut params = json!({ "text": text });
    // 行列必须成对出现，否则按「当前光标处插入」处理。
    if let (Some(line), Some(column)) = (
        args.get("line").and_then(Value::as_i64),
        args.get("column").and_then(Value::as_i64),
    ) {
        params["line"] = json!(line);
        params["column"] = json!(column);
    }
    if let Some(stream) = args.get("stream").and_then(Value::as_bool) {
        params["stream"] = json!(stream);
    }
    rpc_frontend(app, window, "insertText", params)
}

fn set_selection(app: &AppHandle, window: &str, args: &Value) -> Result<String, String> {
    let start = args
        .get("start")
        .cloned()
        .filter(Value::is_object)
        .ok_or_else(|| "缺少参数 start".to_string())?;
    let mut params = json!({ "start": start });
    if let Some(end) = args.get("end").filter(|value| value.is_object()) {
        params["end"] = end.clone();
    }
    rpc_frontend(app, window, "setSelection", params)
}

/// 最近打开列表 + 书签状态：沙箱版里「有有效书签」才是可以再次直接打开的前提。
fn list_recent_documents(app: &AppHandle) -> Result<String, String> {
    let items = crate::RecentFilesStore::load(app);
    let bookmarks: HashMap<String, crate::bookmark_manager::BookmarkInfo> = app
        .try_state::<crate::bookmark_manager::BookmarkManager>()
        .map(|manager| {
            manager
                .list()
                .into_iter()
                .map(|info| (info.path.clone(), info))
                .collect()
        })
        .unwrap_or_default();

    let documents: Vec<Value> = items
        .iter()
        .map(|item| {
            let bookmark = bookmarks.get(item);
            let resolved = bookmark.and_then(|info| info.resolved_path.clone());
            let open_path = resolved.clone().unwrap_or_else(|| item.clone());
            let path = Path::new(&open_path);
            let exists = path.exists();
            let kind = bookmark
                .map(|info| info.kind.clone())
                .unwrap_or_else(|| {
                    if path.is_dir() {
                        "directory".to_string()
                    } else {
                        "file".to_string()
                    }
                });
            json!({
                "path": item,
                "name": path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default(),
                "kind": kind,
                "exists": exists,
                "bookmarked": bookmark.is_some(),
                "bookmarkValid": bookmark.map(|info| info.valid).unwrap_or(false),
                "resolvedPath": resolved,
                "openPath": open_path,
            })
        })
        .collect();

    Ok(serde_json::to_string_pretty(&json!({ "documents": documents })).unwrap_or_default())
}

fn open_document(app: &AppHandle, window: &str, path: &str) -> Result<String, String> {
    let path = Path::new(path);
    if !path.exists() {
        return Err(format!("文件不存在: {}", path.display()));
    }
    let target = path.to_string_lossy().to_string();
    // 沙箱版必须先把书签解析成安全作用域访问，否则打开会失败（无书签时静默继续）。
    if let Some(manager) = app.try_state::<crate::bookmark_manager::BookmarkManager>() {
        if let Err(err) = manager.start_access(&target) {
            log::debug!("[mcp] start_access failed for {target}: {err}");
        }
    }
    // 先确认窗口还在（emit_to 对不存在的 label 是静默丢弃），再定向投递。
    if app.get_webview_window(window).is_none() {
        return Err(format!("窗口 {window} 已关闭（可能在请求发出前刚被关闭）"));
    }
    // 带上 target：Tauri 的 JS 监听默认收全量事件，其他窗口要自行忽略。
    app.emit_to(window, "open-file", json!({ "path": target, "target": window }))
        .map_err(|err| format!("通知窗口 {window} 失败: {err}"))?;
    Ok(serde_json::to_string_pretty(&json!({
        "window": window,
        "path": target,
        "opened": true,
    }))
    .unwrap_or_default())
}

/// 请求指定窗口的前端执行一个动作并等待结果（只投递给一个窗口，不再广播）。
fn rpc_frontend(
    app: &AppHandle,
    window: &str,
    method: &str,
    params: Value,
) -> Result<String, String> {
    let id = NEXT_RPC_ID.fetch_add(1, Ordering::SeqCst);
    let (sender, receiver) = mpsc::channel();
    {
        let mut pending = PENDING.lock().map_err(|_| "MCP 桥接锁被污染".to_string())?;
        pending.insert(id, (sender, window.to_string()));
    }

    let payload = json!({ "id": id, "method": method, "params": params, "target": window });
    // 用窗口自己的 emit：目标窗口刚被关掉时会立刻失败，而不是静默丢弃后等满超时。
    let sent = app
        .get_webview_window(window)
        .ok_or_else(|| format!("窗口 {window} 已关闭（可能在请求发出前刚被关闭）"))
        .and_then(|_| {
            // 注意：`WebviewWindow::emit` 是广播（走 manager().emit），必须用带 label 的 emit_to。
            app.emit_to(window, "mcp-rpc", payload)
                .map_err(|err| format!("无法向窗口 {window} 发送请求: {err}"))
        });
    if let Err(err) = sent {
        if let Ok(mut pending) = PENDING.lock() {
            pending.remove(&id);
        }
        return Err(err);
    }

    let deadline = Instant::now() + FRONTEND_TIMEOUT;
    let result = loop {
        let now = Instant::now();
        if now >= deadline {
            break Err(format!(
                "窗口 {window} 在 {} 秒内没有响应：它可能正在加载或刷新，或者已不再承载编辑器。",
                FRONTEND_TIMEOUT.as_secs()
            ));
        }
        match receiver.recv_timeout(deadline - now) {
            Ok(payload) => {
                // 多窗口下只认目标窗口的应答（前端会带上自身 label）。
                if let Some(from) = payload.get("window").and_then(Value::as_str) {
                    if from != window {
                        log::warn!("[mcp] 忽略来自 {from} 的应答（目标窗口 {window}）");
                        continue;
                    }
                }
                if payload.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                    let value = payload.get("result").cloned().unwrap_or(Value::Null);
                    break Ok(serde_json::to_string_pretty(&attach_window(value, window))
                        .unwrap_or_default());
                }
                break Err(payload
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("前端执行失败")
                    .to_string());
            }
            Err(RecvTimeoutError::Timeout) => {
                break Err(format!(
                    "窗口 {window} 在 {} 秒内没有响应：它可能正在加载或刷新，或者已不再承载编辑器。",
                    FRONTEND_TIMEOUT.as_secs()
                ))
            }
            Err(RecvTimeoutError::Disconnected) => break Err("MCP 桥接通道已断开".to_string()),
        }
    };
    if let Ok(mut pending) = PENDING.lock() {
        pending.remove(&id);
    }
    result
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_order_prefers_main_then_numeric() {
        let mut labels = vec!["window-10", "window-2", "main", "settings"];
        labels.sort_by(|a, b| window_order(a).cmp(&window_order(b)));
        assert_eq!(labels, vec!["main", "window-2", "window-10", "settings"]);
    }

    #[test]
    fn local_origin_requires_exact_host() {
        for ok in [
            "http://127.0.0.1:38471",
            "http://localhost:38471",
            "http://[::1]:38471",
            "tauri://localhost",
        ] {
            assert!(is_local_origin(ok), "should allow {ok}");
        }
        for bad in [
            "http://localhost.evil.com",
            "http://127.0.0.1.evil.com",
            "https://evil.com",
            "http://192.168.1.10:38471",
            "tauri://localhost.evil.com",
            "null",
        ] {
            assert!(!is_local_origin(bad), "should reject {bad}");
        }
    }

    #[test]
    fn local_host_and_json_content_type() {
        assert!(is_local_host("127.0.0.1:38471"));
        assert!(is_local_host("localhost:38471"));
        assert!(is_local_host("[::1]:38471"));
        assert!(!is_local_host("localhost.evil.com:38471"));
        assert!(is_json_content_type("application/json; charset=utf-8"));
        assert!(is_json_content_type("Application/JSON"));
        assert!(!is_json_content_type("text/plain"));
        assert!(!is_json_content_type(""));
    }

    #[test]
    fn attach_window_merges_into_objects() {
        assert_eq!(
            attach_window(json!({ "inserted": 3 }), "window-2"),
            json!({ "inserted": 3, "window": "window-2" })
        );
        assert_eq!(attach_window(Value::Null, "main"), json!({ "window": "main" }));
        assert_eq!(
            attach_window(json!(true), "main"),
            json!({ "window": "main", "result": true })
        );
    }
}
