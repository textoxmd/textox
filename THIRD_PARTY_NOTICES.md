# 第三方组件与许可

Textox 以 AGPL-3.0-or-later 发布（见 `LICENSE`）。本项目包含或分发以下第三方组件，
它们的版权归各自作者所有，并按下列许可证提供。

本文件不是完整的依赖清单。安装依赖后，每个 npm / Cargo 包自带的许可证文本位于
`node_modules/<包名>/LICENSE*` 与 `~/.cargo/registry/src/*/<crate>/LICENSE*`；
发布二进制时应同时附带这些文本（见文末「发布检查」）。

## 随仓库分发的第三方代码与资产

### Excalidraw（修改过的分支）

- 位置：`vendor/excalidraw`（git submodule，`textoxmd/excalidraw` 的 `textox-0.18.1` 分支）
- 许可证：MIT，Copyright (c) 2020 Excalidraw。原始版权声明保留在
  `vendor/excalidraw/LICENSE`，修改后的代码同样以 MIT 提供。
- 说明：Textox 维护了一个 Excalidraw 分支，包含对白板嵌入、主题、构建产物的修改。
  白板能力由**独立插件**提供，插件在自己的产物里打包 `@excalidraw/*`；应用本体
  不再 import Excalidraw，仓库根 `package.json` 只保留指向该子模块的 `overrides`，
  供插件在本地或 CI 中构建时使用。
- 分发义务：只有在**分发该白板插件**（插件仓库、`dist` 目录或打包后的 zip）时，
  MIT 才要求在分发包中附带上述版权声明与许可证全文；仅克隆本仓库时，
  子模块自带的 `LICENSE` 已满足要求。应用本体不打包 Excalidraw。
- 字体：该目录同时包含 Excalidraw 上游分发的字体文件（Excalifont、Virgil、Nunito、
  Cascadia、Comic Shanns、Assistant、Lilita One、Xiaolai、Liberation Sans 等），
  其许可证随 Excalidraw 上游提供，多为 SIL Open Font License 1.1 或 MIT。
  若插件产物包含这些字体，同样需随插件附带对应字体许可证。

### MathJax

- 位置：`public/mathjax/tex-svg.min.js`、`public/mathjax/mhchem.js`、`public/mathjax/input/`
- 许可证：Apache License 2.0，Copyright (c) 2009-2022 The MathJax Consortium
- 完整许可证文本：`public/mathjax/LICENSE`
- 版本：MathJax 3.2.2（含 mhchem 扩展）

## 主要运行期依赖

| 组件 | 许可证 |
| --- | --- |
| Tauri（Rust 与 `@tauri-apps/*`） | MIT 或 Apache-2.0 |
| React / React DOM | MIT |
| ProseMirror 系列 | MIT |
| CodeMirror 系列（含 `@codemirror/*`、`@uiw/*` 主题） | MIT |
| markdown-it 及插件 | MIT |
| Mermaid | MIT |
| highlight.js | BSD-3-Clause |
| MathJax | Apache-2.0 |
| KaTeX（仅类型/存根，不参与渲染） | MIT |
| Radix UI / Base UI / shadcn/ui | MIT |
| React Aria Components | Apache-2.0 |
| Tailwind CSS / tw-animate-css | MIT |
| i18next / react-i18next | MIT |
| lucide-react | ISC |
| sonner / cmdk / culori / css-tree / punycode.js | MIT |
| streamdown 及其 CJK 扩展 | Apache-2.0 |
| `@earendil-works/pi-ai`、`pi-agent-core` | MIT |

## 插件 SDK 与构建工具

以下包是独立发布的开源项目，不属于应用本体：

- `vendor/plugin-sdk`（`@textox/plugin-sdk`）：MIT
- `packages/plugin-build`（`@textox/plugin-build`）：MIT

## 构建期依赖

- `sharp` / `@img/sharp-libvips`：Apache-2.0 / LGPL-3.0-or-later。仅在构建阶段（图标生成）
  使用，不进入分发包，因此不触发 LGPL 的静态链接义务。
- 其余构建工具（Vite、TypeScript、Vitest、happy-dom）均为 MIT。

## 应用内鸣谢

应用「设置 → 关于 → 鸣谢」展示主要开源项目列表，内容在
`src/components/defaultAcknowledgments.ts`。该文案只是概览，不替代本文件与各包的
许可证文本。

## 发布检查（维护者）

发布安装包前请确认：

1. 打包产物内包含 `LICENSE`、`NOTICE`、本文件与 `public/mathjax/LICENSE`；
2. 生成完整的依赖许可证清单（例如 `bunx license-checker-rseidelsohn --production`），
   并随安装包或下载页提供；
3. 若新增随仓库分发的第三方代码/字体/二进制，在本文件中登记其来源与许可证。
4. 若单独发布或随安装包附带插件（例如 Excalidraw 白板插件），在插件的分发包中
   附带其打包进产物的第三方许可证与版权声明（见上文「分发义务」）。
