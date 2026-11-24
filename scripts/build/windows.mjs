// Windows 构建：Lite（免费版）与 Store MSIX。
//
// 约定（2026-11 确认）：Windows 的免费版/付费版当前都提供完整功能，
// 因此不设置 VITE_FREE_VERSION、也不传 cargo 的 free-version；两者只通过
// identifier / 商店条目区分。
//
// 用法：
//   node scripts/build/windows.mjs [--edition lite|full] [--store] [--debug] [--no-sign]
//   （edition 默认 lite；--store 仅支持 lite）
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';
import { env } from 'process';
import { ROOT, fail, parseArgs, run, appVersion } from './lib.mjs';
import { copyToOut } from './out.mjs';

const args = parseArgs(process.argv.slice(2));
const edition = args.edition ?? 'lite';
const isStore = Boolean(args.store);
const buildOnly = Boolean(args['build-only']);
const isDebug = Boolean(args.debug);
const noSign = args.sign === false;
const srcTauri = join(ROOT, 'src-tauri');
const windowsDir = join(srcTauri, 'windows');
const version = appVersion();
const version4 = `${version}.0`;

if (!['full', 'lite'].includes(edition)) fail(`未知 edition: ${edition}（可选 full | lite）`);
if (isStore && edition !== 'lite') fail('MSIX（Store）目前只支持 lite edition');
if (isStore && buildOnly) fail('--store 与 --build-only 不能同时使用');

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const LOCK_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);

