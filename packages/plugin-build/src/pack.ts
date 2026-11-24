import path from 'node:path';
import { zipSync } from 'fflate';

import { buildManifest, type PluginConfig } from './manifest.js';
import { isIconAsset } from './icon.js';

/** 产物文件名：`<id>-<version>.zip`（zip 容器）。 */
export function manifestFileName(config: Pick<PluginConfig, 'id' | 'version'>): string {
  return `${config.id}-${config.version}.zip`;
}

/** 打包产物的默认落盘位置：`<pluginDir>/dist/<id>-<version>.zip`。 */
export function packPluginPath(
  pluginDir: string,
  config: Pick<PluginConfig, 'id' | 'version'>,
): string {
  return path.join(pluginDir, 'dist', manifestFileName(config));
}

function isUnsafePath(p: string): boolean {
  if (/^([/\\]|[A-Za-z]:)/.test(p)) return true;
  return p.split(/[\\/]+/).some((segment) => segment === '..');
}

/** 产物根目录里的约定图标文件（`icon.svg` / `icon.png` …）。 */
function conventionalIcon(files: Record<string, Uint8Array>): string | undefined {
  return Object.keys(files).find((file) => !file.includes('/') && isIconAsset(file));
}

/**
 * 把构建产物打成 `.zip`（插件包）：顶层目录固定为插件 id，附 `manifest.json`。
 * `*.zip` 一律跳过（防止把上一次的产物打进去），越界路径直接拒绝。
 */
export function packPluginFiles(
  config: PluginConfig,
  files: Record<string, Uint8Array>,
  builtAgainst: Record<string, string> = {},
): Uint8Array {
  if (!('main.js' in files)) {
    throw new Error('package is missing main.js');
  }
  const entries: Record<string, Uint8Array> = {};
  for (const [relPath, bytes] of Object.entries(files)) {
    if (isUnsafePath(relPath)) {
      throw new Error(`unsafe package path: ${relPath}`);
    }
    if (relPath.endsWith('.zip')) continue;
    entries[`${config.id}/${relPath}`] = bytes;
  }
  // 图标可能来自「按约定放文件」而非 `plugin.config.ts`：打包时从产物里补回清单，
  // 否则 zip 里的 manifest 会丢掉自动识别的 `icon`，安装后显示回退图标。
  const manifest = buildManifest(config, builtAgainst);
  const icon = manifest.icon ?? conventionalIcon(files);
  entries[`${config.id}/manifest.json`] = new TextEncoder().encode(
    JSON.stringify(icon ? { ...manifest, icon } : manifest, null, 2),
  );
  return zipSync(entries, { level: 6 });
}
