# 插件化候选清单（Backlog）

> 状态：盘点，未定方向。目的：把「骨架仍写死、但原则上可交给插件」的能力列清楚，
> 作为后续 OpenSpec change 的选型输入。本文不是设计，不含实现方案。
>
> 盘点基准：`main` @ `7672c85b`（math/mermaid 插入命令插件化之后）。

## 0. 判定原则

一条能力「可插件化」需同时满足：

- 骨架侧存在一个**稳定读取入口**（注册表 / 扩展点），删除具体实现后骨架仍可编译运行；
- 插件侧有**契约包**可依赖（`@texto/plugin-sdk` / `@texto/app-api` / `@texto/markdown-editor-api` / `@texto/markdown-editor-runtime`），且不反向 import 骨架；
- 不违反两条硬规则：`bun run check:skeleton`（`src/` 生产代码不得出现插件专属字面量）、`bun run check:editor-boundary`（编辑器不得 import 骨架）。

## 1. 当前扩展点（对照基准）

| 层 | 扩展点 | 契约位置 | 已有消费者 |
|---|---|---|---|
| 编辑器 | `markdown-editor:extension` | `packages/markdown-editor-api/src/types.ts` | table、html、math、mermaid、excalidraw |
| 编辑器 | `markdown-editor:syntaxFeature` | `packages/markdown-editor-runtime/src/syntax-feature.ts` | math（行内）、table（sourcePreserve） |
| 编辑器 | `markdown-editor:formatToolbar` | `packages/markdown-editor-api/src/types.ts` | underline、highlight |
| 应用 | `app:fileEditor` | `packages/app-api/src/index.ts` | excalidraw |
| 应用 | `app:exporter` | 同上 | html-export、epub-export |
| 应用 | `app:command` | 同上 | 各插件 |
| 应用 | `app:settingsSection` | 同上 | picgo、各插件 |
| 应用 | `app:imageUploader` | 同上 | picgo |

编辑器 `markdown-editor:extension` 已覆盖：ProseMirror `plugins`、`nodeViews`、`insert`（插入命令）、代码块视图（`defineCodeBlockExtension` + `languages`）、`preview` / `embed` 视图。

## 2. 候选清单

### A. 应用级外设扩展点（纯 TS，低耦合，性价比最高）

| 候选 | 现状证据 | 价值 | 成本/前置 |
|---|---|---|---|
| `app:sidebarPanel` | 侧栏仅 files/outline 两个写死 tab：`src/App.tsx:481-565`；`Sidebar.tsx:56` 只渲染 `children`；`src/components/sidebar/` 无注册表 | 插件加 Git 状态、标签、反链、待办面板 | 需定义面板标题/图标/排序与激活态；与现有 `ContextMenuProvider`/`ShortcutProvider` 的嵌套关系 |
| `app:statusBarItem` | `WordCountBadge` 写死 `src/App.tsx:646` | 字数之外的统计、同步状态、拼写检查指示 | 低；需一个容器 + 贡献契约 |
| `app:toolbarItem`（或编辑器侧） | `EditorToolbar/registry.ts:27` 的 `registerToolbarItem` **只被测试调用**；`items.tsx:31-97` 硬编码 13 项；当前只有 insert 命令被投影（`registry.ts:53`） | 把已有的运行时注册器升级为扩展点，内置项也可被覆盖 | 需决定归属：编辑器外设属应用级，但 `run` 依赖 `EditorView`，契约边界要处理（可走编辑器 `EditorHost`/`Context`） |
| `app:theme` | `BUILTIN_THEMES` 硬编码 `src/components/styles/theme-registry.ts:32`；主题解析依赖 Rust `theme_manager` + `theme_converter` | 插件贡献配色主题，`app:theme` 与 theme_manager 打通 | 中；需宿主能力（读写/校验主题），Rust 侧非零改动 |
| `app:importer` | 不存在导入概念（只有 `app:exporter`） | 与导出对称：docx/notion/其他 md 变体导入 | 中；需定义导入产物（新文档内容 + 扩展名） |
| `app:fileTreeAction` | `src/components/sidebar/context-menu/` 无注册表 | 右键动作（压缩、加密、用外部工具打开） | 低-中 |
| `app:documentAction` | 无 on-open/on-save/format-on-save 钩子 | 备份、版本历史、保存时同步、格式化 | 中；需定义触发点与异步/失败语义 |
| `app:linkHandler` | 外链打开逻辑散在骨架 | 自定义协议、内联预览、引用解析 | 中 |
| `app:searchProvider` | `search_files` 为 Rust（`src-tauri/src/lib.rs:833`） | 搜索后端可替换/增强 | 高；绑定 Rust |

### B. 编辑器侧仍缺的缝

