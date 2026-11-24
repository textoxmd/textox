# Textox – Agent Instructions

## Quick start

```sh
bun install                    # install frontend deps
cd src-tauri && cargo fetch    # install Rust deps
bun run dev                    # Vite dev server only (browser: localhost:1420)
bun run app:dev                # full Tauri desktop dev (make dev)
```

> `vendor/excalidraw` 是 `textoxmd/excalidraw` 仓库 `textox-0.18.1` 分支的 git submodule（`@excalidraw/*` 均来自该 fork，见 package.json 的 file: 依赖与 overrides）。`vendor/translations` 是 `textoxmd/translations` 仓库的 git submodule（i18n 源文件）。新 clone 后先执行 `git submodule update --init`。
>
> fork 变更流程（excalidraw）：在 `vendor/excalidraw` 内修改 → 重建 dist（`cd packages/* && bun install && node ../../scripts/build*.js && tsc`）→ 提交 `textox-0.18.1` 分支 → 更新 submodule 指针。
>
> i18n 变更流程（translations）：在 `vendor/translations/sources/*/*.yaml` 内修改 → `cd vendor/translations && bun run build` → 提交 `main` 分支 → 更新 submodule 指针 → 在 textox 根目录运行 `bun run i18n:build` 同步 `src/i18n/locales/*.json`。

**Package manager is Bun.** Do not use npm/pnpm/yarn.

## Key commands

| Command | Action |
|---------|--------|
| `bun run build` | `bun run typecheck && vite build`（prebuild 会先跑 i18n） |
| `bun run test:plugins` | 插件/骨架契约单测（`vitest.config.ts`） |
| `bun run check:skeleton` | 硬规则：`src/` 生产代码不得出现插件专属字面量 |
| `bun run check:editor-boundary` | 硬规则：编辑器不得 import 骨架 |
| `bun run check:version` | 校验 `tauri.conf.json` / `Cargo.toml` / `package.json` 版本一致 |
| `bun run i18n:build` | YAML → JSON (edit YAML in `vendor/translations/sources/*/*.yaml`) |
| `bun run app:dev` / `app:build` | Tauri 开发 / 构建（`-- --edition lite` 切 Lite；build 只出应用本体） |
| `bun run app:package` | 打包（默认直接安装：macOS DMG / Windows MSI+NSIS；`-- --store`：macOS PKG / Windows MSIX） |
| `make check` | `check-ts` + `check-rust` |
| `make check-ts` | `bun run typecheck` + 骨架/边界/版本号 |
| `make check-rust` | `cargo check` + `cargo clippy -- -D warnings` |
| `make lint` | `cargo fmt -- --check` (Rust only, no frontend linter) |

Note: `scripts/build/frontend.mjs` runs automatically before `dev`/`build` via `beforeDevCommand`/`beforeBuildCommand` in the Tauri configs（同步图标 + 设置 edition 环境变量）。Icons in `src-tauri/icons/` are build artifacts (gitignored). Windows 的免费版与付费版都提供完整功能（不设 `VITE_FREE_VERSION`、不传 `free-version`），仅 identifier 不同。

## Testing

```sh
# All TextoEditor tests (spec-based WYSIWYG behavior tests):
npx vitest run --config src/components/TextoEditor/vitest.config.ts

# Focused test:
npx vitest run --config src/components/TextoEditor/vitest.config.ts tests/features/list.test.ts
```

- Test framework: **Vitest** v3 with **happy-dom** (not jsdom)
- Tests live in `src/components/TextoEditor/tests/`
- **No `bun run test` shortcut** — always use the full vitest command with `--config`
- 37+ spec-based test files covering each Markdown feature (parse + roundtrip)

## Project structure

- `src/` – React frontend (Vite + TS, path alias `@/` → `./src/`)
- `src-tauri/` – Rust backend (Tauri v2), version 2.2.0, identifier `com.texto.markdown`
- `src/components/TextoEditor/` – WYSIWYG ProseMirror editor (own tsconfig + vitest config)
- `src/components/styles/` – Theme system (CSS variables, multi-theme)
- `vendor/translations/sources/*/*.yaml` – i18n source submodule (modular YAML, **do not edit JSON directly**)
- `scripts/build/` – 统一构建入口（`cli.mjs`：dev/build/package；`macos.mjs`、`windows.mjs`、`frontend.mjs`、`icons.mjs`）
- `scripts/check/` – 类型检查、骨架/编辑器边界、Vite 缓存、版本号一致性
- `scripts/i18n/` – 翻译构建
- `openspec/` – OpenSpec change management (schema in `openspec/schemas/texto/schema.yaml`)

## Editor architecture

**Three rendering modes:**
- **IR mode (WYSIWYG)** — ProseMirror-based, real-time rendered Markdown
- **SV mode (Source View)** — CodeMirror-based plain-text editing
- **Preview/Export** — markdown-it rendering pipeline

