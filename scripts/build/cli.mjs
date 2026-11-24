#!/usr/bin/env node
// 统一构建入口。所有平台/版本差异都收敛到这里，Makefile 只做别名。
//
// 用法：
//   node scripts/build/cli.mjs dev     --edition full|lite
//   node scripts/build/cli.mjs build   --edition full|lite [--debug] [--no-sign]
//   node scripts/build/cli.mjs package --edition full|lite [--store]
import { parseArgs, run, fail, assertEdition } from './lib.mjs';
import { buildMac, packageMac, storeMac } from './macos.mjs';

const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? 'build';
const edition = assertEdition(args.edition ?? 'full');
const platform = normalizePlatform(args.platform ?? process.platform);
const debug = Boolean(args.debug);
const noSign = args.sign === false;
const arch = args.arch ?? (platform === 'macos' ? 'universal-apple-darwin' : undefined);

function normalizePlatform(value) {
  switch (value) {
    case 'darwin':
    case 'macos':
      return 'macos';
    case 'win32':
    case 'windows':
      return 'windows';
    case 'linux':
      return 'linux';
    default:
      fail(`不支持的平台: ${value}`);
  }
}

function windows({ store, buildOnly = false, edition: forcedEdition }) {
  const flags = ['scripts/build/windows.mjs'];
  if (store) flags.push('--store');
  if (buildOnly) flags.push('--build-only');
  flags.push('--edition', forcedEdition ?? edition);
  if (debug) flags.push('--debug');
  if (noSign) flags.push('--no-sign');
  run('node', flags);
}

function tauriDev() {
  const tauriArgs = ['tauri', 'dev'];
  if (edition === 'lite') {
    tauriArgs.push('--config', platform === 'windows' ? 'src-tauri/tauri.conf.free.windows.json5' : 'src-tauri/tauri.conf.free.json5');
    if (platform !== 'windows') tauriArgs.push('--features', 'free-version');
  }
  run('bun', tauriArgs);
}

function tauriBuild() {
  if (platform === 'macos') {
    buildMac({ edition, arch, debug, noSign, bundles: 'app', devtools: process.env.TEXTO_DEVTOOLS === '1' });
    return;
  }
  if (platform === 'windows') {
    windows({ store: false, buildOnly: true });
    return;
  }

  const tauriArgs = ['tauri', 'build'];
  if (debug) tauriArgs.push('--debug');
  if (edition === 'lite') {
    tauriArgs.push('--config', 'src-tauri/tauri.conf.free.json5', '--features', 'free-version');
  }
  if (noSign) tauriArgs.push('--no-sign');
  run('bun', tauriArgs);
}

function packageApp() {
  if (platform === 'macos') {
    packageMac({ edition, channel: 'direct', arch, debug, noSign });
    return;
  }
  if (platform === 'windows') {
    windows({ store: false });
    return;
  }
  // Linux: Tauri 默认产出 AppImage/deb。
  tauriBuild();
}

function storePackage() {
  if (platform === 'macos') {
    storeMac({ arch, debug, noSign });
    return;
  }
  if (platform === 'windows') {
    // Store MSIX 只有 Lite 版（AppxManifest.lite.xml），忽略 --edition。
    windows({ store: true, edition: 'lite' });
    return;
  }
  fail('store 命令只支持 macOS / Windows');
}

switch (command) {
  case 'dev':
    tauriDev();
    break;
  case 'build':
    tauriBuild();
    break;
  case 'package':
    if (args.store) storePackage();
    else packageApp();
    break;
  case 'help':
  case '--help':
    console.log(`Textox build

  dev      启动 Tauri 开发模式
  build    只构建应用（macOS: .app；Windows: exe；Linux: 默认 bundle）
  package  打包（默认「直接安装」：macOS DMG / Windows MSI+NSIS）
           加 --store 切「商店」：macOS PKG（full+lite）/ Windows MSIX

选项：
  --edition full|lite        版本（默认 full；Windows 两版均为完整功能）
  --platform macos|windows   目标平台（默认当前平台）
  --arch universal-apple-darwin|aarch64-apple-darwin|x86_64-apple-darwin
  --store                    应用商店渠道（macOS full+lite PKG / Windows MSIX）
  --debug                    调试构建
  --no-sign                  跳过签名
`);
    break;
  default:
    fail(`未知命令: ${command}（可用: dev | build | package）`);
}
