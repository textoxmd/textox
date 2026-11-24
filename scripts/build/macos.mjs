// macOS 构建与签名打包。
//
// 关键点：
// - 版本号只从 src-tauri/tauri.conf.json 读取
// - Lite 版通过 `--features free-version` 裁剪 Rust 功能（仅 macOS/Linux）
// - 直接分发：Developer ID 签名（Hardened Runtime）→ DMG → notarytool 公证 → staple 装订
// - 商店分发：PKG 走「嵌入 provisioning profile → 重签 app → productbuild」流程，App Store 不需要公证
// - entitlements 里的团队 ID 是占位符，签名前从环境变量替换到 target/
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, appVersion, fail, run } from './lib.mjs';
import { copyToOut } from './out.mjs';

// 签名身份只从环境变量读取，仓库不内置任何开发者证书或团队信息。
// 正式分发时由发布者提供；本地构建默认跳过签名。
const APP_IDENTITY = process.env.TEXTO_APP_SIGNING_IDENTITY ?? null;
const INSTALLER_IDENTITY = process.env.TEXTO_INSTALLER_SIGNING_IDENTITY ?? null;
const APP_TEAM_ID = process.env.TEXTO_APPLE_TEAM_ID ?? null;

// 公证凭据（三选一，均为可选）：
//  1) 本机已 `xcrun notarytool store-credentials` 保存的 keychain profile
//  2) App Store Connect API Key（.p8 路径 + Key ID + Issuer ID）
//  3) Apple ID + App 专用密码 + Team ID
const NOTARY_KEYCHAIN_PROFILE = process.env.TEXTO_NOTARY_KEYCHAIN_PROFILE ?? null;
const NOTARY_API_KEY = process.env.TEXTO_NOTARY_API_KEY ?? null;
const NOTARY_API_KEY_ID = process.env.TEXTO_NOTARY_API_KEY_ID ?? null;
const NOTARY_API_ISSUER = process.env.TEXTO_NOTARY_API_ISSUER ?? null;
const NOTARY_APPLE_ID = process.env.TEXTO_NOTARY_APPLE_ID ?? null;
const NOTARY_PASSWORD = process.env.TEXTO_NOTARY_PASSWORD ?? null;

// 发布流水线（tag）可设为 1：公证是发布的前置条件，缺凭据时直接失败而不是悄悄产出未公证包。
const REQUIRE_NOTARIZATION = process.env.TEXTO_REQUIRE_NOTARIZATION === '1';

/** 直接分发用的 entitlements：不含 MAS 的 identifier，也不开沙盒。 */
const DIRECT_ENTITLEMENTS = 'entitlements-direct.plist';

/** entitlements 里代表团队 ID 的占位符，构建时替换成真实值。 */
const TEAM_PLACEHOLDER = 'YOUR_TEAM_ID';

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

/** 团队 ID：优先 TEXTO_APPLE_TEAM_ID，其次从签名身份末尾的 "(TEAMID)" 解析。 */
function resolveTeamId() {
  const explicit = APP_TEAM_ID?.trim();
  if (explicit) return explicit;
  const match = APP_IDENTITY?.match(/\(([A-Z0-9]{10})\)\s*$/);
  return match ? match[1] : null;
}

/**
 * 把 entitlements 里的 YOUR_TEAM_ID 占位符替换成真实团队 ID。
 * 无团队 ID 时原样返回（占位符保留，调用方应跳过签名而不是签出一个无效的 app）。
 */