Editor stack: ProseMirror (core), CodeMirror (source view / code block node views), markdown-it (export).

- 双模式编辑器（`TextoEditor` 的 `editorMode`）由编辑器自己持有 IR/SV 两个视图与统一历史 `EditorDocumentSession`；撤销/重做走会话，保存点用 `beginSavePoint`/`confirmSavePoint`/`markSaved`，每步记录 markdown 增量补丁。SV 的代码块语言高亮经 `EditorHost.loadCodeLanguageSupport` 异步注入（骨架动态 import，避免 CodeMirror 进入启动包），源码主题从 `#writer` 的 CSS 变量读取。原生 Edit 菜单的 Undo/Redo 是自定义菜单项，经 `menu-event` 分发，不再使用 `PredefinedMenuItem::undo/redo`。编辑器始终整篇渲染（无分块窗口），保存点内容即全文。

## 插件运行时 v1（外置插件，与旧体系并存）

- 契约包 `vendor/plugin-sdk`（git submodule，包名 `@textox/plugin-sdk`）：`Plugin` 基类（`onload` / `onunload` / `addCommand` / `dispose`）、`validateManifest`、`SHARED_MODULES`（宿主通过 import map 提供的裸模块白名单）。与旧 `@texto/plugin-sdk` 的 `definePlugin` 无关。
- 构建工具 `packages/plugin-build`：`bun run plugin build|pack|dev <pluginDir>`，读 `plugin.config.ts`，产物 `<pluginDir>/dist/{main.js, manifest.json, styles.css}`。**单文件 bundle**：`inlineDynamicImports` 保证动态 import 被内联（运行时用 blob URL 载入 `main.js`），构建后会用 `assertSingleJsFile` 兜底。
- 运行时 `src/plugins/runtime/`：`index.ts` 是启动链与 `enablePlugin` / `disablePlugin`（含 safe-mode 守卫），`app.ts` 实现 `PluginApp`（settings / i18n / toast / log / workspace / editor），`sharedModulesPlugin.ts` 在构建期把共享入口注入 import map。
- 第一方语法插件已全部外置：旧 `official-plugins/` 目录为空，历史实现保留在 `test-fixtures/plugins/`（只供编辑器整合测试，不进生产包）。生产插件一律来自运行时扫描，示例见 `plugin-samples/`。导入新运行时必须写 `@/plugins/runtime/index`（仓库有旧文件 `src/plugins/runtime.ts`，文件优先于目录）。
- 安全模式默认开启：只自动加载 `app.textox.*`，第三方由用户手动启用（`enablePlugin` 会拦截并抛错）。设置 → 插件顶部显示安全模式横幅，关闭需二次确认；开启时列表行与详情页的第三方启用开关都置灰。
- 插件管理 UI（设置 → 插件）是 Obsidian 式的「已安装列表 + 详情页」两态：列表支持搜索（id / 名称 / 描述）与「全部 / 出厂 / 本地」筛选，点行进入详情；详情里放设置项与来源相关操作（出厂 = 「恢复出厂」，本地 = 「卸载」）。**导入 ≠ 启用**，安全模式下第三方只能导入、不能启用。
- 面板实现位于 `src/components/settings/plugin-manager/`（容器 `PluginManagerPanel` + `PluginListView` / `PluginRow` / `PluginDetailView` + `usePluginSettings` / `pluginIcon`），字段渲染复用 `PluginSettingsFields`。
- 插件图标归插件：把文件放到 `assets/icon.svg`（或 `icon.png`/`icon.webp`，方形、无透明留白、≤256KB）即可，`plugin-build` 会自动复制进 `dist/` 并写入清单 `icon`；没有品牌图时 `icon` 写 lucide 名称，留空则用默认图标。构建期由 `assertPluginIcon` 强制检查。规范见 `docs/plugin-icon-spec.md`。
- `bun run plugin pack <dir>` 产物是 `dist/<id>-<version>.zip`（zip 顶层目录 = 插件 id）。
- `bun run plugin` 在 monorepo 内直接跑源码 `packages/plugin-build/src/cli.ts`；外部插件仓库用 `@textox/plugin-build`。
- 未做部分（插件市场 / 索引仓 / 更新检查 / 跨窗口事件总线）见计划 3；作者文档见 `docs/plugin-runtime.md`。
- 命令行安装/管理（无需 GUI）：`bun run plugin:cli -- --data-dir <dir> <list|install|uninstall|enable|disable|safe-mode> …`（`src-tauri/src/bin/plugin-cli.rs`，复用 `plugins::*` 纯函数）。

## 插件加载路径

