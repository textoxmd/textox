/**
 * Finder 标签颜色（仅 macOS）。
 *
 * 颜色属于 macOS 标签本身，读写在后端（src-tauri/src/macos_tags.rs）；
 * 这里负责取颜色选项，并生成菜单里带彩色圆点的菜单项。
 */
import { invoke } from '@tauri-apps/api/core';
import { Image } from '@tauri-apps/api/image';
import { IconMenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';

export interface TagColorOption {
  /** 颜色键：red / orange / yellow / green / blue / purple / gray */
  key: string;
  /** 当前系统语言下的标签名，例如"红色" */
  name: string;
}

/** 菜单色点色值，与 Finder 标签色一致（对 Finder 截屏采样得到） */
const TAG_COLOR_SWATCH: Record<string, string> = {
  red: '#FF4246',
  orange: '#FF9330',
  yellow: '#FFD503',
  green: '#31D158',
  blue: '#0391FF',
  purple: '#DB35F2',
  gray: '#ACACB0',
};

/** 菜单图标按 18pt 绘制，用 2 倍像素保证 Retina 下清晰 */
const ICON_SIZE = 36;

let cachedOptions: TagColorOption[] | null = null;
const iconCache = new Map<string, Image>();

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** 生成彩色圆点图标；当前颜色在圆点外再描一圈同色细环 */
function circleIcon(rgb: [number, number, number], selected: boolean): Uint8Array {
  const size = ICON_SIZE;
  const rgba = new Uint8Array(size * size * 4);
  const center = size / 2;
  const dotRadius = selected ? 8 : 9.5;
  const ringRadius = 14;
  const ringWidth = 2.5;
  const [r, g, b] = rgb;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center);
      let coverage = Math.min(1, Math.max(0, dotRadius - distance + 0.5));
      if (selected) {
        const ringDistance = Math.abs(distance - ringRadius);
        const ringCoverage = Math.min(1, Math.max(0, ringWidth / 2 - ringDistance + 0.5));
        coverage = Math.max(coverage, ringCoverage);
      }
      if (coverage <= 0) continue;

      const index = (y * size + x) * 4;
      rgba[index] = r;
      rgba[index + 1] = g;
      rgba[index + 2] = b;
      rgba[index + 3] = Math.round(coverage * 255);
    }
  }
  return rgba;
}

async function colorDotIcon(color: string | null, selected: boolean): Promise<Image | undefined> {
  const cacheKey = `${color ?? 'none'}:${selected}`;
  const cached = iconCache.get(cacheKey);
  if (cached) return cached;

  const rgb = color ? hexToRgb(TAG_COLOR_SWATCH[color] ?? TAG_COLOR_SWATCH.gray) : [172, 172, 176];
  try {
    const icon = await Image.new(circleIcon(rgb as [number, number, number], selected), ICON_SIZE, ICON_SIZE);
    iconCache.set(cacheKey, icon);
    return icon;
  } catch (error) {
    console.error('Failed to build tag color icon:', error);
    return undefined;
  }
}

/**
 * 读取颜色选项；非 macOS（或系统不支持）返回空数组。
 * 只有成功返回才缓存：调用失败时下次右键会重试。
 */
export async function getTagColorOptions(): Promise<TagColorOption[]> {
  if (cachedOptions) return cachedOptions;
  try {
    const options = await invoke<TagColorOption[]>('get_file_tag_colors');
    cachedOptions = options;
    return options;
  } catch (error) {
    console.error('Failed to load tag colors:', error);
    return [];
  }
}

/**
 * 生成"颜色"子菜单；非 macOS 返回 null。
 *
 * @param currentColor 当前颜色键（未设置颜色传 null）
 * @param onSelect 选择颜色时的回调，选择"无颜色"时传 null
 */
export async function buildTagColorSubmenu(
  currentColor: string | null,
  labels: { title: string; none: string },
  onSelect: (color: string | null) => void,
): Promise<Submenu | null> {
  const options = await getTagColorOptions();
  if (options.length === 0) return null;

  try {
    const items: Array<IconMenuItem | PredefinedMenuItem> = [];
    items.push(
      await IconMenuItem.new({
        id: 'tag-color-none',
        text: labels.none,
        icon: await colorDotIcon(null, !currentColor),
        action: () => onSelect(null),
      }),
    );
    items.push(await PredefinedMenuItem.new({ item: 'Separator' }));

    for (const option of options) {
      items.push(
        await IconMenuItem.new({
          id: `tag-color-${option.key}`,
          text: option.name,
          icon: await colorDotIcon(option.key, currentColor === option.key),
          action: () => onSelect(option.key),
        }),
      );
    }

    return await Submenu.new({ id: 'tag-color', text: labels.title, items });
  } catch (error) {
    // 颜色菜单失败不应影响其它右键菜单项
    console.error('Failed to build tag color submenu:', error);
    return null;
  }
}
