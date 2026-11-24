// 构建脚本共享工具：路径、参数解析、子进程执行。
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

/**
 * 极简参数解析：`--key value` / `--flag` / `--no-flag`，位置参数进 `_`。
 * 不做类型推断，调用方按需转换。
 */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key.startsWith('no-')) {
      out[key.slice(3)] = false;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

/**
 * 同步执行命令；失败时打印命令并以相同退出码退出。
 * `env` 会与当前进程环境合并，值为 `undefined` 的键会被移除。
 */
export function run(command, args = [], options = {}) {
  const { env: extraEnv, ...rest } = options;
  const env = { ...process.env, ...extraEnv };
  for (const [key, value] of Object.entries(extraEnv ?? {})) {
    if (value === undefined) delete env[key];
  }
  console.log(`  $ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env,
    ...rest,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

export function readJson(relativePath) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8'));
}

/** 版本号唯一来源：src-tauri/tauri.conf.json。 */
export function appVersion() {
  const version = readJson('src-tauri/tauri.conf.json').version;
  if (!version) fail('src-tauri/tauri.conf.json 缺少 version 字段');
  return version;
}

export const EDITIONS = new Set(['full', 'lite']);

export function assertEdition(edition) {
  if (!EDITIONS.has(edition)) {
    fail(`未知 edition: ${edition}（可选 full | lite）`);
  }
  return edition;
}