- **唯一运行根** `<appData>/plugins`（macOS `~/Library/Application Support/com.texto.markdown/plugins`）：`plugin_scan` 只扫这里。应用资源目录 `src-tauri/resources/plugins` 只作**播种源**，从不直接加载。
- 播种 `plugin_seed_bundled`：同版本幂等；`origin: user` 永不覆盖；卸载 `origin: seed` 留 `uninstalled` 墓碑阻止重播，`plugin_restore_builtin` 清墓碑后重播；升级重播保留 `data.json` 且不自动启用（只有首播按 `defaultEnabled` 启用）。
- 本地开发三源按 id 合并，后者覆盖：`plugins/*` → `vendor/plugins/*` → `plugin-sources.local.json`（最高，形如 `{"app.textox.mkdext": "../textoxmd/textox-plugin-mkdext"}`，已 gitignore）。`bun run dev` / `bun run app:dev` 经 `scripts/build/plugins.mjs` 汇总到 `src-tauri/resources/plugins/`。
- 已合并进 mkdext 的 12 个语法插件（alert / auto-pair / emoji / footnote / front-matter / heading-type-indicator / highlight / html / math / sub-sup / toc / underline）存放在 `test-fixtures/plugins/`，**只供编辑器整合测试**通过 `src/components/TextoEditor/tests/plugins-setup.ts` 加载（与 `official-plugins/*` 一起 glob），不进生产包、不参与 `initPlugins()`；它们是 bun workspace 成员，只为安装其第三方依赖。
- mkdext（`textoxmd/textox-plugin-mkdext`）以子模块 `vendor/plugins/mkdext` 接入，构建读其入库的 `dist/`；在外部 clone（`/Users/geange/workspace/textoxmd/textox-plugin-mkdext`）里改完推送、再更新子模块指针，或临时用 `plugin-sources.local.json` 指向外部 clone（优先级最高）。
- 资源目录名以插件 `manifest.json` 的 `id` 为准，不是来源目录名（子模块目录叫 `mkdext`、插件 id 是 `app.textox.mkdext`，`scripts/build/plugins.mjs` 已按清单 id 落盘；播种时按目录名当 id 会判定非法而跳过）。
- 两个 SDK 别混：`@textox/plugin-sdk`（`vendor/plugin-sdk`，0.3.0 起含编辑器契约 `markdown` / `editor` 面）是外部插件唯一契约；`@texto/plugin-sdk`（`packages/plugin-sdk`）是宿主内部聚合（`MARKDOWN_EDITOR_*` / `APP_*` 扩展点常量），作者不依赖，其中编辑器契约与语法引擎已退化为对作者包的转发壳。
- 启动链 `initPluginRuntime` 会先调 `plugin_seed_bundled` 再扫描；运行时插件的设置字段由 `plugin.config.ts` 的 `settings` 经 `plugin-build` 写入清单，宿主启动时按清单回填默认值。`apply: 'restart'` 的键在 `settings.set()` / 面板写入时只落盘、内存值延后到下次启动生效（跨窗口热更新也忽略磁盘新值），面板标注「重启后生效」。来源标签为「出厂」（资源目录播种）/「本地」（用户导入）。

## MCP 服务端（本机回环）