// Windows 上目录删除常因杀毒扫描、索引器或残留的 MakeAppx/Texto 进程短暂失败
// （EBUSY -4082）。重试几轮通常就能清掉；仍失败时给出可操作的提示。
// MakeAppx 在输出 MSIX 已存在时会询问是否覆盖；若 stdin 不可交互就会永久阻塞，
// 并一直占着 staging 目录。构建前清掉旧产物并传 /o，从根上避免该阻塞。
function killLockingMakeAppx(dir) {
  if (process.platform !== 'win32') return false;
  const target = dir.replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$target = '${target}'`,
    "Get-CimInstance Win32_Process -Filter \"Name='MakeAppx.exe'\" | " +
      'Where-Object { $_.CommandLine -like "*$target*" } | ' +
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }',
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    const out = execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function removeDirWithRetry(dir, { attempts = 10, delayMs = 400, fatal = true } = {}) {
  let killedStale = false;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return true;
    } catch (err) {
      const locked = LOCK_ERROR_CODES.has(err.code);
      if (locked && !killedStale && killLockingMakeAppx(dir)) {
        killedStale = true;
        console.log('  ⚠️  Terminated a stale MakeAppx.exe holding the staging directory.');
      }
      if (!locked || attempt === attempts) {
        if (!fatal) {
          console.warn(`  ⚠️  Could not remove ${dir} (${err.code}). Delete it manually or close any process using it.`);
          return false;
        }
        fail(
          `Cannot remove ${dir} (${err.code}). Close any running Texto/MakeAppx process, ` +
            'or delete the directory manually and retry.',
        );
      }
      console.log(`  … ${dir} is locked (${err.code}), retry ${attempt}/${attempts}`);
      sleepSync(delayMs);
    }
  }
  return false;
}

function generateManifest() {
  const templatePath = join(windowsDir, 'AppxManifest.lite.xml.template');
  const outputPath = join(windowsDir, 'AppxManifest.lite.xml');
  if (!existsSync(templatePath)) fail(`Template not found: ${templatePath}`);
  const template = readFileSync(templatePath, 'utf-8');
  writeFileSync(outputPath, template.replace(/\{\{VERSION\}\}/g, version4));
  console.log(`📝 Generated: ${outputPath}`);
}

function tauriBuild() {
  const buildArgs = ['tauri', 'build'];
  if (isDebug) buildArgs.push('--debug');
  if (edition === 'lite') {
    buildArgs.push(
      '--config',
      isStore ? 'src-tauri/tauri.lite.store.conf.json5' : 'src-tauri/tauri.conf.free.windows.json5',
    );
  }
  if (isStore || buildOnly) buildArgs.push('--no-bundle');
  if (noSign) buildArgs.push('--no-sign');

  console.log(`🏗️  Running tauri build (edition=${edition}, store=${isStore})...`);
  run('bun', buildArgs, { env: { TEXTO_DEVTOOLS: undefined } });
}

console.log(`📖 Version: ${version} → ${version4}`);

if (isStore) generateManifest();
tauriBuild();

if (isStore) {
  console.log('📦 Creating MSIX package...');
  createMsix();
}

console.log('✅ Done!');
console.log(`   Version: ${version4}`);
console.log(`   Edition: ${edition}`);
console.log(`   Store:   ${isStore ? 'yes' : 'no'}`);

// ─────────────────────────────────────────────
// MSIX creation (ported from create-msix.ps1)
// ─────────────────────────────────────────────
function createMsix() {
  const profile = isDebug ? 'debug' : 'release';
  const releaseDir = join(srcTauri, 'target', profile);
  const exePath = join(releaseDir, 'texto.exe');
  const outputDir = join(releaseDir, 'bundle', 'msix');
  const stagingDir = join(releaseDir, '.texto-msix-staging');

  if (!existsSync(exePath)) fail(`Executable not found: ${exePath}`);

  removeDirWithRetry(stagingDir);
  mkdirSync(stagingDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  // Copy manifest
  const manifestSrc = join(windowsDir, 'AppxManifest.lite.xml');
  if (!existsSync(manifestSrc)) fail(`Manifest not found: ${manifestSrc}`);
  copyFileSync(manifestSrc, join(stagingDir, 'AppxManifest.xml'));

  // Copy executable
  copyFileSync(exePath, join(stagingDir, 'Texto.exe'));

  // Copy tile assets, including the AppList target-size / unplated variants.
  // Windows resolves those qualified assets through resources.pri; the
  // unplated variants are what keep the taskbar icon off the accent backplate.
  const iconDir = join(srcTauri, 'icons');
  const requiredAssets = ['StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png', 'Wide310x150Logo.png', 'Square71x71Logo.png', 'Square310x310Logo.png'];
  const missing = requiredAssets.filter((asset) => !existsSync(join(iconDir, asset)));
  if (missing.length) {
    fail(`Required tile assets missing: ${missing.join(', ')}. Run scripts/build/icons.mjs select first.`);
  }

  const assetPattern = /^(?:StoreLogo|Square44x44Logo|Square71x71Logo|Square150x150Logo|Square310x310Logo|Wide310x150Logo)(?:\.[^.]+)?\.png$/;
  const tileAssets = readdirSync(iconDir).filter((file) => assetPattern.test(file)).sort();
  const hasUnplated = tileAssets.some((file) => /^Square44x44Logo\.targetsize-\d+_altform-unplated\.png$/.test(file));
  const hasLightUnplated = tileAssets.some((file) => /^Square44x44Logo\.targetsize-\d+_altform-lightunplated\.png$/.test(file));
  if (!hasUnplated || !hasLightUnplated) {
    fail('Square44x44Logo unplated target-size assets missing. Run scripts/build/icons.mjs select first.');
  }
  for (const asset of tileAssets) {
    const src = join(iconDir, asset);
    if (statSync(src).size === 0) {
      fail(`Tile asset ${asset} is empty`);
    }
    copyFileSync(src, join(stagingDir, asset));
  }
  console.log(`  Copied ${tileAssets.length} tile assets (unplated AppList variants included)`);

  // Copy runtime DLLs and resources
  for (const file of readdirSync(releaseDir)) {
    if (file === 'texto.exe') continue;
    const src = join(releaseDir, file);
    if (!statSync(src).isFile()) continue;
    const ext = extname(file).toLowerCase();
    if (ext === '.dll' || (ext === '.exe') || file.endsWith('.resources.dll')) {
      copyFileSync(src, join(stagingDir, file));
    }
  }

  // Determine output path
  const manifestContent = readFileSync(join(stagingDir, 'AppxManifest.xml'), 'utf-8');
  const nameMatch = manifestContent.match(/Name="([^"]+)"/);
  const packageName = nameMatch ? nameMatch[1] : 'App';
  const msixOutput = join(outputDir, `${packageName}_${version4}.msix`);

  // Windows only resolves qualified assets (targetsize / altform) through
  // resources.pri. MakeAppx does not create it, so build it over the staging
  // directory after all assets are in place.
  generateResourceIndex(stagingDir);

  // Find and run MakeAppx.exe
  const makeAppx = findMakeAppx();
  if (makeAppx) {
    console.log(`  Using MakeAppx: ${makeAppx}`);
    // 旧 MSIX 会让 MakeAppx 停在覆盖确认提示上；先删除再用 /o 静默覆盖。
    rmSync(msixOutput, { force: true });
    run(makeAppx, ['pack', '/d', stagingDir, '/p', msixOutput, '/o', '/l']);
    if (existsSync(msixOutput)) {
      const size = statSync(msixOutput).size;
      console.log(`  ✅ MSIX created: ${msixOutput} (${(size / 1024 / 1024).toFixed(1)} MB)`);
      copyToOut(msixOutput);
    }
  } else {
    console.warn('  ⚠️  MakeAppx.exe not found. Install Windows SDK to create MSIX.');
    console.warn(`  Staging files at: ${stagingDir}`);
    return;
  }

  removeDirWithRetry(stagingDir, { attempts: 5, delayMs: 500, fatal: false });
}

// Windows resolves targetsize / altform assets through resources.pri. MakeAppx
// does not generate it, so call MakePri over the staging directory after all
// package files (and the qualified icon assets) are in place.
function generateResourceIndex(stagingDir) {
  const makePri = findMakePri();
  if (!makePri) {
    fail('MakePri.exe not found. Install the Windows 10/11 SDK to build a Store MSIX.');
  }

  const manifestPath = join(stagingDir, 'AppxManifest.xml');
  const manifest = readFileSync(manifestPath, 'utf-8');
  const languageMatch = manifest.match(/<Resource\s+Language="([^"]+)"/);
  const defaultLanguage = languageMatch ? languageMatch[1] : 'zh-CN';
  const configPath = join(stagingDir, 'priconfig.xml');
  const outputPath = join(stagingDir, 'resources.pri');

  console.log(`  Generating resources.pri (${defaultLanguage}) with ${makePri}…`);
  run(makePri, ['createconfig', '/cf', configPath, '/dq', defaultLanguage]);
  run(makePri, ['new', '/pr', stagingDir, '/cf', configPath, '/mn', manifestPath, '/of', outputPath, '/o']);
  rmSync(configPath, { force: true });

  if (!existsSync(outputPath) || statSync(outputPath).size === 0) {
    fail('MakePri did not produce resources.pri.');
  }
  console.log(`  ✅ resources.pri generated (${statSync(outputPath).size} bytes)`);
}

function findMakeAppx() {
  try {
    const result = execSync('where MakeAppx.exe 2>nul || echo NOT_FOUND', { encoding: 'utf-8', shell: 'cmd.exe' });
    const path = result.trim().split('\n')[0];
    if (path && path !== 'NOT_FOUND' && existsSync(path)) return path;
  } catch {}

  const programFiles = env['ProgramFiles(x86)'] || env.ProgramFiles || 'C:\\Program Files (x86)';
  const sdkBase = join(programFiles, 'Windows Kits', '10', 'bin');
  if (existsSync(sdkBase)) {
    for (const ver of readdirSync(sdkBase).sort().reverse()) {
      const candidate = join(sdkBase, ver, 'x64', 'MakeAppx.exe');
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function findMakePri() {
  try {
    const result = execSync('where MakePri.exe 2>nul || echo NOT_FOUND', { encoding: 'utf-8', shell: 'cmd.exe' });
    const path = result.trim().split('\n')[0];
    if (path && path !== 'NOT_FOUND' && existsSync(path)) return path;
  } catch {}

  const programFiles = env['ProgramFiles(x86)'] || env.ProgramFiles || 'C:\\Program Files (x86)';
  const sdkBase = join(programFiles, 'Windows Kits', '10', 'bin');
  if (existsSync(sdkBase)) {
    for (const ver of readdirSync(sdkBase).sort().reverse()) {
      for (const arch of ['x64', 'x86']) {
        const candidate = join(sdkBase, ver, arch, 'MakePri.exe');
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}
