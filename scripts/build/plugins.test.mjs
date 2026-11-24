// `scripts/build/plugins.mjs` 的单元测试：全部在临时仓库里跑，不依赖真实插件。
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildPluginResources, collectSources } from './plugins.mjs';

const created = [];

function makeRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'textox-plugins-'));
  created.push(repoRoot);
  return repoRoot;
}

function writePlugin(dir, id, version = '1.0.0') {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ id, name: id, version }));
  writeFileSync(join(dir, 'main.js'), `console.log('${id}@${version}');`);
}

function manifestVersion(dir) {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).version;
}

afterEach(() => {
  while (created.length) rmSync(created.pop(), { recursive: true, force: true });
});

describe('collectSources', () => {
  it('识别三种 dist 布局', () => {
    const repoRoot = makeRepo();
    // dist/<id>/、dist/、插件根
    writePlugin(join(repoRoot, 'plugins', 'app.textox.nested', 'dist', 'app.textox.nested'), 'app.textox.nested');
    writePlugin(join(repoRoot, 'plugins', 'app.textox.flat', 'dist'), 'app.textox.flat');
    writePlugin(join(repoRoot, 'plugins', 'app.textox.root'), 'app.textox.root');

    const sources = collectSources({ repoRoot });
    expect(sources.map((entry) => entry.id).sort()).toEqual([
      'app.textox.flat',
      'app.textox.nested',
      'app.textox.root',
    ]);
    expect(sources.every((entry) => entry.from === 'repo')).toBe(true);

    const dirs = Object.fromEntries(sources.map((entry) => [entry.id, entry.dir]));
    expect(dirs['app.textox.nested']).toBe(
      join(repoRoot, 'plugins', 'app.textox.nested', 'dist', 'app.textox.nested'),
    );
    expect(dirs['app.textox.flat']).toBe(join(repoRoot, 'plugins', 'app.textox.flat', 'dist'));
    expect(dirs['app.textox.root']).toBe(join(repoRoot, 'plugins', 'app.textox.root'));
  });

  it('submodule 目录名与插件 id 不同时以清单 id 为准', () => {
    const repoRoot = makeRepo();
    // submodule 目录常按仓库名（mkdext），真实 id 在 manifest 里
    writePlugin(join(repoRoot, 'vendor', 'plugins', 'mkdext', 'dist'), 'app.textox.mkdext');

    const sources = collectSources({ repoRoot });
    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe('app.textox.mkdext');
    expect(buildPluginResources({ repoRoot })).toContain('app.textox.mkdext');
  });

  it('id 冲突时 repo → vendor → local 后者覆盖前者', () => {
    const repoRoot = makeRepo();
    const id = 'app.textox.conflict';
    writePlugin(join(repoRoot, 'plugins', id), id, '1.0.0');
    writePlugin(join(repoRoot, 'vendor', 'plugins', id), id, '2.0.0');
    writePlugin(join(repoRoot, 'local-src', 'dist', id), id, '3.0.0');
    writeFileSync(
      join(repoRoot, 'plugin-sources.local.json'),
      JSON.stringify({ [id]: 'local-src' }),
    );

    const sources = collectSources({ repoRoot });
    expect(sources).toHaveLength(1);
    expect(sources[0].from).toBe('local');
    expect(manifestVersion(sources[0].dir)).toBe('3.0.0');

    // 只有 repo + vendor 时，vendor 胜
    rmSync(join(repoRoot, 'plugin-sources.local.json'));
    const vendorWins = collectSources({ repoRoot });
    expect(vendorWins[0].from).toBe('vendor');
    expect(manifestVersion(vendorWins[0].dir)).toBe('2.0.0');
  });

  it('local 映射支持绝对路径（插件仓在宿主仓库外）', () => {
    const repoRoot = makeRepo();
    const outside = mkdtempSync(join(tmpdir(), 'textox-plugin-outside-'));
    created.push(outside);
    const id = 'app.textox.outside';
    writePlugin(join(outside, 'dist', id), id, '4.0.0');
    writeFileSync(
      join(repoRoot, 'plugin-sources.local.json'),
      JSON.stringify({ [id]: outside }),
    );

    const sources = collectSources({ repoRoot });

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ id, from: 'local' });
    expect(manifestVersion(sources[0].dir)).toBe('4.0.0');
  });

  it('来源目录整体缺失时不抛错并返回空数组', () => {
    const repoRoot = makeRepo();
    expect(collectSources({ repoRoot })).toEqual([]);
  });

  it('跳过没有 manifest.json 的目录', () => {
    const repoRoot = makeRepo();
    mkdirSync(join(repoRoot, 'plugins', 'app.textox.empty', 'dist'), { recursive: true });
    writeFileSync(join(repoRoot, 'plugins', 'app.textox.empty', 'dist', 'main.js'), '// no manifest');
    writePlugin(join(repoRoot, 'plugins', 'app.textox.ok'), 'app.textox.ok');

    const sources = collectSources({ repoRoot });
    expect(sources.map((entry) => entry.id)).toEqual(['app.textox.ok']);
  });
});

describe('buildPluginResources', () => {
  it('写出 out/<id>/{manifest.json,main.js} 并返回排序后的 id', () => {
    const repoRoot = makeRepo();
    writePlugin(join(repoRoot, 'plugins', 'app.textox.b', 'dist'), 'app.textox.b');
    writePlugin(join(repoRoot, 'plugins', 'app.textox.a'), 'app.textox.a');

    expect(buildPluginResources({ repoRoot })).toEqual(['app.textox.a', 'app.textox.b']);

    const out = join(repoRoot, 'src-tauri', 'resources', 'plugins');
    expect(readdirSync(out).sort()).toEqual(['app.textox.a', 'app.textox.b']);
    for (const id of ['app.textox.a', 'app.textox.b']) {
      expect(existsSync(join(out, id, 'manifest.json'))).toBe(true);
      expect(existsSync(join(out, id, 'main.js'))).toBe(true);
    }
  });

  it('重复调用清空旧输出', () => {
    const repoRoot = makeRepo();
    const out = join(repoRoot, 'src-tauri', 'resources', 'plugins');
    writePlugin(join(out, 'app.textox.stale'), 'app.textox.stale');

    expect(buildPluginResources({ repoRoot })).toEqual([]);
    expect(existsSync(join(out, 'app.textox.stale'))).toBe(false);
    expect(existsSync(out)).toBe(true);
  });
});