- 实现：`src-tauri/src/mcp.rs` 手写 Streamable HTTP（JSON-RPC：`initialize` / `ping` / `tools/list` / `tools/call`，无 SSE），只监听 `127.0.0.1`，端口存 `AppConfig.mcp_port`（默认 `38471`，设置页可改 1024–65535，改动即时重启监听；`TEXTO_MCP_PORT` 仅开发期覆盖），拒绝非本地 `Origin`（**精确匹配 host**，`http://localhost.evil.com` 不放行）、拒绝非回环 `Host`（防 DNS rebinding）、`POST /mcp` 必须 `Content-Type: application/json`（挡住浏览器 `text/plain` 简单请求），`TEXTO_MCP_TOKEN` 可选 Bearer 鉴权。`stop()` 会等旧线程退出（最多 300ms，必要时后台 join）再释放端口，并清空上一次的绑定错误。
- 开关：设置 → 实验功能（`src/components/settings/McpSettings.tsx`），值存 `AppConfig.mcp_enabled`（默认 `false`）；`set_config` 落盘后调用 `mcp::apply` 即时启停，启动时也按该值 `apply`。服务状态（是否在跑 / 端口占用错误）经 `get_mcp_status` 返回。
- 工具：`textox_app_info`、`textox_get_active_document`、`textox_set_selection`、`textox_insert_text`、`textox_replace_document`、`textox_list_recent_documents`（标注书签有效性）、`textox_create_entry`（工作区内新建文件/文件夹）、`textox_open_document`。
- 打字机式插入：`textox_insert_text` 默认逐字呈现（`stream: false` 关闭），节奏见 `src/components/TextoEditor/src/agent-stream.ts`（随机抖动 + 标点/换行停顿 + 8s 上限；单步 ≤420ms 以落在历史会话 500ms 合并窗口内，整段算一步撤销）。逐字期间 `lockEditorInput` 锁住人工输入（beforeinput / 粘贴 / 拖放 / 编辑键，Esc 终止），编辑器右下角显示「AI 正在输入」指示器（`EditorPanes` 的 `overlay` 槽）。源码视图（SV）无逐字效果，退化为整段插入。逐字是异步的，进行中再调用 `textox_insert_text` 会直接报错（`isStreamingInsert()` 守卫），不会静默截断上一段。调度用 rAF + 64ms 定时器兜底：窗口最小化/被遮挡时 rAF 暂停也不会卡死。
- 工作区边界：`textox_create_entry` 的 path 经 `src/utils/workspacePath.ts` 做 posix 归一（折叠 `.` / `..`）后必须落在工作区内，`..` 越界直接拒绝（只做词法归一，不解析符号链接）。
- 目标窗口：`mcp::resolve_window` 按「工具参数 `window` → 当前聚焦 → 最近聚焦（`note_focused_window`）→ `main` → 首个」挑**一个**编辑器窗口（`main` / `window-*`），没有窗口时立即返回可读错误而不是白等 10s；返回结果里带 `window`，`textox_app_info` 的 `activeWindow` 可先探明。
- 事件往返：`mcp-rpc` / `mcp-rpc-response`（`src/mcp/bridge.ts` + `src/hooks/app/useMcpBridge.ts`，在 `App.tsx` 调用），Rust 侧 10s 超时。**Tauri 的 `WebviewWindow::emit` 是广播**（走 `manager().emit`），而 JS `listen` 默认 `Any` 目标、会收到发给其它 label 的事件 —— 所以请求与 `open-file` 载荷都带 `target`，各窗口按自身 label 过滤；Rust 侧也先校验回包 `window` 再取走等待通道。
- 上架：两个 entitlements 均已加 `com.apple.security.network.server`（沙盒下监听回环必需）；功能默认关闭、由用户显式开启。Windows MSIX 为 `runFullTrust`，无需额外声明。
- 本地对接：仓库根 `opencode.json` 声明 `mcp.servers.textox`（remote，`oauth: false`），OpenCode 自动热加载。

## Plugin architecture

骨架（`src/`）与第一方插件（`official-plugins/*`）通过 `@texto/plugin-sdk` 契约解耦：

