import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

/** 允许随插件分发的图标扩展名（与宿主 `plugin_read_asset` 白名单一致）。 */
export const ICON_EXTENSIONS = ['svg', 'png', 'webp', 'jpg', 'jpeg'] as const;

/** 图标文件大小上限：图标要跟插件一起分发，过大的位图没有意义。 */
export const MAX_ICON_BYTES = 256 * 1024;

/** 位图图标的边长要求（方形，且不小于 128px，保证 32px 渲染清晰）。 */
export const MIN_ICON_EDGE = 128;
export const MAX_ICON_EDGE = 2048;

/** 自动图标文件名：`assets/icon.*` 或项目根的 `icon.*`。 */
const AUTO_ICON_BASE = 'icon';

/**
 * 按约定查找插件自带的图标文件：`assets/icon.<ext>` 优先，其次项目根 `icon.<ext>`。
 * 返回文件名（如 `icon.svg`），找不到返回 `undefined`。
 */
export function findAutoIcon(pluginDir: string, exists: (path: string) => boolean): string | undefined {
  for (const ext of ICON_EXTENSIONS) {
    const name = `${AUTO_ICON_BASE}.${ext}`;
    if (exists(join(pluginDir, 'assets', name))) return name;
  }
  for (const ext of ICON_EXTENSIONS) {
    const name = `${AUTO_ICON_BASE}.${ext}`;
    if (exists(join(pluginDir, name))) return name;
  }
  return undefined;
}

/** 清单里的 `icon` 既可以是 lucide 名称，也可以是与插件一起分发的资源路径。 */
export function isIconAsset(icon: string): boolean {
  return ICON_EXTENSIONS.some((ext) => icon.toLowerCase().endsWith(`.${ext}`));
}

function readPngSize(buffer: Buffer): { width: number; height: number } | null {
  // PNG 签名 8 字节 + IHDR 长度/类型 8 字节后紧跟宽高（各 4 字节大端）
  if (buffer.length < 24) return null;
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readSvgSize(source: string): { width: number; height: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(source)?.[0];
  if (!tag) return null;
  const num = (value: string | undefined): number | null => {
    if (!value) return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const width = num(/\bwidth="([^"]+)"/.exec(tag)?.[1]);
  const height = num(/\bheight="([^"]+)"/.exec(tag)?.[1]);
  if (width && height) return { width, height };
  const viewBox = /\bviewBox="([^"]+)"/.exec(tag)?.[1];
  if (!viewBox) return null;
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((item) => !Number.isFinite(item))) return null;
  return { width: parts[2]!, height: parts[3]! };
}

/**
 * 校验插件图标的**资源形态**（`icon` 是 lucide 名称时直接放行）。
 *
 * 规范（`docs/plugin-icon-spec.md`）里可机械检查的部分都在这里，构建期失败而不是等
 * 用户看到破图：
 * - 扩展名在白名单内，且文件确实被复制进了 `dist/`；
 * - 不超过 256KB；
 * - 是方形，边长在 128–2048 之间（保证 32px 下清晰、又不至于臃肿）；
 * - SVG 至少能解析出宽高或 viewBox。
 */
export function assertPluginIcon(icon: string | undefined, outDir: string): void {
  if (!icon) return;
  // 带扩展名但不是白名单格式（如 icon.ico）：按资源处理并明确报错，而不是当成 lucide 名称
  if (!isIconAsset(icon)) {
    const ext = /\.([a-z0-9]+)$/i.exec(icon)?.[1];
    if (ext) {
      throw new Error(
        `icon: unsupported extension ".${ext}" (allowed: ${ICON_EXTENSIONS.join(', ')})`,
      );
    }
    return;
  }

  const ext = extname(icon).slice(1).toLowerCase();
  if (!(ICON_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(`icon: unsupported extension ".${ext}" (allowed: ${ICON_EXTENSIONS.join(', ')})`);
  }

  const file = join(outDir, basename(icon));
  if (!existsSync(file)) {
    throw new Error(
      `icon: "${icon}" is not in the build output. Copy it into dist/ in the build script, e.g. \`cp assets/${icon} dist/${icon}\``,
    );
  }

  const bytes = statSync(file).size;
  if (bytes > MAX_ICON_BYTES) {
    throw new Error(
      `icon: ${icon} is ${Math.round(bytes / 1024)}KB, exceeds ${MAX_ICON_BYTES / 1024}KB`,
    );
  }

  const buffer = readFileSync(file);
  const size = ext === 'svg' ? readSvgSize(buffer.toString('utf8')) : ext === 'png' ? readPngSize(buffer) : null;
  if (ext === 'svg' && !size) {
    throw new Error(`icon: ${icon} must declare width/height or viewBox on the root <svg>`);
  }
  if (ext === 'png' && !size) {
    throw new Error(`icon: ${icon} is not a valid PNG`);
  }
  if (size) {
    const { width, height } = size;
    if (Math.abs(width - height) > Math.max(width, height) * 0.02) {
      throw new Error(`icon: ${icon} must be square (got ${width}×${height})`);
    }
    // SVG 的 viewBox 单位是任意的，只有位图需要检查实际像素尺寸
    if (ext !== 'svg') {
      const edge = Math.min(width, height);
      const maxEdge = Math.max(width, height);
      if (edge < MIN_ICON_EDGE || maxEdge > MAX_ICON_EDGE) {
        throw new Error(
          `icon: ${icon} edge must be between ${MIN_ICON_EDGE} and ${MAX_ICON_EDGE}px (got ${width}×${height})`,
        );
      }
    }
  }
}
