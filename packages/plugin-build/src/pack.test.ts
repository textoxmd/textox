import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import type { PluginConfig } from './manifest.js';
import { manifestFileName, packPluginFiles, packPluginPath } from './pack.js';

const config: PluginConfig = {
  id: 'app.textox.demo',
  name: 'Demo',
  version: '1.0.0',
  minAppVersion: '2.3.8',
  author: { name: 'Textox' },
};

const encoder = new TextEncoder();

function unzip(files: Record<string, Uint8Array>): Record<string, Uint8Array> {
  return unzipSync(packPluginFiles(config, files));
}

describe('packPluginFiles', () => {
  it('packs every entry under the plugin id with a manifest', () => {
    const main = encoder.encode('export const x = 1;');

    const entries = unzip({ 'main.js': main });

    expect(Object.keys(entries)).toEqual([
      'app.textox.demo/main.js',
      'app.textox.demo/manifest.json',
    ]);
    expect(entries['app.textox.demo/main.js']).toEqual(main);

    const manifest = JSON.parse(
      new TextDecoder().decode(entries['app.textox.demo/manifest.json']),
    ) as { id: string };
    expect(manifest.id).toBe('app.textox.demo');
  });

  it('keeps a conventionally named icon in the packaged manifest', () => {
    const entries = unzip({
      'main.js': encoder.encode('x'),
      'icon.svg': encoder.encode('<svg viewBox="0 0 100 100"/>'),
    });
    const manifest = JSON.parse(
      new TextDecoder().decode(entries['app.textox.demo/manifest.json']),
    ) as { icon?: string };
    expect(manifest.icon).toBe('icon.svg');
  });

  it('does not let an icon file override an explicit icon field', () => {
    const entries = unzipSync(
      packPluginFiles(
        { ...config, icon: 'brand.png' },
        { 'main.js': encoder.encode('x'), 'icon.svg': encoder.encode('<svg/>') },
      ),
    );
    const manifest = JSON.parse(
      new TextDecoder().decode(entries['app.textox.demo/manifest.json']),
    ) as { icon?: string };
    expect(manifest.icon).toBe('brand.png');
  });

  it('requires main.js', () => {
    expect(() => packPluginFiles(config, { 'styles.css': encoder.encode('a') })).toThrow(
      /missing main\.js/,
    );
  });

  it('skips stale packages and rejects unsafe paths', () => {
    const entries = unzip({
      'main.js': encoder.encode('x'),
      'old.zip': encoder.encode('y'),
    });
    expect(Object.keys(entries)).not.toContain('app.textox.demo/old.zip');

    expect(() =>
      packPluginFiles(config, { 'main.js': encoder.encode('x'), '../evil.js': encoder.encode('y') }),
    ).toThrow(/unsafe package path/);
  });

  it('rejects backslash traversal and drive-letter absolute paths', () => {
    expect(() =>
      packPluginFiles(config, {
        'main.js': encoder.encode('x'),
        'a\\..\\evil.js': encoder.encode('y'),
      }),
    ).toThrow(/unsafe package path/);

    expect(() =>
      packPluginFiles(config, {
        'main.js': encoder.encode('x'),
        'C:/evil.js': encoder.encode('y'),
      }),
    ).toThrow(/unsafe package path/);
  });

  it('carries builtAgainst into the packaged manifest', () => {
    const entries = unzipSync(
      packPluginFiles(config, { 'main.js': encoder.encode('x') }, { react: '18.3.1' }),
    );

    const manifest = JSON.parse(
      new TextDecoder().decode(entries['app.textox.demo/manifest.json']),
    ) as { builtAgainst?: Record<string, string> };

    expect(manifest.builtAgainst).toEqual({ react: '18.3.1' });
  });

  it('names the package file after id and version', () => {
    expect(manifestFileName(config)).toBe('app.textox.demo-1.0.0.zip');
    expect(packPluginPath('/plugins/demo', config)).toBe(
      '/plugins/demo/dist/app.textox.demo-1.0.0.zip',
    );
  });
});