- **契约包** `packages/plugin-sdk/`：`TextoPlugin` 清单（`extensionPoints` / `contributes`）与 `PluginHost` 宿主能力（documents / editor / dialogs / config / i18n / theme / events / toast / window / log）。应用级扩展点契约在 `packages/app-api/`（owner `app`）：`app:fileEditor` / `app:exporter` / `app:command` / `app:settingsSection` / `app:imageUploader` 由宿主声明，插件经 `contributes['app:*']` 贡献。
- **插件包** `official-plugins/<id>/`：`src/index.ts` 默认导出 `definePlugin({...})` 清单，自行持有实现与依赖（如 `@excalidraw/*`），**不得 import 骨架的 `@/`**。
- **运行时包** `packages/export-runtime/`：骨架与导出插件共享的导出运行时（`overlay` + 序列化工具），双方只依赖它、不反向依赖骨架；`official-plugins/html-export` 经 `contributes['app:exporter']` 贡献 HTML 格式，并用 `menuAction` 声明其占用的原生菜单项。EPUB 导出已从应用资源退役（老版本播种的副本由 `seed.rs` 的 `RETIRED_BUNDLED_PLUGINS` 在启动时清理），改由外部 Pandoc 插件提供（默认不启用）。
- **骨架消费点**：`src/plugins/registry.ts` 收集清单；`index.ts` 用构建期 `import.meta.glob` 收集 `official-plugins/*/src/index.ts`；`src/plugins/host.ts` 用真实能力实现 `PluginHost`；`FileEditorHost`（含 `PluginErrorBoundary`）渲染文件编辑器槽；导出器注册进 `src/utils/export/registry.ts`；命令面板/菜单查命令注册表；编辑器内嵌由 `markdown-editor:extension` 的 `nodeViews`/`preview` 渲染（`image-ref.ts` 按 `embed` 元数据匹配）。
- **硬规则**：`src/` 的「生产代码」不得出现插件专属字面量（tests/specs 除外；`src/i18n/locales/*.json` 为生成资产、不在扫描扩展名内），`bun run check:skeleton` 守护；编辑器（`src/components/TextoEditor/`）不得 import 骨架任何模块（别名 `@/` 或相对路径逃逸），方向固定为「骨架 → 编辑器」，app 级能力（图片解析/上传、保存媒体/下载、对话框）经 `EditorHost`（`src/components/TextoEditor/src/host.ts`）注入，`bun run check:editor-boundary` 守护。两者均已并入 `make check-ts`。`check:skeleton` 对表格用「专属标识」正则（`table_cell|table_row|table_open|table_close|tableCanonical|spliceTable|table-toolbar|table-tb|table-resize|insertTable|buildTable` 等）而非裸 `table`：核心仍保留无法消除的通用用法（内容/主题的 `table th, table td` 元素选择器、主题 surface token `--editor-table-*`、demo 站点表格），收紧裸词会误伤。
- **插入块命令（`EditorExtension.insert`）**：插件经 `markdown-editor:extension` 贡献 `insert: InsertCommandMeta`（`id` 为**裸 slug**、须与快捷键/原生菜单 action id 一致；`keyword` / `labelKey` / `icon: IconSpec` / `defaultShortcut` / `insert(view)`）。骨架唯一读取入口 `editorInsertCommands()`（`src/components/TextoEditor/src/extension/registry.ts`，按 id last-wins + 原位）。表格插件是首个消费者；工具栏（`EditorToolbar/registry.ts`）、斜杠菜单（`SlashMenu.tsx`）、快捷键设置（`ShortcutSettings.tsx` 的 `slashByAction()`）、app 快捷键/命令分发（`src/plugins/editorInsertSurfaces.ts` + `useAppCommands.ts` 的 `default` 回退）、编辑器 `ref.runEditorInsert(id)` 全部由该贡献派生。详见 `docs/plugin-development.md`。
- **正文右键菜单（`markdown-editor:contextMenu`）**：编辑器内正文右键**永远弹同一个菜单**（内置项恒在；非 Tauri 环境降级且只提示一次）。插件经该扩展点贡献 `EditorContextMenuItemMeta`（`id` 为裸 slug、建议 `<插件id>.<name>`；`labelKey` / `requires?: ('selection' | 'block')[]`（**不写 = 任何场景都列出**，可点性交给 `enabled`）/ `order`（组内升序）/ `when(ctx)`（细粒度可见性，抛错⇒不列出）/ `enabled(ctx)`（置灰，抛错⇒置灰）/ `run(ctx)`（抛错 / reject 逐项隔离，编辑器不等待）；`ctx = { view, hasSelection, block: { pos, node } | null }`，`pos` 是该顶层块可直接用于事务的位置（`$pos.before(1)`），**`block` 未命中时为 `null`、插件需判空**）。**场景互斥、选区优先**：有非折叠选区 ⇒ 仅 `selection` 场景（`requires: ['block']` 的项**不列出**）；无选区 + 命中块 ⇒ 仅 `block` 场景；无选区 + 未命中块 ⇒ 无场景（`requires` 含场景的项都不列出）。编辑器侧链路：唯一读取入口 `editorContextMenuItems()`（`src/components/TextoEditor/src/extension/registry.ts`）→ `resolveContextMenuContext()`（`src/components/TextoEditor/src/features/context-menu/target.ts`）按坐标定位命中的顶层块（用 `posAtCoords()` 的 `inside + 1` 取样，避免点在 NodeView（图表预览）的非 `contentDOM` 区域时落在块边界取不到块；**已知边界**：顶层原子 leaf 块（`horizontal_rule`、顶层图片等 `nodeSize === 1`）取不到块 ⇒ `block: null`）→ `buildContextMenuModel()` 按 `availableScenes()` 过滤装配（组内按 `order`、组间固定「内置项在前 + 一条分隔符」，`when`/`enabled`/`run` 逐项 try/catch 隔离）→ `openContextMenu()` 弹 Tauri 原生菜单。编辑器内置项「复制 / 复制为 HTML」走同一契约形状（`CORE_CONTEXT_MENU_ITEMS`，**不写 `requires`、以 `enabled: ctx.hasSelection` 表达可点性**）⇒ 无选区时**列出但置灰**。契约**不注入序列化能力**（插件用 `ctx.block?.node` / `ctx.view` 自助，`check:editor-boundary` 保证插件拿不到骨架序列化器）。mermaid（首个）与 math 插件各贡献一个 `requires: ['block']` 的项（「复制 Mermaid 源码」/「复制 LaTeX 源码」，后者覆盖 ```latex / ```math / `$$…$$` 块级公式；行内公式 `$…$` 位于段落内、块级项不覆盖它）；行内公式 widget（`official-plugins/math/src/syntax/inline-render.ts` 的 `math-jax`）与行内图片 widget（骨架 `src/components/TextoEditor/src/decorations.ts` 的 `image-render`）另对非主键 `mousedown` 只 `preventDefault()`（不移除冒泡），防右键切回源码。详见 `docs/plugin-development.md`。
- **选区动作与 Agent 能力**：插件经 `markdown-editor:selectionAction` 贡献 `SelectionActionMeta`（`id` last-wins；`when()` 每次显示 / 事务求值、抛错只跳过自身；`run(view)` 时选区仍存在；可见性独立于格式栏——跨块 / 代码块 / 标题 / 只读 / 开关关闭仍显示）投放到悬浮选区工具栏；LLM 能力统一走 `PluginHost.agent`（`available(profileId)` 同步、配置未加载为 false；`run()` 只经回调流式输出、不写共享 session；`present()` 写共享 session、按宿主 `agent_result_surface` 显示悬浮块 / 侧栏释义视图并中止上一条请求；错误事件带 `retryable`），宿主实现在 `src/agent/`（capability / run / runtime / session / presenter / AgentPanel），首个消费者 `official-plugins/ai-explain`，插件只依赖契约包；AI 工具走 `host.agent.tools`（核心内置 + 插件经 `app:agentTool` 贡献，`src/agent/tools.ts` 合并、插件间同名 last-wins 且 `core.*` 不可覆盖，插件工具收贡献方 host；v1 由插件手动 `call`，如 `core.read-selection-context`，仅 IR 模式、未注册给模型）。详见 `docs/plugin-development.md` 的「选区动作（`markdown-editor:selectionAction`）」与「Agent 能力（`PluginHost.agent`）」。
- **AI 模型配置**：ai-explain / ai-translate 默认关闭，经设置段 modelProfile 字段绑定某条 agent profile；宿主 host.agent 的 available/run/present 都必须显式传 profileId，未指定即不可用；第三方 AI 同意在**每次把总开关拨到开**时收集（`src/components/settings/AiConsentPage.tsx` 的对话框：覆盖集合全在境内时单步、含境外服务商时两步问个人信息出境，判定见 `src/agent/consent.ts` 的 `hasOverseasProvider`），provider 列表按商店地区过滤（`src/agent/region.ts` + `providers-catalog.ts`）；同意记录只作审计写入，不参与可用性判定（`agentEnabled` 只看落盘开关）。
- **源保真协调器（`SyntaxFeature.sourcePreserve`）**：顶层块的子单元源文本保真从核心迁到插件。`SourcePreserveReconciler`（`nodeTypes` / `collect` / `canonicalUnits` / `splice`）由 `@texto/markdown-editor-runtime` 定义，插件经 `markdown-editor:syntaxFeature` 声明；核心 `source-preserve.ts` 按**新节点类型**校验分发，注入 `renderBlockCanon`（插件不可 import 序列化器），每个协调器调用经 `runFeatureStep` 隔离（单个抛错只跳过自身）。表格插件是首个消费者。详见 `docs/plugin-development.md`。
- **verbatim 顶层节点协调器（`SyntaxFeature.sourceVerbatim`）**：面向「无 root span、被解析器重定位」的顶层节点（典型：`markdown-it-footnote` 把定义重定位到文末、块 token 无 `map`）。`SourceVerbatimRegion` / `SourceVerbatimReconciler`（`matches` / `keyOf` / `collect` / `render`）由 `@texto/markdown-editor-runtime` 定义；核心 `isVerbatimRoot` 声明式排除出位置对齐，按源区域原位保留 + 按 key 写回（编辑/新增/删除），只在 free 残段层叠加，位置对齐主流程不变，调用经 `runFeatureStep` 隔离。脚注插件是首个消费者。详见 `docs/plugin-development.md`。
- **i18n 归属**：插件文案随插件走——各插件在 `src/locales.ts` 声明 `locales`（语言 → 嵌套 messages）与 `defaultLocale`，骨架启动时由 `src/i18n/plugin-messages.ts` 注入 i18next 的 `plugins` 命名空间、`src/i18n/index.ts` 设 `fallbackNS`，key 引用形式 `<插件id>.<key>`；骨架只引用 key，不写具体插件文案，也不再往 `vendor/translations` 添加插件文案。例外：导出插件的原生菜单标签（`menu.export_html`/`menu.export_epub`）由骨架持有（Rust 编译期嵌入核心 bundle，前端注入不可见）。
- **插件设置与配置**：插件经 `contributes['app:settingsSection']` 声明式贡献设置项（`text`/`password`/`number`/`boolean`/`select`/`action`）；配置按插件 id 隔离，存于独立 store（`plugin_config.<id>.json`），插件经 `PluginHost.config`（`get`/`set`/`getAll`/`subscribe`）读写，`PluginHost` 由 `createPluginHost(deps, pluginId)` 按插件绑定。设置界面默认是紧凑图标网格（52px 纯图标方块、悬浮显示插件名、可切换为列表视图；按清单 `categoryKey` 分组，`icon` 为 `IconSpec`——lucide 名称或手绘 `IconDef`，裸 SVG path 仅作遗留兼容）→ 二级设置页；文案走插件自带 locales 的 i18n key（key 由插件声明，骨架只引用）。（设置段按启用状态展示：未启用插件的二级页只显示启用/卸载操作，不显示其配置项，启用后才显示；但设置段仍会为未启用插件注册，其余贡献则按启用状态注册。）每个设置字段声明 `default`，框架经 `applySettingsDefaults` 计算插件默认配置，并内建「恢复默认值」入口（`settings.pluginReset`，由设置面板统一渲染，插件无需自带 action 字段；仅当当前配置偏离字段默认值时显示，点击后需二次确认）。
- **图片上传器**：插件经 `contributes['app:imageUploader']` 提供 `upload(host, filePath)`；骨架 `src/plugins/imageUploader.ts` 从注册表解析**启用插件**的上传器（last-wins）并绑定其 owner host，粘贴路径（编辑器 `EditorHost.getImageUploader()`）与工具栏「插入图片」路径共用该入口（编辑器内不再出现具体图床名）。PicGo 即 `official-plugins/picgo`，其插件开关即「是否上传」；插件清单可声明 `migration` 做一次性旧配置迁移（骨架 `src/plugins/migrate.ts` 通用实现，启动时先迁移再注册）。
- **文件扩展名归插件**：`app:fileEditor` / `markdown-editor:extension` 的 `embed` 声明的 `extensions` 只属于插件，不写进 `AppConfig.openable_extensions` 默认值，也不进 `tauri.conf.json` / `Info.plist` 的文件关联。`src/plugins/registry.ts` 的 `resolveOpenableExtensions()` 以用户配置为基线，追加启用插件的扩展名（`enabledFileExtensions`）、扣除被禁用插件的扩展名（`disabledFileExtensions`），`App.tsx` 把它作为目录树可打开判定与文件链接识别的唯一来源；卸载或禁用插件后该类文件自动变为不可打开。`AppConfig::load` 会清理历史版本自动注入的插件扩展名（`LEGACY_PLUGIN_EXTENSIONS`）。
- **贡献冲突**：所有扩展点统一「后注册优先（last-wins）」——同一 id 覆盖，不同 id 的重叠（扩展名 / `menuAction` / 代码块语言 / 导出器 id）亦取最后注册者；重叠在 DEV 下打印告警（`src/plugins/registry.ts`、`src/utils/export/registry.ts`）。注册期做基本校验（空数组、扩展名格式、必填方法），仅告警不阻断。`app:command` 不再支持 `defaultShortcut`。
- **菜单声明协议**：TS 用 `src/app/menu/types.ts` 的 `SubmenuSpec` 声明子菜单，Rust `sync_submenu` 按声明重建原生子菜单（Rust 仍持有菜单句柄）。“导出”子菜单由 `listExporters()` 经 `src/app/menu/exportMenu.ts` 生成——禁用某导出插件后重启，原生菜单不再出现对应项；导出项 UI 顺序由导出器的 `order` 决定（缺省 0，相等时回退注册序）。把整菜单迁到 TS（`setAsAppMenu`）为后续独立项目。
- **扩展点机制**：插件可声明 `extensionPoints` 并向他人的扩展点 `contributes`。运行时在 `@texto/plugin-sdk`（`declareExtensionPoint` / `registerContributions` / `getContributions`）。编辑器扩展点 `markdown-editor:extension` 由 `@texto/markdown-editor-api` 定义；应用级扩展点 `app:fileEditor` / `app:exporter` / `app:command` / `app:settingsSection` / `app:imageUploader` 由 `@texto/app-api` 定义。编辑器贡献 ProseMirror 原生 `plugins` 与 `nodeViews`（工厂返回 `NodeView | null`）；编辑器对 `code_block` / `image_ref` 注册分发器，贡献优先、内置视图兜底。编辑器经 `EditorContext.views` 注入可复用视图构件（`codeBlock` / `embed` + `preview`）。插件只依赖编辑器/app 契约包，插件之间零依赖（星型拓扑）。
- **NodeView / 懒加载坑**：插件 NodeView 的 DOM 结构必须在交给 ProseMirror 之前就绪（不要在挂载后再 `dom.appendChild` 渲染容器），懒加载只延迟「行为」而非「结构」；首次渲染要在行为句柄赋值之后执行；`ignoreMutation` 需放行插件私有的渲染容器内部变更与 mode 切换的 style/class 属性变更。WebKit（WKWebView）对 DOM 变更的判定比 Chromium 严格，`happy-dom` 单测无法覆盖，改动编辑器 DOM 后需真机冒烟。详见 `docs/plugin-development.md`，并补齐结构守卫 + 契约守卫两层测试。

