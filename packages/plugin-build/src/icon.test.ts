import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assertPluginIcon, findAutoIcon, isIconAsset } from './icon.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'plugin-icon-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 最小合法 PNG：签名 + IHDR（宽高可指定）。 */
function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

describe('isIconAsset', () => {
  it('distinguishes asset paths from lucide names', () => {
    expect(isIconAsset('icon.svg')).toBe(true);
    expect(isIconAsset('icons/brand.PNG')).toBe(true);
    expect(isIconAsset('pencil-ruler')).toBe(false);
  });
});

describe('findAutoIcon', () => {
  it('prefers assets/icon.* and reports the file name', () => {
    writeFileSync(join(dir, 'icon.png'), 'x');
    expect(findAutoIcon(dir, (p) => require('node:fs').existsSync(p))).toBe('icon.png');
  });

  it('falls back to the project root icon.*', () => {
    writeFileSync(join(dir, 'icon.svg'), '<svg/>');
    expect(findAutoIcon(dir, (p) => require('node:fs').existsSync(p))).toBe('icon.svg');
  });

  it('returns undefined when no icon file exists (lucide name or default icon)', () => {
    expect(findAutoIcon(dir, (p) => require('node:fs').existsSync(p))).toBeUndefined();
  });
});

describe('assertPluginIcon', () => {
  it('ignores lucide icon names and missing icons', () => {
    expect(() => assertPluginIcon(undefined, dir)).not.toThrow();
    expect(() => assertPluginIcon('pencil-ruler', dir)).not.toThrow();
  });

  it('accepts a square png that is copied into dist', () => {
    writeFileSync(join(dir, 'icon.png'), png(512, 512));
    expect(() => assertPluginIcon('icon.png', dir)).not.toThrow();
  });

  it('rejects an asset that was never copied into dist', () => {
    expect(() => assertPluginIcon('icon.png', dir)).toThrow(/is not in the build output/);
  });

  it('rejects a non-square png', () => {
    writeFileSync(join(dir, 'icon.png'), png(512, 256));
    expect(() => assertPluginIcon('icon.png', dir)).toThrow(/must be square/);
  });

  it('rejects a png that is too small for a crisp 32px render', () => {
    writeFileSync(join(dir, 'icon.png'), png(64, 64));
    expect(() => assertPluginIcon('icon.png', dir)).toThrow(/edge must be between/);
  });

  it('accepts an svg with a square viewBox', () => {
    writeFileSync(
      join(dir, 'icon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"></svg>',
    );
    expect(() => assertPluginIcon('icon.svg', dir)).not.toThrow();
  });

  it('rejects an svg without dimensions', () => {
    writeFileSync(join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(() => assertPluginIcon('icon.svg', dir)).toThrow(/width\/height or viewBox/);
  });

  it('rejects an unsupported extension', () => {
    writeFileSync(join(dir, 'icon.ico'), 'x');
    expect(() => assertPluginIcon('icon.ico', dir)).toThrow(/unsupported extension/);
  });
});
