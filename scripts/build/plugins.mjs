// 插件产物汇总：把各来源的插件 `dist` 产物收集到 `src-tauri/resources/plugins`，
// 供 Tauri 打包进应用资源目录（运行时由 `plugins::seed` 播到用户数据目录）。
//
// 三个来源，后者按 id 覆盖前者：
//   1. `<repo>/plugins`                 —— 在树插件
//   2. `<repo>/vendor/plugins`          —— submodule
//   3. `<repo>/plugin-sources.local.json` —— 本地映射 `{ "<id>": "<相对仓库根路径>" }`（gitignored）
//
// 任一来源缺失都不报错（开发环境常见）；单个插件没有 `manifest.json` 只告警跳过。
//
// 用法：
//   node scripts/build/plugins.mjs
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT } from './lib.mjs';

const MANIFEST = 'manifest.json';

/** `plugins` / `vendor/plugins` 目录下的一级子目录（可能存在）即为插件候选。 */
function pluginDirs(root) {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** 按顺序取第一个含 `manifest.json` 的候选目录。 */
function resolveDist(candidates) {
  for (const candidate of candidates) {
    if (existsSync(join(candidate, MANIFEST))) return candidate;
  }
  return null;
}

/**
 * 插件的真实 id 以清单元数据为准：submodule 目录常是仓库名（如 `mkdext`），
 * 与插件 id（`app.textox.mkdext`）不同，用目录名会让播种按非法 id 跳过。
 */
function manifestId(dir) {
  try {
    const value = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8'));
    return typeof value?.id === 'string' && value.id.length > 0 ? value.id : null;
  } catch {
    return null;
  }
}

/** 本地映射文件：缺失、坏 JSON 都当作空映射。 */
function readLocalMap(repoRoot) {
  const file = join(repoRoot, 'plugin-sources.local.json');
  if (!existsSync(file)) return {};
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (error) {
    console.warn(`⚠️  plugin-sources.local.json 解析失败，已忽略：${error.message}`);
    return {};
  }
}

/**
 * 合并来源：同一 id 后者覆盖前者（repo → vendor → local）。
 * 保留首次出现的顺序位（先出现的位置），内容取最后一次。
 */
export function mergeSources(entries) {
  const byId = new Map();
  for (const entry of entries) {
    byId.set(entry.id, entry);
  }
  return [...byId.values()];
}

/**
 * 收集所有可用来源里的插件产物目录。
 * @returns {{ id: string, dir: string, from: 'repo' | 'vendor' | 'local' }[]}
 */
export function collectSources({ repoRoot = ROOT } = {}) {
  const entries = [];

  for (const [source, from] of [
    [join(repoRoot, 'plugins'), 'repo'],
    [join(repoRoot, 'vendor', 'plugins'), 'vendor'],
  ]) {
    for (const folder of pluginDirs(source)) {
      const base = join(source, folder);
      const dir = resolveDist([join(base, 'dist', folder), join(base, 'dist'), base]);
      if (!dir) {
        console.warn(`⚠️  跳过 ${from} 插件 ${folder}：找不到 manifest.json`);
        continue;
      }
      entries.push({ id: manifestId(dir) ?? folder, dir, from });
    }
  }

  for (const [id, mapped] of Object.entries(readLocalMap(repoRoot))) {
    // 允许绝对路径：插件仓常在仓库外（如 textoxmd/）
    const base = resolve(repoRoot, String(mapped));
    const dir = resolveDist([join(base, 'dist', id), join(base, 'dist'), base]);
    if (!dir) {
      console.warn(`⚠️  跳过 local 插件 ${id}：${base} 下找不到 manifest.json`);
      continue;
    }
    entries.push({ id: manifestId(dir) ?? id, dir, from: 'local' });
  }

  return mergeSources(entries);
}

/**
 * 清空并重建 `src-tauri/resources/plugins`，复制每个插件的产物目录。
 * @returns {string[]} 实际写出的插件 id（排序后）
 */
export function buildPluginResources({ repoRoot = ROOT } = {}) {
  const out = join(repoRoot, 'src-tauri', 'resources', 'plugins');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const written = [];
  for (const { id, dir } of collectSources({ repoRoot })) {
    cpSync(dir, join(out, id), { recursive: true });
    written.push(id);
  }
  written.sort();
  console.log(`📦 插件资源：${written.length} 个 → ${out}`);
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildPluginResources();
}
