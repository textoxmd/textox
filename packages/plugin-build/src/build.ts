import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SHARED_MODULES } from '@textox/plugin-sdk';
import { build as viteBuild } from 'vite';

import { isExternal } from './external.js';
import { buildManifest, type PluginConfig } from './manifest.js';
import { assertPluginIcon, findAutoIcon, isIconAsset } from './icon.js';

export interface BuildResult {
  outDir: string;
}

const REACT_INTERNALS_MARKER = '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED';

/** CSS 固定叫 `styles.css`，其余产物走带哈希的 `assets/`。 */
export function assetFileName(assetInfo: { names?: string[] }): string {
  return assetInfo.names?.some((name) => name.endsWith('.css'))
    ? 'styles.css'
    : 'assets/[name]-[hash][extname]';
}

/**
 * 构建产物必须是单个 `main.js`：插件运行时用 blob URL 载入它，
 * 任何额外 chunk 都会被解析成 blob 下的相对路径而 fetch 失败。
 * 注意：Rollup 在 lib 模式下给拆出的 chunk 用 `.mjs` 扩展名，两种都要统计。
 *
 * 入参必须是 `scriptFiles(readdirSync(outDir))` 的结果；只覆盖 `dist/` 顶层
 * （lib 模式产物都在顶层，嵌套 `assets/*.js` 不在此检查范围）。
 */
export function assertSingleJsFile(jsFiles: string[]): void {
  if (jsFiles.length > 1) {
    throw new Error(
      `plugin build produced multiple js files (main.js + ${jsFiles
        .filter((file) => file !== 'main.js')
        .join(', ')}); dynamic imports must be inlined`,
    );
  }
}

/** 共享模块在 `node_modules` 下的包目录：裸模块 → `node_modules/<name>/`，作用域包 → `node_modules/<scope>/<name>/`。 */
function nodeModulesPrefix(specifier: string): string {
  const segments = specifier.split('/');
  // `react/jsx-runtime` 这类子路径归到 `react/`：同一份 node_modules 目录
  const pkg = specifier.startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0];
  return `node_modules/${pkg}/`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 共享模块必须保持 external：产物 chunk 里出现它们即说明被内联，运行时会出现双实例。
 *
 * 标记从 `SHARED_MODULES` 派生而不是手写清单：两边漂移时守卫会静默失效
 * （`@tauri-apps/api/*` 与 `@texto/export-runtime` 就曾被手写清单漏掉）。
 * 另外保留两条源码路径：经 `file:` 依赖直接引用 SDK 源码时不是 node_modules 路径。
 */
const SHARED_MARKERS = new RegExp(
  `\\/(?:${[
    // 去重：`react` 与 `react/jsx-runtime` 派生同一目录
    ...new Set(SHARED_MODULES.map(nodeModulesPrefix)),
    '@textox/plugin-sdk/src/',
    '@textox/plugin-sdk/dist/',
    '@texto/plugin-sdk/src/',
  ]
    .map(escapeRegExp)
    .join('|')})`,
);

/** 共享模块必须保持 external：产物 chunk 里出现它们即说明被内联，运行时会出现双实例。 */
export function assertNoSharedCode(
  outputs: Array<{ type: string; modules?: Record<string, unknown> }>,
): void {
  for (const item of outputs) {
    if (item.type !== 'chunk' || !item.modules) continue;
    const offenders = Object.keys(item.modules).filter((id) => SHARED_MARKERS.test(id));
    if (offenders.length > 0) {
      throw new Error(`plugin bundle inlined shared modules: ${offenders.slice(0, 5).join(', ')}`);
    }
  }
}

/**
 * 产物里不得残留未经保护地读取 `process.env`（WebView 没有 `process`，
 * 模块求值即抛 `Can't find variable: process`）。
 *
 * 只匹配 `process.env.<ident>`，因为这是唯一会无条件求值、一装就崩的写法：
 * - 裸 `process` / `process?` / `"process"` 是字符串或属性名，会误报；
 * - `typeof process === 'object' && process.versions` 这类特性探测是合法的
 *   （excalidraw 依赖 emscripten woff2 glue，浏览器下该分支不执行）。
 */
export function assertNoNodeGlobals(scriptSource: string): void {
  const remaining = scriptSource.match(/\bprocess\.env\.[A-Za-z_$]+/g);
  if (remaining) {
    throw new Error(
      `plugin bundle still reads process.env: ${[...new Set(remaining)].join(
        ', ',
      )}; add a define in @textox/plugin-build or avoid Node-only code`,
    );
  }
}

