// 图标管线：`select` 把对应 edition 的成品图标同步到 src-tauri/icons；
// `generate` 从 icons-source/<edition> 重新生成成品（macOS 需要 actool/liquid icon）。
//
// 用法：
//   node scripts/build/icons.mjs select --edition full
//   node scripts/build/icons.mjs generate --edition lite
import { copyFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync, utimesSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');

const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith('--')) ?? 'select';
const editionIndex = args.indexOf('--edition');
const editionArg = editionIndex >= 0 ? args[editionIndex + 1] : undefined;
const edition = editionArg && !editionArg.startsWith('--') ? editionArg : process.env.VITE_FREE_VERSION === 'true' ? 'lite' : 'full';
const isWin = process.platform === 'win32';
const variantDir = join(projectRoot, `icons-source/${edition}`);
const dest = join(projectRoot, 'src-tauri/icons');

if (!['full', 'lite'].includes(edition)) {
  console.error(`Unknown edition: ${edition} (expected full | lite)`);
  process.exit(1);
}

function copyDir(srcDir, destDir) {
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    const destPath = join(destDir, entry);
    if (statSync(srcPath).isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

async function fixPngAlpha(filePath) {
  const img = sharp(filePath);
  const meta = await img.metadata();
  if (meta.format !== 'png') return;

  const tmpFile = join(tmpdir(), `texto-fix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
  await img
    .ensureAlpha()
    .toColorspace('srgb')
    .png({ compressionLevel: 9, palette: false })
    .toFile(tmpFile);
  copyFileSync(tmpFile, filePath);
  rmSync(tmpFile, { force: true });
}

async function fixPngsInDir(dirPath) {
  const entries = readdirSync(dirPath);
  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    if (statSync(fullPath).isDirectory()) {
      await fixPngsInDir(fullPath);
    } else if (entry.toLowerCase().endsWith('.png')) {
      await fixPngAlpha(fullPath);
    }
  }
}

function touchBuildRs() {
  try {
    utimesSync(join(projectRoot, 'src-tauri/build.rs'), new Date(), new Date());
  } catch {
    // ignore
  }
}

function generate() {
  if (process.platform !== 'darwin') {
    console.error('generate 目前仅支持 macOS（依赖 tauri icon / tauri-liquid-icon / actool）');
    process.exit(1);
  }
  const source = join(variantDir, 'texto.png');
  const output = join(variantDir, 'generated');
  if (!existsSync(source)) {
    console.error(`Icon source not found: ${source}`);
    process.exit(1);
  }
  console.log(`🎨 Generating ${edition} icons from ${source}`);
  execSync(`bun tauri icon "${source}" --output "${output}"`, { stdio: 'inherit', cwd: projectRoot });
  execSync(
    `bunx tauri-liquid-icon --icon "${join(variantDir, 'AppIcon.icon')}" --name AppIcon --output "${output}"`,
    { stdio: 'inherit', cwd: projectRoot },
  );
  copyFileSync(join(output, 'AppIcon.icns'), join(output, 'icon.icns'));
  console.log(`✅ ${edition} icons generated in ${output}`);
}

async function select() {
  console.log(`🎨 Selecting icons for ${edition} edition — platform: ${process.platform}`);
  mkdirSync(dest, { recursive: true });

  if (isWin) {
    // Windows: trim the source's macOS-style transparent margin before scaling.
    // Windows draws unplated AppList icons 1:1 inside their slot, so keeping the
    // source's ~8.6%-per-side margin makes the app icons noticeably smaller than
    // every other taskbar/Start icon. Trim to the actual artwork bounds (shadow
    // included) and re-pad with only 2% per side: the rounded plate then fills
    // the slot like a native Windows icon while keeping an edge for the shadow.
    const WIN_EDGE_PADDING = 0.02;
    const WIN_CANVAS = 1024;
    const tempDir = join(tmpdir(), 'texto-icon-gen');
    rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(tempDir, { recursive: true });

    const sourcePng = join(variantDir, 'texto.png');
    const normalizedFile = join(tempDir, 'source.png');
    const outputDir = join(tempDir, 'out');

    // Normalize source to proper RGBA + sRGB, trimming the transparent margin
    // and re-padding with WIN_EDGE_PADDING on every side.
    console.log(`  Normalizing ${edition}/texto.png (trim + ${WIN_EDGE_PADDING * 200}% padding)...`);
    const trimmedSource = await sharp(sourcePng)
      .ensureAlpha()
      .toColorspace('srgb')
      .trim({ threshold: 5 })
      .toBuffer();
    const innerSize = Math.round(WIN_CANVAS * (1 - WIN_EDGE_PADDING * 2));
    const edge = Math.round((WIN_CANVAS - innerSize) / 2);
    const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
    await sharp(trimmedSource)
      .resize(innerSize, innerSize, { fit: 'contain', background: transparent })
      .extend({
        top: edge,
        bottom: WIN_CANVAS - innerSize - edge,
        left: edge,
        right: WIN_CANVAS - innerSize - edge,
        background: transparent,
      })
      .ensureAlpha()
      .toColorspace('srgb')
      .png({ compressionLevel: 9, palette: false })
      .toFile(normalizedFile);

    console.log(`  Generating icon set via tauri icon...`);
    execSync(`bun run -- tauri icon "${normalizedFile}" --output "${outputDir}"`, { stdio: 'pipe', cwd: projectRoot });

    // ── Overwrite tile assets with properly-sized versions ──
    // tauri icon generates StoreLogo at 50x50 (too small for Store)
    // and does NOT generate Wide310x150Logo at all
    console.log(`  Generating StoreLogo.png (300×300)…`);
    await sharp(normalizedFile)
      .resize(300, 300)
      .ensureAlpha()
      .toColorspace('srgb')
      .png({ compressionLevel: 9, palette: false })
      .toFile(join(outputDir, 'StoreLogo.png'));

    console.log(`  Generating Wide310x150Logo.png (310×150)…`);
    await sharp(normalizedFile)
      .resize(310, 150, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .toColorspace('srgb')
      .png({ compressionLevel: 9, palette: false })
      .toFile(join(outputDir, 'Wide310x150Logo.png'));

    // ── AppList target-size assets (taskbar / Start / Alt-Tab) ──
    // Packaged (MSIX) apps take the taskbar icon from these qualified assets,
    // not from the exe's embedded ICO. Without the unplated forms Windows falls
    // back to drawing the plated 44x44 logo on an accent-colored backplate; the
    // icon's transparent margin and rounded corners then expose that color.
    const TARGET_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256];
    const ALT_FORMS = ['', '_altform-unplated', '_altform-lightunplated'];
    console.log(`  Generating Square44x44Logo target-size variants…`);
    for (const size of TARGET_SIZES) {
      for (const alt of ALT_FORMS) {
        await sharp(normalizedFile)
          .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .ensureAlpha()
          .toColorspace('srgb')
          .png({ compressionLevel: 9, palette: false })
          .toFile(join(outputDir, `Square44x44Logo.targetsize-${size}${alt}.png`));
      }
    }

    // ── Fix alpha channels on all generated PNGs ──
    console.log(`  Optimising alpha channels on all PNGs…`);
    await fixPngsInDir(outputDir);

    // ── Copy to destination ──
    copyDir(outputDir, dest);
    copyFileSync(join(outputDir, 'icon.png'), join(projectRoot, 'public/icon.png'));

    rmSync(tempDir, { recursive: true, force: true });
    console.log(`✅ Windows icons generated from ${edition}/texto.png (${WIN_EDGE_PADDING * 200}% edge padding, trimmed artwork)`);
  } else {
    // macOS: use pre-generated icons from vendor dir
    const srcDir = join(variantDir, 'generated');
    if (!existsSync(srcDir)) {
      console.error(`Icon source not found: ${srcDir}`);
      process.exit(1);
    }
    copyDir(srcDir, dest);
    copyFileSync(join(srcDir, 'icon.png'), join(projectRoot, 'public/icon.png'));
    console.log(`✅ Icons copied from ${edition}/generated`);
  }

  // Touch build.rs so Cargo recompiles with the updated icons
  touchBuildRs();
}

if (command === 'generate') {
  generate();
} else if (command === 'select') {
  await select();
} else {
  console.error(`Unknown command: ${command} (expected select | generate)`);
  process.exit(1);
}
