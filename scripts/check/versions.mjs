#!/usr/bin/env node
// 版本号一致性检查：以 src-tauri/tauri.conf.json 为唯一来源，
// 校验 Cargo.toml 与 package.json 是否同步。
//
// 用法：bun run check:version
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../build/lib.mjs';

const tauriVersion = JSON.parse(readFileSync(join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8')).version;
const packageVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const cargoToml = readFileSync(join(ROOT, 'src-tauri/Cargo.toml'), 'utf8');
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const versions = [
  ['src-tauri/tauri.conf.json', tauriVersion],
  ['src-tauri/Cargo.toml', cargoVersion],
  ['package.json', packageVersion],
];

const mismatched = versions.filter(([, version]) => version !== tauriVersion);
if (mismatched.length > 0) {
  console.error('❌ 版本号不一致（以 src-tauri/tauri.conf.json 为准）:');
  for (const [file, version] of versions) {
    console.error(`   ${file}: ${version ?? '(未找到)'}`);
  }
  process.exit(1);
}

console.log(`✅ 版本号一致: ${tauriVersion}`);

// Tauri 插件版本：JS 包与 Rust crate 的 major.minor 必须一致，
// 否则 `tauri build` 启动时会直接报 "Found version mismatched Tauri packages" 并退出。
// Dependabot 只升一边时（如 @tauri-apps/plugin-dialog）会踩到，这里提前拦下。
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const bunLock = readFileSync(join(ROOT, 'bun.lock'), 'utf8');
const cargoLock = readFileSync(join(ROOT, 'src-tauri/Cargo.lock'), 'utf8');

const jsPlugins = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) =>
  name.startsWith('@tauri-apps/plugin-'),
);

const crates = new Map();
for (const line of cargoLock.split('\n')) {
  const name = line.match(/^name = "(.+)"$/)?.[1];
  if (name?.startsWith('tauri-plugin-')) crates.set(name, null);
}
for (const [crate] of crates) {
  const block = cargoLock.split(`name = "${crate}"`)[1] ?? '';
  crates.set(crate, block.match(/^version = "([^"]+)"/m)?.[1] ?? null);
}

const minor = (version) => version.split('.').slice(0, 2).join('.');

const pluginMismatches = [];
for (const jsName of jsPlugins) {
  const crate = jsName.replace('@tauri-apps/', 'tauri-');
  const jsVersion = bunLock.match(new RegExp(`"${jsName.replace(/[/.]/g, '\\$&')}@([^"]+)"`))?.[1];
  const crateVersion = crates.get(crate);
  if (!jsVersion || !crateVersion) {
    if (!crateVersion && jsVersion) {
      pluginMismatches.push(`${jsName}@${jsVersion} 在 src-tauri/Cargo.lock 中没有对应的 ${crate}`);
    }
    continue;
  }
  if (minor(jsVersion) !== minor(crateVersion)) {
    pluginMismatches.push(`${crate} (${crateVersion}) : ${jsName} (${jsVersion})`);
  }
}

if (pluginMismatches.length > 0) {
  console.error('❌ Tauri 插件 JS 包与 Rust crate 版本不一致（`tauri build` 会直接失败）:');
  for (const line of pluginMismatches) console.error(`   ${line}`);
  console.error('   修复：cd src-tauri && cargo update -p <crate>');
  process.exit(1);
}

console.log(`✅ Tauri 插件版本一致: ${jsPlugins.length} 个`);