## Editions

Two editions via `--edition lite`（构建脚本内部映射为 `VITE_FREE_VERSION=true` + `--features free-version`）:
- **Full** (`com.texto.markdown`) — includes ThemeEditor, Export, theme_converter
- **Lite/Free** (`com.texto.markdown.lite`) — excludes `theme_manager` and `theme_converter` (Rust `#[cfg(not(feature = "free-version"))]`)

Rust feature flag: `free-version` in `Cargo.toml`. Lite build uses `tauri.conf.free.json5` (macOS/Linux) or `tauri.conf.free.windows.json5` (Windows)。

**例外（2026-11 确认）**：Windows 的免费版与付费版当前都提供完整功能——不设 `VITE_FREE_VERSION`、不传 `--features free-version`，仅 bundle identifier 与商店条目不同。macOS/Linux 仍按 edition 门控。

Dev: `make dev-lite` / `bun run app:dev -- --edition lite`。

## Localization

15 languages (zh-CN, zh-TW, en, ja, ko, fr, de, es, pt, it, ru, ar, hi, th, vi). Edit modular YAML in `vendor/translations/sources/` (git submodule, commit in `textoxmd/translations` first). Run `bun run i18n:build` to regenerate JSON. Fallback: zh-CN only (no en-US intermediate).

