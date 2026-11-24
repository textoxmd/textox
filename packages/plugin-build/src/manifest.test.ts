import { describe, expect, it } from 'vitest';
import type { PluginManifest } from '@textox/plugin-sdk';

import { buildManifest, type PluginConfig } from './manifest.js';

const base: PluginConfig = {
  id: 'app.textox.demo',
  name: 'Demo',
  version: '1.0.0',
  minAppVersion: '2.3.8',
  author: { name: 'Textox' },
};

describe('buildManifest', () => {
  it('writes the required fields', () => {
    const manifest = buildManifest(base);

    expect(manifest).toEqual({
      id: 'app.textox.demo',
      name: 'Demo',
      version: '1.0.0',
      minAppVersion: '2.3.8',
      author: { name: 'Textox' },
    });
  });

  it('omits undefined optional fields', () => {
    const manifest = buildManifest({ ...base, description: undefined });

    expect('description' in manifest).toBe(false);
    expect('builtAgainst' in manifest).toBe(false);
  });

  it('writes builtAgainst only when it has entries', () => {
    expect('builtAgainst' in buildManifest(base, {})).toBe(false);

    const manifest = buildManifest(base, { react: '18.3.1' });

    expect(manifest.builtAgainst).toEqual({ react: '18.3.1' });
  });

  it('rejects an invalid id', () => {
    expect(() => buildManifest({ ...base, id: 'bad' })).toThrow(/invalid plugin config/);
    // id 问题由 validateManifest 归一成 invalid-id，细粒度原因追加在括号里
    expect(() => buildManifest({ ...base, id: 'bad' })).toThrow(
      /invalid plugin config: invalid-id \(too-few-segments\)/,
    );
  });

  it('rejects a config without a name', () => {
    const config = { ...base, name: undefined } as unknown as PluginConfig;

    expect(() => buildManifest(config)).toThrow(/invalid plugin config/);
    expect(() => buildManifest(config)).toThrow(/missing-name/);
  });

  it('writes settings into the manifest', () => {
    const settings = [{ type: 'boolean', key: 'a', labelKey: 'a', default: true }];
    const manifest = buildManifest({ ...base, settings }, {});
    // plugin-build 的嵌套依赖仍解析到 0.1.x 类型（`PluginManifest` 尚无 settings 字段），
    // 运行时由 0.2.0 契约原样透传；这里按 0.2.0 形状取值，避免为测试去改依赖范围。
    const withSettings = manifest as PluginManifest & { settings?: unknown[] };
    expect(withSettings.settings).toEqual(settings);
  });

  it('omits settings when the config declares none', () => {
    const manifest = buildManifest(base, {});
    expect('settings' in manifest).toBe(false);
  });
});