- **预览态专属扩展**：`markdown-editor:syntaxFeature` 的 `mdItPlugins` 服务编辑/预览共用管线，但「仅预览/导出」的自定义容器（callout、图表、目录）没有独立缝。
- **NodeView 分发器**：目前仅 `code_block` / `image_ref` 注册分发；新增块类型（如 callout）若无对应核心节点类型，需要走 `syntaxFeature.nodes` + 视图。
- **代码块语言/高亮**：语言名已可通过 `EditorExtension.languages` 追加（`fenced-code.ts:357` `editorExtensionLanguages()`，mermaid 已用）；但核心 hljs 语法注册写死在 `fenced-code.ts:39-51`，第三方语法包没有贡献通道。

### C. 内置功能迁出为插件（骨架瘦身）

`BUILTIN_FEATURES`（`src/components/TextoEditor/src/features/index.ts`）共 28 项，原则上都在 `markdown-editor:syntaxFeature` 契约内，可逐步外迁。优先级排序：

1. **`alert`**（GitHub callout）：块级语法，最接近 table 的迁移路径，能再次验证块级 + 源保真契约。（已于 2026-10-03 迁出：`official-plugins/alert`。）
2. **`typing-particle`**：自带配置/预设/Canvas 渲染，**其配置 UI 还直接埋在 `SettingsWindow.tsx`**（`line 36` 直接 import `particle-config`）。是「编辑器行为 + `app:settingsSection`」双缝的天然样例，迁出后能显著给 2600 行的 `SettingsWindow.tsx` 减负。
3. **`toc` / `frontMatter`**（**均已迁出**）：独立语法单元，规则清晰。（`footnote` 已于 2026-10-04 迁出：`official-plugins/footnote`，并新增通用「verbatim 顶层节点」源保真缝，见 `docs/superpowers/specs/2026-10-04-footnote-pluginization-design.md`；`frontMatter` 已于 2026-10-04 迁出：`official-plugins/front-matter`，见 `docs/superpowers/specs/2026-10-04-front-matter-pluginization-design.md`；`toc` 已于 2026-10-04 迁出：`official-plugins/toc`，见 `docs/superpowers/specs/2026-10-04-toc-pluginization-design.md`。）
4. `emoji`（**已于 2026-10-08 迁出：`official-plugins/emoji`**） / `subSup`（**已于 2026-10-07 迁出：`official-plugins/sub-sup`**，见 `docs/superpowers/specs/2026-10-06-sub-sup-pluginization-design.md`） / `underline` / `highlight`（已于 2026-10-06 迁出：`official-plugins/highlight`，见 `docs/superpowers/specs/2026-10-06-highlight-pluginization-design.md`） / `auto-pair`（**已于 2026-10-08 迁出：`official-plugins/auto-pair`**） / `heading-type-indicator`（**已于 2026-10-08 迁出：`official-plugins/heading-type-indicator`**） / `typewriter` / `link-hover-toolbar` / `image-viewer`：更碎，视收益再排。emoji / auto-pair / heading-type-indicator 的迁移见 `openspec/changes/pluginize-emoji-auto-pair-heading-indicator/`。

> 侧信号：`SettingsWindow.tsx` 2600 行，Appearance / Editor / Shortcuts / Shield / About 等 tab 均硬编码，说明**设置页本身只插件化了一半**（只有插件设置段是声明式的）。

### D. Rust 强耦合（需先注入宿主能力，或保留骨架）

- `theme_manager` / `theme_converter`（`src-tauri/src/`）+ `ThemeEditor`（现按 Full edition 门控，非插件）。
- `export_png` / `export_pdf`：native 导出，`src/utils/export/registry.ts:11` 的 `NATIVE_EXPORT_MENU_ACTIONS` 明确注释「骨架拥有，插件不得占用」。
- `search_files`（Rust）。

这些要插件化，得先扩 `PluginHost`（如 `host.render` / `host.theme` / `host.search`），并评估原生菜单/Rust 命令的占用冲突。

## 3. 可选路线与权衡

| 路线 | 内容 | 优势 | 代价 |
|---|---|---|---|
| **① 外设扩展点补齐** | `app:sidebarPanel` + `app:statusBarItem` + toolbar 扩展点 + `app:theme` | 纯 TS、零 Rust 改动、与现有 `app:*` 同构、立刻放大生态 | 需要新的 UI 展示契约 |
| ② 文件层能力缝 | `app:importer` + `app:documentAction` + `app:fileTreeAction` | 与 `exporter`/`fileEditor` 对称收口 | 收益偏完整性，短期可见度低 |
| ③ 内置瘦身 / 迁出 | 优先 `alert`、`typing-particle` | 验证契约一般性、给 `check:skeleton` 与 `SettingsWindow` 减压 | 可能需新编辑器缝 + WebKit 真机冒烟，成本最高 |