export function materializeEntitlements({ edition }) {
  const meta = EDITION_META[edition];
  if (!meta) fail(`未知 edition: ${edition}`);

  const source = join(ROOT, meta.entitlements);
  const raw = readFileSync(source, 'utf8');
  const hasPlaceholder = raw.includes(TEAM_PLACEHOLDER);
  const teamId = resolveTeamId();
  if (!hasPlaceholder || !teamId) {
    return { path: source, relative: null, pendingPlaceholder: hasPlaceholder };
  }

  const output = join(ROOT, 'src-tauri', 'target', `entitlements.${edition}.plist`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, raw.split(TEAM_PLACEHOLDER).join(teamId));
  return { path: output, relative: `target/entitlements.${edition}.plist`, pendingPlaceholder: false };
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

export function buildMac({ edition, arch = 'universal-apple-darwin', debug = false, noSign = false, bundles, devtools = false, channel = 'direct' }) {
  const meta = EDITION_META[edition];
  if (!meta) fail(`未知 edition: ${edition}`);

  const args = ['tauri', 'build', '--target', arch];
  if (debug) args.push('--debug');
  if (meta.config) args.push('--config', meta.config);
  if (edition === 'lite') args.push('--features', 'free-version');
  if (bundles) args.push('--bundles', bundles);
  if (noSign) args.push('--no-sign');

  // 商店渠道：embedProfileAndResign 会手动重签，这里只把替换过团队 ID 的 entitlements 交给 Tauri。
  // 直接分发渠道：由 Tauri 用 Developer ID + Hardened Runtime 签名（公证要求），不套用 MAS 的 entitlements。
  const override = signingOverride({ edition, channel, noSign });
  if (override) args.push('--config', JSON.stringify(override));

  run('bun', args, { env: { TEXTO_DEVTOOLS: devtools ? '1' : undefined } });
}

/** 计算传给 Tauri 的 bundle.macOS 覆盖项；返回 null 表示不需要额外配置。 */
export function signingOverride({ edition, channel, noSign }) {
  if (channel === 'store') {
    const entitlements = materializeEntitlements({ edition });
    if (entitlements.relative) {
      return { bundle: { macOS: { entitlements: entitlements.relative } } };
    }
    if (entitlements.pendingPlaceholder) {
      console.warn('⚠️  entitlements 仍是 YOUR_TEAM_ID 占位：设置 TEXTO_APPLE_TEAM_ID，或让签名身份带上 "(TEAMID)"');
    }
    return null;
  }

  if (noSign) return null;
  if (!APP_IDENTITY) {
    console.warn('⚠️  未设置 TEXTO_APP_SIGNING_IDENTITY：产物未签名，无法公证（仅用于本地测试）');
    return null;
  }
  return {
    bundle: {
      macOS: {
        signingIdentity: APP_IDENTITY,
        hardenedRuntime: true,
        entitlements: DIRECT_ENTITLEMENTS,
      },
    },
  };
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

  const entitlements = materializeEntitlements({ edition });
  if (entitlements.pendingPlaceholder) {
    console.warn('⚠️  entitlements 仍是 YOUR_TEAM_ID 占位：设置 TEXTO_APPLE_TEAM_ID，或让签名身份带上 "(TEAMID)"；本次跳过重签');
    return app;
  }

  run('cp', [profile, join(app, 'Contents', 'embedded.provisionprofile')]);
  const binary = join(app, 'Contents', 'MacOS', 'texto');
  const frameworksDir = join(app, 'Contents', 'Frameworks');
  const common = ['--force', '--entitlements', entitlements.path, '--identifier', meta.identifier, '--options', 'runtime', '--sign', APP_IDENTITY];

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

/**
 * 公证凭据参数（notarytool 的三种认证方式，按优先级取第一个可用的）。
 * 都没有时返回 null，调用方据此跳过公证或按 TEXTO_REQUIRE_NOTARIZATION 失败。
 */
export function notaryAuthArgs() {
  const profile = NOTARY_KEYCHAIN_PROFILE?.trim();
  if (profile) return ['--keychain-profile', profile];

  const keyPath = NOTARY_API_KEY?.trim();
  const keyId = NOTARY_API_KEY_ID?.trim();
  if (keyPath && keyId) {
    const args = ['--key', keyPath, '--key-id', keyId];
    const issuer = NOTARY_API_ISSUER?.trim();
    if (issuer) args.push('--issuer', issuer);
    return args;
  }

  const appleId = NOTARY_APPLE_ID?.trim();
  const password = NOTARY_PASSWORD?.trim();
  const teamId = resolveTeamId();
  if (appleId && password && teamId) {
    return ['--apple-id', appleId, '--password', password, '--team-id', teamId];
  }

  return null;
}

function missingNotarizationHint() {
  return [
    '未配置公证凭据，跳过公证（产物只能本地使用，分发给他人会被 Gatekeeper 拦截）。',
    '任选一种：',
    '  · TEXTO_NOTARY_KEYCHAIN_PROFILE（先执行 xcrun notarytool store-credentials <profile>）',
    '  · TEXTO_NOTARY_API_KEY / TEXTO_NOTARY_API_KEY_ID / TEXTO_NOTARY_API_ISSUER（App Store Connect API Key）',
    '  · TEXTO_NOTARY_APPLE_ID / TEXTO_NOTARY_PASSWORD（App 专用密码）+ TEXTO_APPLE_TEAM_ID',
  ].join('\n   ');
}

/**
 * 公证 DMG：给 DMG 补 Developer ID 签名 → notarytool 提交并等待 → staple 装订 → 校验。
 * App Store 渠道不需要公证，只有直接分发渠道调用。
 */
function notarizeDmg(dmgPath) {
  if (!APP_IDENTITY) {
    if (REQUIRE_NOTARIZATION) fail('要求公证但没有 TEXTO_APP_SIGNING_IDENTITY（需要 "Developer ID Application" 证书）');
    console.warn('⚠️  未设置 TEXTO_APP_SIGNING_IDENTITY，跳过公证');
    return;
  }

  if (!APP_IDENTITY.startsWith('Developer ID Application')) {
    const message = `公证需要 "Developer ID Application" 证书，当前身份是 "${APP_IDENTITY}"（"Apple Distribution" / "3rd Party Mac Developer" 只能用于 App Store）`;
    if (REQUIRE_NOTARIZATION) fail(message);
    console.warn(`⚠️  ${message}，跳过公证`);
    return;
  }

  const auth = notaryAuthArgs();
  if (!auth) {
    if (REQUIRE_NOTARIZATION) fail(missingNotarizationHint());
    console.warn(`⚠️  ${missingNotarizationHint()}`);
    return;
  }

  console.log('🔏 给 DMG 补签名（Developer ID + 安全时间戳）...');
  run('codesign', ['--force', '--timestamp', '--sign', APP_IDENTITY, dmgPath]);

  console.log('📤 提交 Apple 公证（notarytool，通常 1-5 分钟）...');
  run('xcrun', ['notarytool', 'submit', dmgPath, ...auth, '--wait']);

  console.log('📎 装订公证票据（stapler）...');
  run('xcrun', ['stapler', 'staple', dmgPath]);
  run('xcrun', ['stapler', 'validate', dmgPath]);

  console.log('🔎 Gatekeeper 校验...');
  run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmgPath]);
  console.log('✅ 已公证并装订，可直接分发');
}

