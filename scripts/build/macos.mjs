// macOS 构建与签名打包。
//
// 关键点：
// - 版本号只从 src-tauri/tauri.conf.json 读取
// - Lite 版通过 `--features free-version` 裁剪 Rust 功能（仅 macOS/Linux）
// - PKG 走「嵌入 provisioning profile → 重签 app → productbuild」流程
// - 不再提供独立 sign / notarize 目标（MAS 分发不需要公证）
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, appVersion, fail, run } from './lib.mjs';
import { copyToOut } from './out.mjs';

// 签名身份只从环境变量读取，仓库不内置任何开发者证书或团队信息。
// 正式分发（App Store / 直接下载）时由发布者提供；本地构建默认跳过签名。
const APP_IDENTITY = process.env.TEXTO_APP_SIGNING_IDENTITY ?? null;
const INSTALLER_IDENTITY = process.env.TEXTO_INSTALLER_SIGNING_IDENTITY ?? null;

const EDITION_META = {
  full: {
    productName: 'Textox',
    identifier: 'com.texto.markdown',
    config: null,
    profile: 'src-tauri/embedded.provisionprofile',
    entitlements: 'src-tauri/entitlements.plist',
    pkgName: (version) => `Textox-${version}.pkg`,
  },
  lite: {
    productName: 'Textox Lite',
    identifier: 'com.texto.markdown.lite',
    config: 'src-tauri/tauri.conf.free.json5',
    profile: 'src-tauri/embedded.provisionprofile.lite',
    entitlements: 'src-tauri/entitlements-lite.plist',
    pkgName: (version) => `Textox-Lite-${version}.pkg`,
  },
};

function archShort(arch) {
  if (arch === 'universal-apple-darwin') return 'universal';
  if (arch.startsWith('aarch64')) return 'aarch64';
  return 'x64';
}

export function macPaths({ edition, arch, debug }) {
  const meta = EDITION_META[edition];
  const profile = debug ? 'debug' : 'release';
  const targetDir = join(ROOT, 'src-tauri', 'target', arch, profile);
  const bundleDir = join(targetDir, 'bundle');
  return {
    meta,
    targetDir,
    bundleDir,
    app: join(bundleDir, 'macos', `${meta.productName}.app`),
  };
}

/** Tauri 的 DMG 文件名由产品名/版本/架构拼成，这里按目录扫描避免依赖具体命名。 */
function findDmg(bundleDir, arch) {
  const dmgDir = join(bundleDir, 'dmg');
  if (!existsSync(dmgDir)) fail(`DMG directory not found: ${dmgDir}`);
  const dmgs = readdirSync(dmgDir)
    .filter((file) => file.endsWith('.dmg'))
    .map((file) => ({ path: join(dmgDir, file), name: file, mtime: statSync(join(dmgDir, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (dmgs.length === 0) fail(`No DMG found in ${dmgDir}`);

  // 同一目录可能残留其他 edition 的旧 DMG，优先取本次架构中最新产出的那个。
  const preferred = dmgs.find((file) => file.name.includes(`_${archShort(arch)}.dmg`));
  return (preferred ?? dmgs[0]).path;
}

export function buildMac({ edition, arch = 'universal-apple-darwin', debug = false, noSign = false, bundles, devtools = false }) {
  const meta = EDITION_META[edition];
  if (!meta) fail(`未知 edition: ${edition}`);

  const args = ['tauri', 'build', '--target', arch];
  if (debug) args.push('--debug');
  if (meta.config) args.push('--config', meta.config);
  if (edition === 'lite') args.push('--features', 'free-version');
  if (bundles) args.push('--bundles', bundles);
  if (noSign) args.push('--no-sign');

  run('bun', args, { env: { TEXTO_DEVTOOLS: devtools ? '1' : undefined } });
}

function codesign(args) {
  run('codesign', args);
}

function embedProfileAndResign({ edition, arch, debug, noSign }) {
  const { meta, app } = macPaths({ edition, arch, debug });
  if (!existsSync(app)) fail(`App bundle not found: ${app}`);
  if (noSign) {
    console.log('⏭️  --no-sign：跳过 profile 嵌入与重签');
    return app;
  }

  if (!APP_IDENTITY) {
    console.warn('⚠️  未设置 TEXTO_APP_SIGNING_IDENTITY，跳过 profile 嵌入与重签（产物未签名，仅用于本地测试）');
    return app;
  }

  const profile = join(ROOT, meta.profile);
  if (!existsSync(profile)) {
    console.warn(`⚠️  未找到 ${meta.profile}，跳过 profile 嵌入与重签（产物未签名，仅用于本地测试）`);
    return app;
  }

  run('cp', [profile, join(app, 'Contents', 'embedded.provisionprofile')]);
  const entitlements = join(ROOT, meta.entitlements);
  const binary = join(app, 'Contents', 'MacOS', 'texto');
  const frameworksDir = join(app, 'Contents', 'Frameworks');
  const common = ['--force', '--entitlements', entitlements, '--identifier', meta.identifier, '--options', 'runtime', '--sign', APP_IDENTITY];

  console.log('🔏 重新签名 app...');
  codesign([...common, binary]);
  if (existsSync(frameworksDir)) {
    for (const file of readdirSync(frameworksDir)) {
      if (!file.endsWith('.dylib')) continue;
      codesign([...common, join(frameworksDir, file)]);
    }
  }
  codesign([...common, '--deep', app]);
  console.log('✅ 重签完成');

  codesign(['--verify', '--deep', '--strict', '--verbose=2', app]);
  return app;
}

function productbuild({ edition, arch, debug, noSign }) {
  const { meta, app } = macPaths({ edition, arch, debug });
  const version = appVersion();
  const outDir = join(ROOT, 'out');
  mkdirSync(outDir, { recursive: true });
  const output = join(outDir, meta.pkgName(version));

  const args = ['--component', app, '/Applications', '--identifier', meta.identifier, '--version', version];
  if (!noSign && INSTALLER_IDENTITY) {
    args.push('--sign', INSTALLER_IDENTITY);
  } else if (!noSign) {
    console.warn('⚠️  未设置 TEXTO_INSTALLER_SIGNING_IDENTITY，生成未签名的 PKG（仅用于本地测试）');
  }
  args.push(output);

  console.log('📦 创建 PKG 安装包...');
  run('productbuild', args);
  console.log(`📦 Artifact: ${output}`);
  return output;
}

/** 直接安装渠道：构建 DMG 并复制到 out/。 */
export function packageMac({ edition, channel = 'direct', arch = 'universal-apple-darwin', debug = false, noSign = false }) {
  if (channel === 'direct') {
    buildMac({ edition, arch, debug, noSign, bundles: 'dmg' });
    const { bundleDir } = macPaths({ edition, arch, debug });
    copyToOut(findDmg(bundleDir, arch));
    return;
  }

  if (channel !== 'store') {
    fail(`未知 macOS 打包渠道: ${channel}（可选 direct | store）`);
  }

  buildMac({ edition, arch, debug, noSign, bundles: 'app' });
  embedProfileAndResign({ edition, arch, debug, noSign });
  productbuild({ edition, arch, debug, noSign });
}

/** 商店包：macOS 同时产出完整版与 Lite 版 PKG。 */
export function storeMac({ arch = 'universal-apple-darwin', debug = false, noSign = false } = {}) {
  console.log('🍎 macOS: building full + lite PKGs...');
  packageMac({ edition: 'full', channel: 'store', arch, debug, noSign });
  packageMac({ edition: 'lite', channel: 'store', arch, debug, noSign });
}
