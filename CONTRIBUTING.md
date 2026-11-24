# 贡献指南

感谢你愿意参与 Textox！本文档说明如何搭建开发环境、运行测试以及提交改动。

参与本项目即表示你同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 环境要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| [Bun](https://bun.sh) | 1.2+ | 唯一使用的包管理器（不要用 npm / pnpm / yarn） |
| Rust | stable（通过 rustup 安装） | 开发 Tauri 后端 |
| Node.js | 20+ | 部分构建脚本以 Node 运行 |
| Xcode Command Line Tools | 最新 | 仅 macOS |
| WebView2 / WebKitGTK | 系统自带或发行版包 | Windows / Linux 运行与构建 |

Linux 还需要 Tauri 的系统依赖（`libwebkit2gtk-4.1-dev`、`libgtk-3-dev`、`librsvg2-dev` 等），
参见 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)。

## 初始化

仓库包含 4 个 git submodule（`vendor/excalidraw`、`vendor/translations`、
`vendor/plugin-sdk`、`vendor/plugins/mkdext`），必须一并检出：

```sh
git clone --recurse-submodules https://github.com/chenhualinx/Textox.git
cd Textox
# 已经 clone 过但没有子模块：
git submodule update --init --recursive

bun install
(cd src-tauri && cargo fetch)
```

## 开发

```sh
bun run app:dev     # 完整桌面应用（推荐）
bun run dev         # 仅前端，浏览器打开 http://localhost:1420
```

`bun run app:dev` 会先运行 `scripts/build/frontend.mjs`（同步图标、汇总插件资源），
再启动 Vite 与 Tauri。

## 测试与检查

提交前请至少跑通与改动相关的检查：

```sh
bun run typecheck                              # 全仓类型检查
bun run test:plugins                           # 插件/骨架契约单测
bun run check:skeleton                         # 骨架不得出现插件专属字面量
bun run check:editor-boundary                  # 编辑器不得 import 骨架
make check-ts                                  # 以上前端检查的合集

bunx vitest run --config src/components/TextoEditor/vitest.config.ts   # 编辑器行为测试
make check-rust                                # cargo check + clippy -D warnings
```

只跑单个编辑器测试：

```sh
bunx vitest run --config src/components/TextoEditor/vitest.config.ts tests/features/list.test.ts
```

## 代码约定

- TypeScript `strict` 开启，且启用了 `noUnusedLocals` / `noUnusedParameters`。
- 前端没有 ESLint / Prettier；Rust 使用 `cargo fmt` 与 `cargo clippy`，提交前请格式化。
- 路径别名 `@/` 指向 `src/`。
- 事务/渲染逻辑改动请补充或更新 `src/components/TextoEditor/tests/` 下的 spec 测试；
  happy-dom 无法覆盖 WebKit 的 DOM 行为，涉及编辑器 DOM 的改动请在本机真机冒烟。
- 插件相关改动请阅读 [docs/plugin-development.md](docs/plugin-development.md) 与
  [docs/plugin-runtime.md](docs/plugin-runtime.md)，确保 `check:skeleton` /
  `check:editor-boundary` 仍然通过。

## 提交信息

使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
<type>(<scope>): <description>
```

`type` 取 `feat|fix|chore|docs|refactor|style|perf|test`，`scope` 可选（如 `editor`、`i18n`、`theme`）。
示例：`fix(editor): 修复表格粘贴后光标错位`。

建议为提交添加 DCO 签名（`git commit -s`），表示你有权按 AGPL-3.0 提交该代码。

## 翻译

界面文案位于 `vendor/translations/sources/*/*.yaml`（独立仓库 `textoxmd/translations`）。

1. 在子模块中修改 YAML；
2. `cd vendor/translations && bun run build`；
3. 在 Textox 根目录运行 `bun run i18n:build` 同步 `src/i18n/locales/*.json`。

插件文案随插件自身维护，不放这里。

## Pull Request

1. 从 `develop` 切出分支（`main` 仅用于发布）；
2. 保持改动聚焦，一个 PR 解决一个问题；
3. 在描述中说明动机、实现方式与测试方式；
4. 确保 CI（typecheck / 测试 / clippy）通过；
5. 涉及 UI 的改动请附截图或录屏。

## 许可证

本项目以 [AGPL-3.0-or-later](LICENSE) 发布。提交贡献即表示你同意以同一许可证授权你的贡献。
第三方组件许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