## TypeScript conventions

- `strict: true`, `noUnusedLocals`, `noUnusedParameters` enforced by tsconfig（编辑器专用 `src/components/TextoEditor/tsconfig.json` 亦为 strict，并已纳入 `bun run typecheck`）
- Path alias `@/` → `./src/*`, JSX: `react-jsx`, target ES2020
- Tailwind CSS v4 (no config file, `@tailwindcss/vite` plugin), shadcn/ui `base-nova`, lucide icons
- `katex` import redirects to stub via vite alias
- **No ESLint or Prettier** for frontend — Rust linting only via `cargo fmt` / `cargo clippy`

## Build & signing (macOS)

- 统一入口：`bun run app:build` / `bun run app:package`（`--edition lite` 切换 Lite）；`make` 只是别名
- macOS signing: 仓库不含证书与团队 ID；`TEXTO_APP_SIGNING_IDENTITY` / `TEXTO_INSTALLER_SIGNING_IDENTITY` 提供签名身份，团队 ID 由 `TEXTO_APPLE_TEAM_ID` 或身份末尾的 `(TEAMID)` 解析，构建时注入 `src-tauri/target/entitlements.<edition>.plist`（`entitlements*.plist` 里只保留 `YOUR_TEAM_ID` 占位）
- macOS 公证（直接分发）：`app:package` 用 Developer ID + Hardened Runtime 签 app（`src-tauri/entitlements-direct.plist`，不开沙盒）→ 签 DMG → `notarytool submit --wait` → `stapler staple/validate` → `spctl`；凭据取 `TEXTO_NOTARY_KEYCHAIN_PROFILE` / `TEXTO_NOTARY_APPLE_ID`+`TEXTO_NOTARY_PASSWORD`(+`TEXTO_APPLE_TEAM_ID`) / `TEXTO_NOTARY_API_KEY`+`_API_KEY_ID`+`_API_ISSUER`，缺省跳过，`TEXTO_REQUIRE_NOTARIZATION=1` 时缺凭据直接失败，`--no-notarize` 显式跳过；`Apple Distribution` / `3rd Party Mac Developer` 证书不能公证
- 打包只分渠道：`app:package`（直接安装：macOS DMG / Windows MSI+NSIS）与 `app:package -- --store`（macOS full+lite PKG / Windows MSIX）
- PKG 流程（`scripts/build/macos.mjs`）：构建 app → 嵌入 `embedded.provisionprofile[.lite]` → 重签（entitlements）→ `productbuild`，产物写入 `out/`
- Debug builds via `make build-debug`; `make build-local` — skip signing, enable DevTools (`TEXTO_DEVTOOLS=1`)
- 已移除 `sign` / `notarize` / 独立 `dmg` 目标
- **No GitHub Actions CI for Windows** — `.github/workflows/ci.yml` runs typecheck/tests/guards on Linux and `cargo check`/`clippy` on macOS; `.github/workflows/build.yml` optionally builds unsigned macOS DMG/PKG and Windows MSI/NSIS (manual dispatch or `v*` tag), signing material comes only from repository secrets.

## Git conventions

Conventional Commits format (`.git-commit-template.txt`):
```
<type>(<scope>): <description>
```
Type: `feat|fix|chore|docs|refactor|style|perf|test`. Scope (optional): e.g., editor, i18n, theme, git.

Use `make git-commit` / `make git-push` for structured workflow.

## OpenSpec workflow

Changes are managed via OpenSpec in `openspec/`. Schema: `openspec/schemas/texto/schema.yaml` with templates (`proposal.md`, `design.md`, `spec.md`, `tasks.md`). Active changes live in `openspec/changes/`; shipped changes move to `openspec/changes/archive/`. Specs that outlive a single change go in `openspec/specs/`.
