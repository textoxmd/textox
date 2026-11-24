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
