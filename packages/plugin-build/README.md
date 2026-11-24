# @textox/plugin-build

Textox 外置插件（v1 运行时）的构建工具：把 `plugin.config.ts` + `src/index.ts` 打成单个
`main.js`，生成 `manifest.json`，并打包为可分发的 `.zip` 插件包。

## 安装

```sh
bun add -d @textox/plugin-build
# 或 npm install -D @textox/plugin-build
```

> CLI 首行是 `#!/usr/bin/env bun`，请用 Bun 执行（`bunx texto-plugin ...`）。
> monorepo（Textox 主仓库）内 `bun run plugin` 直接跑源码 `packages/plugin-build/src/cli.ts`；发布版通过 `@textox/plugin-build` 提供。

## 用法

```sh
bunx texto-plugin build <pluginDir>   # 构建到 <pluginDir>/dist（main.js + manifest.json + styles.css）
bunx texto-plugin pack  <pluginDir>   # 构建并打包为 <pluginDir>/dist/<id>-<version>.zip
bunx texto-plugin dev   <pluginDir>   # 只构建一次（不做 watch）
```

也可以在自己的脚本里调用：

```ts
import { buildPlugin, packPluginFiles, manifestFileName } from '@textox/plugin-build';
```

## `plugin.config.ts`

```ts
export default {
  id: 'com.example.my-plugin',    // Java 包式 id，3–8 段，小写
  name: 'My Plugin',
  version: '1.0.0',
  minAppVersion: '2.3.8',         // 兼容的最低宿主版本
  description: '可选',
  author: { name: 'Acme', id: 'acme' },
  category: 'editor',             // 可选：设置页分组
  icon: 'sparkles',               // 可选：lucide 图标名
  defaultEnabled: false,          // 可选
  isDesktopOnly: false,           // 可选
};
```

构建时用宿主契约校验；非法 id / 缺字段会直接失败（例如 `invalid plugin config: invalid-id (too-few-segments)`）。

## 产物结构

```
<pluginDir>/dist/
├── main.js         # 单文件 ESM bundle（动态 import 会被内联）
├── manifest.json   # 由 plugin.config.ts 生成（含 builtAgainst 真实版本）
├── styles.css      # 若插件引入了 CSS
└── <id>-<version>.zip   # pack 产物（顶层目录 = 插件 id）
```

安装后落到 `<appData>/plugins/<插件 id>/`；宿主通过 import map 提供
`react` / `react-dom` / `prosemirror-*` / `i18next` / `@textox/plugin-sdk` 等共享模块，
这些在 bundle 中保持 external（由契约包的 `SHARED_MODULES` 决定）。

## 与 `@textox/plugin-sdk` 的版本锁步

本包的 external 判定与 manifest 校验直接依赖 `@textox/plugin-sdk` 的 `SHARED_MODULES`
与 `validateManifest`。**升级 `@textox/plugin-sdk` 时请同步升级本包**，并在插件仓库里
同时升级两者，避免宿主 import map 与插件 external 列表漂移。