/** 直接安装渠道：构建 DMG（签名）→ 复制到 out/ → 公证。 */
export function packageMac({ edition, channel = 'direct', arch = 'universal-apple-darwin', debug = false, noSign = false, notarize = true }) {
  if (channel === 'direct') {
    buildMac({ edition, arch, debug, noSign, bundles: 'dmg', channel });
    const { bundleDir } = macPaths({ edition, arch, debug });
    const artifact = copyToOut(findDmg(bundleDir, arch));
    if (noSign) {
      console.log('⏭️  --no-sign：跳过公证');
    } else if (!notarize) {
      console.log('⏭️  --no-notarize：跳过公证');
    } else {
      notarizeDmg(artifact);
    }
    return;
  }

  if (channel !== 'store') {
    fail(`未知 macOS 打包渠道: ${channel}（可选 direct | store）`);
  }

  buildMac({ edition, arch, debug, noSign, bundles: 'app', channel });
  embedProfileAndResign({ edition, arch, debug, noSign });
  productbuild({ edition, arch, debug, noSign });
}

/** 商店包：macOS 同时产出完整版与 Lite 版 PKG。 */
export function storeMac({ arch = 'universal-apple-darwin', debug = false, noSign = false } = {}) {
  console.log('🍎 macOS: building full + lite PKGs...');
  packageMac({ edition: 'full', channel: 'store', arch, debug, noSign });
  packageMac({ edition: 'lite', channel: 'store', arch, debug, noSign });
}