/** 统计产物里的可执行 chunk（`.js` 与 `.mjs`）。 */
export function scriptFiles(files: string[]): string[] {
  return files.filter((file) => file.endsWith('.js') || file.endsWith('.mjs'));
}

/**
 * 把插件自带的图标资源复制进产物目录。
 *
 * 查找顺序：`assets/<file>` → 项目根 `<file>`；产物里已有同名文件时不动（允许构建脚本自行处理）。
 */
function materializeIcon(icon: string | undefined, pluginDir: string, outDir: string): void {
  if (!icon || !isIconAsset(icon)) return;
  const name = path.basename(icon);
  const target = path.join(outDir, name);
  if (existsSync(target)) return;
  const source = [path.join(pluginDir, 'assets', name), path.join(pluginDir, name)].find((item) =>
    existsSync(item),
  );
  if (source) copyFileSync(source, target);
}

/** 用 Vite 库模式构建插件：单个 `main.js`（ESM），共享模块保持 external。 */
export async function buildPlugin(
  pluginDir: string,
  config: PluginConfig,
  builtAgainst: Record<string, string> = {},
): Promise<BuildResult> {
  const outDir = path.join(pluginDir, 'dist');
  const buildResult = await viteBuild({
    configFile: false,
    root: pluginDir,
    logLevel: 'warn',
    resolve: {
      alias: {
        // 指向插件自身的 src（插件不得依赖宿主骨架，骨架也不该被插件 alias 到）
        '@': path.join(pluginDir, 'src'),
      },
    },
    esbuild: { jsx: 'automatic' },
    define: {
      // 插件跑在 WebView 里，没有 Node 的 process；常见依赖（radix-ui、excalidraw 等）
      // 仍会读 process.env.NODE_ENV。只替换这一个键：Vite 6 的 define 不接受 `({})`
      // 这类表达式值（报 `Invalid define value`），而其它 process.* 会由
      // `assertNoNodeGlobals` 在构建后拦下（失败要响，不能静默带病发布）。
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    build: {
      outDir,
      emptyOutDir: true,
      minify: true,
      target: 'es2022',
      cssCodeSplit: false,
      lib: {
        entry: path.join(pluginDir, 'src/index.ts'),
        formats: ['es'],
        fileName: () => 'main.js',
      },
      rollupOptions: {
        external: isExternal,
        output: {
          assetFileNames: assetFileName,
          // 插件运行时只按 blob 载入 main.js，所以产物必须是单文件；
          // 否则动态 import 会被拆成相对 chunk，blob URL 下解析不到。
          inlineDynamicImports: true,
        },
      },
    },
  });

  const mainPath = path.join(outDir, 'main.js');
  if (!existsSync(mainPath)) {
    throw new Error(`build produced no main.js (${config.id})`);
  }
  assertSingleJsFile(scriptFiles(readdirSync(outDir)));
  // 现有用例会 mock 掉 viteBuild（返回 undefined），这里容忍空结果；
  // 共享模块被内联时产物仍是单文件，`assertSingleJsFile` 拦不住，需要看 Rollup 的模块图
  const results = buildResult ? (Array.isArray(buildResult) ? buildResult : [buildResult]) : [];
  const outputs = results.flatMap((item) => ('output' in item ? item.output : []));
  assertNoSharedCode(outputs);
  const source = readFileSync(mainPath, 'utf8');
  assertNoNodeGlobals(source);
  if (source.includes(REACT_INTERNALS_MARKER)) {
    console.warn(
      '[plugin-build] main.js appears to bundle React internals; react should stay external',
    );
  }

  // 图标：`assets/icon.*` / 根 `icon.*` 自动识别并复制进 dist，显式声明的资源路径同样生效。
  // 作者只需要把文件放对位置，清单里的 `icon` 可以不写（见 docs/plugin-icon-spec.md）。
  const icon = findAutoIcon(pluginDir, existsSync) ?? config.icon;
  materializeIcon(icon, pluginDir, outDir);
  assertPluginIcon(icon, outDir);

  // emptyOutDir 会清空 dist，因此 manifest 必须在构建之后写
  writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(buildManifest(icon ? { ...config, icon } : config, builtAgainst), null, 2),
  );

  return { outDir };
}
