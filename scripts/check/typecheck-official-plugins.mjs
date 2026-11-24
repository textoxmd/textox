#!/usr/bin/env node
// 目录驱动的插件类型检查：遍历第一方插件（`official-plugins/*`）、测试夹具插件
// （`test-fixtures/plugins/*`）、v1 外置插件（`official-v1-plugins/*`）与示例插件
// （`plugin-samples/*`）下的 `tsconfig.json`，逐个运行 `tsc -p <path> --noEmit`。
//
// 这样某个插件目录被删除（或新增）时，根 package.json 的 typecheck 脚本无需
// 改动即可自动跳过/纳入。插件存在时其 tsconfig 仍会被完整检查（不会为了
// 「能删目录」而放弃对现有插件的类型检查）。
//
// 全部通过退出 0；任一失败退出 1。
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const PLUGIN_ROOTS = [
  'official-plugins',
  'test-fixtures/plugins',
  'official-v1-plugins',
  'plugin-samples',
];

function collectTsconfigs(root) {
  const dir = join(ROOT, root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name, 'tsconfig.json'))
    .filter((path) => existsSync(path));
}

const tsconfigs = PLUGIN_ROOTS.flatMap(collectTsconfigs).sort();

if (tsconfigs.length === 0) {
  console.log('[typecheck-official-plugins] 未发现插件 tsconfig，跳过');
  process.exit(0);
}

// 用 bun 运行本地 tsc（typescript 为 devDependency，bun 是唯一包管理器）。
// Windows 下 bunx 是 .cmd，须经 shell 才能启动。
const IS_WIN = process.platform === 'win32';

let failed = false;
for (const tsconfig of tsconfigs) {
  const rel = relative(ROOT, tsconfig);
  try {
    execFileSync('bunx', ['tsc', '-p', rel, '--noEmit'], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: IS_WIN,
    });
    console.log(`[typecheck-official-plugins] ✓ ${rel}`);
  } catch {
    console.error(`[typecheck-official-plugins] ✗ ${rel}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