倾向 **①**：风险最低，且当前生态只能扩展「导出 / 命令 / 设置」，UI 层（侧栏、状态栏、工具栏、主题）完全没有入口。

## 4. 风险与约束（所有路线通用）

- **编辑器边界**：编辑器侧任何新增能力必须走 `@texto/markdown-editor-*` 契约，不得 import 骨架。
- **骨架洁净**：`src/` 生产代码不得出现插件专属文案/字面量，`check:skeleton` 守护（表格用专属标识正则而非裸 `table`）。
- **WebKit 时序**：NodeView / 懒加载改动在 `happy-dom` 与 Chromium 均不复现，需真机冒烟（见 `docs/plugin-development.md`）。
- **插件切换需重启**：贡献在启动时登记并缓存（如 `features/index.ts` 的 `_features`），启用/禁用不热更新。
- **冲突策略统一**：所有扩展点「后注册优先（last-wins）」，DEV 下告警；新增点须沿用。
- **原生菜单占用**：涉及菜单项的扩展点要处理 `menuAction` 占用与 `sync_submenu` 声明同步。

## 5. 新增一个扩展点的最小检查表

1. 在所有者契约包声明 `declareExtensionPoint`，并 `declare module '@texto/plugin-sdk'` 增补 `ExtensionPointMap`。
2. 骨架仅保留**唯一读取入口**（如 `editorInsertCommands()` 模式），消费点全部由该入口派生。
3. 注册期做基本校验，DEV 告警不阻断；沿用 last-wins。
4. i18n 文案归属插件（key 在 `vendor/translations`），骨架不写具体文案。
5. 补两层测试：结构守卫（骨架读取/合并）+ 契约守卫（贡献行为）。
6. 若触及编辑器 DOM/懒加载，补真机 WebKit 冒烟说明。

## 6. 迁移记录

### 2026-11-21（P1：契约统一 + 单一路径 + 设置管理）

- `packages/app-api` 与 `packages/markdown-editor-api` 的类型/常量已并入宿主内部聚合包
  `@texto/plugin-sdk`（`packages/plugin-sdk`），旧包退化为 re-export 壳，P3d 删除；外部作者的
  契约仍是 `@textox/plugin-sdk`（`vendor/plugin-sdk`），该包已升到 **0.2.0**（7 个
  `register*`、`settings.onDidChange`、`requestReload`、`manifest.settings`）。
- 运行时新增七个编辑器贡献缝（`registerSyntaxFeature` / `registerExtension` /
  `registerInsertCommand` / `registerContextMenuItem` / `registerSelectionAction` /
  `registerFormatToolbarItem` / `registerSyntaxHighlight`），注册表支持按贡献 / 按 owner 注销；
  上表第 1 节的「契约位置」已由壳包统一到 `packages/plugin-sdk`。
- 加载路径收敛为单一路径：`<appData>/plugins` 是唯一运行根，`src-tauri/resources/plugins`
  仅作出厂播种源（`plugins.json` 记录 `seeded` / `uninstalled` 与 `origin`）。
- **P2**：12 个语法特性合并为单个 `app.textox.mkdext` 插件——alert、auto-pair、emoji、footnote、
  front-matter、heading-type-indicator、highlight、html、math、sub-sup、toc、underline
  （清单与分组见 `docs/superpowers/specs/2026-11-21-plugin-unification-design.md` §7.3）。
  - 作者包升到 **0.3.0**（`markdown` / `editor` 面：`SyntaxFeature`、`EditorExtension`、
    格式栏/右键/选区/插入命令契约与 `makePreview` 等助手），宿主
    `packages/markdown-editor-runtime` 与 `packages/plugin-sdk` 的编辑器契约退化为转发壳。
  - `textoxmd/plugin-sdk` 已推送并**发布 npm `@textox/plugin-sdk@0.3.0`**；
    `textoxmd/textox-plugin-mkdext` 以子模块 `vendor/plugins/mkdext` 接入宿主，构建读其入库
    `dist/`，资源目录按 `manifest.json` 的 id（`app.textox.mkdext`）落盘。
  - 12 个旧插件的**功能**已全部迁入 mkdext（12 特性、14 个设置字段、40 files / 323 tests，
    含直接加载真实 `dist/main.js` 的 bundle 冒烟）。旧目录移到 `test-fixtures/plugins/`，
    只经 `src/components/TextoEditor/tests/plugins-setup.ts` 供编辑器整合测试加载，不入生产包。
  - `packages/plugin-build` 升到 **0.1.4**（依赖 `@textox/plugin-sdk ^0.3.0`）。
- **P3**：其余 9 个插件待迁——syntax-highlight、picgo、html-export、epub-export、
  typing-particle、mermaid、table、ai-explain、ai-translate（波次见
  `docs/superpowers/specs/2026-11-21-plugin-unification-design.md` §9）。
