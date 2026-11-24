#!/usr/bin/env bun
// 注意：`bin` 依赖本文件的 `#!/usr/bin/env bun` 与 Bun 的 TS 直跑能力，
// 仅支持 `bun run packages/plugin-build/src/cli.ts` 这类用法（Node 下不可用）。
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  collectBuiltAgainst,
  createVersionResolver,
} from './built-against.js';
import { buildPlugin } from './build.js';
import type { PluginConfig } from './manifest.js';
import { packPluginFiles, packPluginPath } from './pack.js';

const USAGE = `用法：
  bun run plugin build <pluginDir>   构建插件到 <pluginDir>/dist
  bun run plugin pack <pluginDir>    构建并打包为 <pluginDir>/dist/<id>-<version>.zip
  bun run plugin dev <pluginDir>     构建一次（运行期需重启宿主，不做 watch）

也可直接运行：bun run packages/plugin-build/src/cli.ts <command> <pluginDir>`;

async function loadConfig(pluginDir: string): Promise<PluginConfig> {
  const configPath = path.join(pluginDir, 'plugin.config.ts');
  try {
    const module = (await import(pathToFileURL(configPath).href)) as { default?: PluginConfig };
    if (!module.default) throw new Error('default export is missing');
    return module.default;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to load ${configPath}: ${reason}`);
  }
}

function readDependencies(pluginDir: string): Record<string, string> {
  try {
    const text = readFileSync(path.join(pluginDir, 'package.json'), 'utf8');
    const pkg = JSON.parse(text) as { dependencies?: Record<string, string> };
    return pkg.dependencies ?? {};
  } catch {
    return {};
  }
}

/** 递归读取 dist，返回以 `/` 分隔的相对路径（跳过上次打包留下的 `.zip`）。 */
function readDistFiles(dir: string, prefix = ''): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const relPath = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(fullPath).isDirectory()) {
      Object.assign(files, readDistFiles(fullPath, relPath));
      continue;
    }
    if (relPath.endsWith('.zip')) continue;
    files[relPath] = new Uint8Array(readFileSync(fullPath));
  }
  return files;
}

async function main(argv: string[]): Promise<void> {
  const [command, pluginDir] = argv;
  if (!command || !pluginDir || !['build', 'pack', 'dev'].includes(command)) {
    console.error(USAGE);
    process.exit(1);
  }
  const absoluteDir = path.resolve(pluginDir);
  const config = await loadConfig(absoluteDir);
  const builtAgainst = collectBuiltAgainst(
    readDependencies(absoluteDir),
    createVersionResolver(absoluteDir),
  );

  const { outDir } = await buildPlugin(absoluteDir, config, builtAgainst);
  if (command === 'build') {
    console.log(`built ${config.id} -> ${outDir}`);
    return;
  }
  if (command === 'dev') {
    console.log(`built ${config.id} -> ${outDir}（dev 模式只构建一次，修改后请重新运行）`);
    return;
  }

  const files = readDistFiles(outDir);
  const archive = packPluginFiles(config, files, builtAgainst);
  const packagePath = packPluginPath(absoluteDir, config);
  writeFileSync(packagePath, archive);
  console.log(`packed ${config.id} -> ${packagePath} (${archive.byteLength} bytes)`);
}

async function run(): Promise<void> {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if ((import.meta as { main?: boolean }).main) {
  void run();
}
