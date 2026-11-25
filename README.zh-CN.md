# Textox

[![License](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![CI](https://github.com/textoxmd/textox/actions/workflows/ci.yml/badge.svg)](https://github.com/textoxmd/textox/actions/workflows/ci.yml)
[![Build](https://github.com/textoxmd/textox/actions/workflows/build.yml/badge.svg)](https://github.com/textoxmd/textox/actions/workflows/build.yml)
[![Website](https://img.shields.io/badge/website-textox.app-1f6feb?logo=safari&logoColor=white)](https://textox.app/zh/)
[![App Store](https://img.shields.io/badge/App_Store-下载-0d96f6?logo=apple&logoColor=white)](https://apps.apple.com/cn/app/textox-markdown-%E7%BC%96%E8%BE%91%E5%99%A8/id6762083180?mt=12)

[English](README.md) | **简体中文**

Textox 是一个本地优先的 Markdown 编辑器：极简设计、开箱即用，融合 IDE 的工作区理念，
基于 Tauri v2、React 与 ProseMirror 构建。

## 下载

| 平台 | 链接 |
| --- | --- |
| macOS（App Store） | [Textox Markdown 编辑器](https://apps.apple.com/cn/app/textox-markdown-%E7%BC%96%E8%BE%91%E5%99%A8/id6762083180?mt=12) — 完整版 |
| macOS（免费） | [Textox Lite](https://apps.apple.com/cn/app/textox-lite-markdown%E7%BC%96%E8%BE%91%E5%99%A8/id6777365755?mt=12) — App Store |
| Windows | [Microsoft Store](https://apps.microsoft.com/detail/9pm13wbd5ssc) |
| 其他渠道 | [GitHub Releases](https://github.com/textoxmd/textox/releases) — DMG / MSI / NSIS |
| 官网 | [textox.app](https://textox.app/zh/) |

## 特性

- **双模式编辑**：所见即所得（IR）与源码视图（SV），共享同一套撤销/重做历史
- **数学公式**：内置 MathJax，支持 LaTeX 与 mhchem
- **图表**：Mermaid 流程图、时序图、甘特图等
- **代码块**：语法高亮 + CodeMirror 编辑体验
- **表格 / 任务列表 / 脚注 / 高亮** 等 Markdown 扩展
- **白板**：基于 Excalidraw fork 的 `.excalidraw` 文件编辑与内嵌预览（由插件提供）
- **多主题**：多套编辑器主题与字体切换
- **图片粘贴**：粘贴即保存，可接入自定义图床插件
- **工作区**：侧边栏目录树、多窗口、文件内搜索
- **插件系统**：外部插件运行时 + 声明式扩展点
- **AI 能力**：可配置模型档案（BYO API Key），支持解释、翻译等插件
- **MCP 服务端**：本机回环的 MCP 接口，供外部 Agent 读写当前文档

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面容器 | Tauri v2（Rust） |
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS v4 |
| 编辑器 | ProseMirror（IR）、CodeMirror 6（SV） |
| 渲染/导出 | markdown-it、Mermaid、MathJax、highlight.js |
| 包管理 | Bun（唯一） |

## 环境要求

- [Bun](https://bun.sh) 1.2+
- Rust stable（rustup）+ Tauri 2 的系统依赖，见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- Node.js 20+（部分构建脚本使用）
- macOS 需要 Xcode Command Line Tools

## 快速开始

仓库依赖 4 个 git submodule，克隆时必须一并检出：

```sh
git clone --recurse-submodules https://github.com/textoxmd/textox.git
cd Textox

# 已克隆但缺少子模块时
git submodule update --init --recursive

bun install
(cd src-tauri && cargo fetch)
```

启动：

```sh
bun run app:dev      # 完整桌面应用（Tauri + Vite）
bun run dev          # 仅前端，浏览器访问 http://localhost:1420
```

## 构建与打包

所有构建都走统一入口，参数一致：`--edition full|lite`、`--platform macos|windows`、`--store`。

```sh
# 桌面开发（默认完整版；--edition lite 切 Lite）
bun run app:dev
bun run app:dev -- --edition lite

# 构建（macOS 默认 universal）
bun run app:build
bun run app:build -- --edition lite
bun run app:build -- --debug --no-sign

# 打包安装包（只区分渠道，格式由平台决定）
bun run app:package                 # 直接安装：macOS DMG / Windows MSI+NSIS
bun run app:package -- --edition lite
bun run app:package -- --store      # 应用商店：macOS PKG / Windows MSIX
```

> Windows 的免费版与付费版当前都提供完整功能，仅 bundle identifier 与商店条目不同。

可分发产物（DMG / PKG / MSIX）复制到 `out/`；MSI/NSIS 仍由 Tauri 输出在 `src-tauri/target/release/bundle/`。

`make` 只是薄别名（见 `make help`），逻辑全部在 `scripts/build/`。

### 代码签名与公证

仓库**不包含**任何 Apple 开发者证书、provisioning profile 或公证凭据，全部从环境变量读取。
两条渠道用的证书不同：

| 渠道 | 产物 | 证书 | 公证 |
|---|---|---|---|
| 直接分发（`app:package`） | DMG | `Developer ID Application` | 需要（自动完成） |
| App Store（`app:package -- --store`） | PKG | `Apple Distribution` + profile | 不需要 |

直接分发（DMG）：

```sh
export TEXTO_APP_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export TEXTO_APPLE_TEAM_ID="TEAMID"             # 可选：身份末尾已带 (TEAMID) 时可省略

# 公证凭据，任选一种：
export TEXTO_NOTARY_KEYCHAIN_PROFILE="notary"   # xcrun notarytool store-credentials notary
# 或 Apple ID + App 专用密码
export TEXTO_NOTARY_APPLE_ID="you@example.com"
export TEXTO_NOTARY_PASSWORD="abcd-efgh-ijkl-mnop"
# 或 App Store Connect API Key
export TEXTO_NOTARY_API_KEY="/path/to/AuthKey_XXXX.p8"
export TEXTO_NOTARY_API_KEY_ID="XXXX"
export TEXTO_NOTARY_API_ISSUER="xxxx-xxxx-xxxx"  # Team Key 必填

bun run app:package
```

流程：Tauri 用 Developer ID + Hardened Runtime 签 app（`src-tauri/entitlements-direct.plist`，
不启用沙盒）→ 生成 DMG → 给 DMG 补签名 → `notarytool submit --wait` → `stapler staple` →
`stapler validate` + `spctl` 校验。成功时输出「已公证并装订，可直接分发」。

没配证书/凭据时只告警并跳过（产物仅供本地测试）；设 `TEXTO_REQUIRE_NOTARIZATION=1`
可让缺凭据直接失败。`--no-sign` / `--no-notarize` 可显式跳过。

> 注意：`Apple Distribution` 与 `3rd Party Mac Developer` 证书**不能**用于公证，
> 脚本检测到身份不是 `Developer ID Application` 时会跳过（强制模式下直接报错）。

商店（PKG）构建还需把 `embedded.provisionprofile` / `embedded.provisionprofile.lite`
放到 `src-tauri/`（已 gitignore），并使用 Apple Distribution 证书。

`src-tauri/entitlements*.plist` 中用 `YOUR_TEAM_ID` 占位，构建脚本会把真实团队 ID 替换后写入
`src-tauri/target/entitlements.<edition>.plist` 再交给 `codesign`，因此仓库里不含任何团队 ID。

### 崩溃上报

仓库不内置 Sentry DSN，从源码构建的版本不会上报数据。官方构建通过编译期环境变量注入：

```sh
SENTRY_DSN="https://<key>@<host>/<project>" bun run app:build
```

## 在 GitHub Actions 上构建

仓库带两个工作流：

| 工作流 | 触发 | 作用 |
|---|---|---|
| `ci.yml` | push（main / develop）、PR | 类型检查、架构守卫、前后端测试、`cargo check` / `clippy` |
| `build.yml` | 手动 `Run workflow`、推送 `v*` 标签 | 产安装包：macOS DMG（full / lite，universal）+ Windows MSI/NSIS |

手动运行时可选 `edition`（`both` / `full` / `lite`）与 `store`（macOS 出 PKG 而非 DMG）。
推送 `v*` 标签会额外把产物附加到一个 **draft release**，确认无误后手动发布。

**不配置任何 secret 也能跑**，产物为未签名安装包，适合内部测试。正式分发需要在
仓库 Settings → Secrets and variables → Actions 中配置：

| Secret | 用途 |
|---|---|
| `APPLE_CERTIFICATE_P12` | **Developer ID Application** 证书 `.p12` 的 base64（`base64 -i cert.p12 \| pbcopy`） |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` 密码 |
| `TEXTO_APP_SIGNING_IDENTITY` | 如 `Developer ID Application: Your Name (TEAMID)` |
| `TEXTO_APPLE_TEAM_ID` | 可选；团队 ID，缺省从签名身份的 `(TEAMID)` 解析 |
| `TEXTO_NOTARY_APPLE_ID` | 公证用 Apple ID |
| `TEXTO_NOTARY_PASSWORD` | 公证用 App 专用密码 |
| `TEXTO_NOTARY_API_KEY` | 可选；App Store Connect API Key 的 `.p8` 内容（base64），替代上面两项 |
| `TEXTO_NOTARY_API_KEY_ID` | 对应 Key ID |
| `TEXTO_NOTARY_API_ISSUER` | 对应 Issuer ID（Team Key 必填） |
| `APPLE_PROVISION_PROFILE` / `APPLE_PROVISION_PROFILE_LITE` | 仅 `store` 渠道：profile 的 base64 |
| `TEXTO_INSTALLER_SIGNING_IDENTITY` | 仅 `store` 渠道：`3rd Party Mac Developer Installer: ...` |

配置了**证书 + 公证凭据**后，DMG 会自动签名、公证并 staple；推送 `v*` 标签时还会强制校验
（缺凭据直接失败），保证 release 里只有能直接双击打开的包。`store` 渠道仍需换成
Apple Distribution 证书，且不需要公证。entitlements 里的团队 ID 在构建时注入，仓库中只有
`YOUR_TEAM_ID` 占位，无需手改。Windows 目前没有接入代码签名，MSI/NSIS 会被 SmartScreen 提示。

#### 怎么准备这些 secret

1. **Developer ID 证书**：钥匙串访问 → 证书助理 → *从证书颁发机构请求证书*，拿到 CSR 后在
   [developer.apple.com](https://developer.apple.com/account/resources/certificates) 申请
   *Developer ID Application*，下载安装后**连私钥一起**导出为 `.p12`。
2. **公证凭据**：以下两种任选其一。
   - **Apple ID + App 专用密码**（最简单；个人开发者账号没有 *团队密钥* 入口时用这个）：
     登录 [appleid.apple.com](https://appleid.apple.com) → *登录与安全* → *App 专用密码* →
     新建一个（名字随意，如 `notarytool`）。`notarytool` 在 CI 里用它不需要二次验证。
   - **App Store Connect API Key**（只有账号持有人 / 管理员能看到 *用户和访问 → 集成 →
     团队密钥*）：新建一把角色为 **Developer ID** 的密钥，下载 `AuthKey_XXXX.p8`（只能下一次），
     记下 Key ID 与列表顶部的 Issuer ID。
3. 写入 secret（本机已 `gh auth login` 且有仓库管理员权限即可）：

```sh
REPO=textoxmd/textox

# 证书（base64；工作流会自己剥掉换行）
base64 -i DeveloperID.p12 | gh secret set APPLE_CERTIFICATE_P12 -R "$REPO"
gh secret set APPLE_CERTIFICATE_PASSWORD -R "$REPO" --body 'p12 密码'
gh secret set TEXTO_APP_SIGNING_IDENTITY -R "$REPO" \
  --body 'Developer ID Application: Your Name (TEAMID)'
gh secret set TEXTO_APPLE_TEAM_ID -R "$REPO" --body 'TEAMID'

# 公证，方案 A：Apple ID + App 专用密码（推荐）
gh secret set TEXTO_NOTARY_APPLE_ID -R "$REPO" --body 'you@example.com'
gh secret set TEXTO_NOTARY_PASSWORD -R "$REPO" --body 'abcd-efgh-ijkl-mnop'

# 公证，方案 B：App Store Connect API Key
# base64 -i AuthKey_XXXXXXXXXX.p8 | gh secret set TEXTO_NOTARY_API_KEY -R "$REPO"
# gh secret set TEXTO_NOTARY_API_KEY_ID -R "$REPO" --body 'XXXXXXXXXX'
# gh secret set TEXTO_NOTARY_API_ISSUER -R "$REPO" --body 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
```

先跑一次 *Actions → Build → Run workflow*（`store = false`）验证，不产生 release。产物下来后本地检查：

```sh
spctl -a -vvv -t open --context context:primary-signature Textox-*.dmg
xcrun stapler validate Textox-*.dmg
```

注意事项：

- macOS runner 按 10 倍时长计费，私有仓库请留意额度；可在 fork 里只跑 `full`。
- 未签名 DMG 在别的机器上会被 Gatekeeper 拦，右键打开或 `xattr -dr com.apple.quarantine Textox.app`。
- 公证未配置时会降级为未签名/未公证产物；正式发布请配齐证书与公证凭据（tag 构建会强制校验）。
- `bun.lock` 只记录 `registry.npmjs.org`；本地用镜像安装后请还原 lockfile 再提交。

## 测试与检查

```sh
bun run typecheck                              # 全仓类型检查
bun run test:plugins                           # 插件/骨架契约单测
bun run check:skeleton                         # 骨架不得出现插件专属字面量
bun run check:editor-boundary                  # 编辑器不得 import 骨架
bun run check:version                          # 三处版本号一致

# 编辑器行为测试（spec 驱动）
bunx vitest run --config src/components/TextoEditor/vitest.config.ts

make check                                     # 前端 + Rust 全量检查
make check-rust                                # cargo check + clippy -D warnings
```

## 目录结构

```
src/                      React 前端（@/ → src/）
  components/TextoEditor/ ProseMirror 编辑器（独立 tsconfig / vitest config）
  plugins/                插件运行时、注册表与宿主能力
  agent/                  AI 模型配置与 runtime
src-tauri/                Tauri v2 Rust 后端（含 MCP 服务端）
packages/                 内部 workspace 包（app-api、plugin-sdk、export-runtime 等）
test-fixtures/plugins/    第一方插件测试夹具（不进生产包）
vendor/                   git submodule（excalidraw / translations / plugin-sdk / mkdext）
scripts/build/            统一构建入口（dev / build / package）
docs/                     插件开发、运行时与图标规范
openspec/                 变更提案与规格
```

## 插件开发

插件契约见 [`vendor/plugin-sdk`](vendor/plugin-sdk)，构建工具为 `@textox/plugin-build`。
详细文档：[docs/plugin-development.md](docs/plugin-development.md)、
[docs/plugin-runtime.md](docs/plugin-runtime.md)、[docs/plugin-icon-spec.md](docs/plugin-icon-spec.md)。

## 贡献

欢迎提交 issue 与 PR，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 与
[行为准则](CODE_OF_CONDUCT.zh-CN.md)（[English](CODE_OF_CONDUCT.md)）。分支策略：功能开发基于 `develop`，`main` 用于发布。

## 安全

安全问题请勿公开提交，见 [SECURITY.md](SECURITY.md)。

## 许可证

本项目以 [GNU Affero General Public License v3.0 or later](LICENSE) 发布。
`Textox` 名称、Logo 与图标不在授权范围内，见 [NOTICE](NOTICE)。

第三方组件的版权与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
（MathJax 的 Apache-2.0 文本位于 [public/mathjax/LICENSE](public/mathjax/LICENSE)）。
