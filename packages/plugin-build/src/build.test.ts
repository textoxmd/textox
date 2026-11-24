import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SHARED_MODULES } from '@textox/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';

const { viteBuildMock } = vi.hoisted(() => ({ viteBuildMock: vi.fn() }));

vi.mock('vite', () => ({ build: viteBuildMock }));

import {
  assertNoNodeGlobals,
  assertNoSharedCode,
  assertSingleJsFile,
  assetFileName,
  buildPlugin,
  scriptFiles,
} from './build.js';

describe('assetFileName', () => {
  it('emits styles.css for stylesheets', () => {
    expect(assetFileName({ names: ['dist/styles.css'] })).toBe('styles.css');
  });

  it('keeps hashed names for other assets', () => {
    expect(assetFileName({ names: ['dist/logo.png'] })).toBe('assets/[name]-[hash][extname]');
  });
});

describe('assertSingleJsFile', () => {
  it('accepts a single main.js', () => {
    expect(() => assertSingleJsFile(['main.js'])).not.toThrow();
  });

  it('rejects extra chunks produced by dynamic imports', () => {
    expect(() => assertSingleJsFile(['main.js', 'lazy-abc123.js'])).toThrow(
      /multiple js files .*lazy-abc123\.js.*dynamic imports must be inlined/,
    );
  });

  it('counts rollup mjs chunks too', () => {
    expect(scriptFiles(['main.js', 'lazy-ClnQI7tJ.mjs', 'styles.css'])).toEqual([
      'main.js',
      'lazy-ClnQI7tJ.mjs',
    ]);
    expect(() => assertSingleJsFile(scriptFiles(['main.js', 'lazy-ClnQI7tJ.mjs']))).toThrow(
      /multiple js files .*lazy-ClnQI7tJ\.mjs/,
    );
  });
});

describe('assertNoNodeGlobals', () => {
  it('rejects a bundle that still reads process.env', () => {
    expect(() => assertNoNodeGlobals('const a = process.env.NODE_ENV;')).toThrow(/process\.env/);
  });

  it('does not false-positive on the bare word process', () => {
    expect(() =>
      assertNoNodeGlobals('const a = "process"; const b = obj.process; const c = process?;'),
    ).not.toThrow();
  });

  it('does not false-positive on guarded process feature detection', () => {
    // excalidraw 依赖的 emscripten woff2 glue 就是这么写的；浏览器下该分支不执行。
    expect(() =>
      assertNoNodeGlobals(
        'const isNode = typeof process === "object" && typeof process.versions === "object"; process.argv; process.cwd();',
      ),
    ).not.toThrow();
  });
});

describe('assertNoSharedCode', () => {
  it('rejects bundles that inlined a shared module', () => {
    const chunk = { type: 'chunk', modules: { '/repo/node_modules/react/index.js': {} } };
    expect(() => assertNoSharedCode([chunk])).toThrow(/react/);
  });

  it('rejects prosemirror and i18next inlined into the bundle', () => {
    const chunk = {
      type: 'chunk',
      modules: {
        '/repo/node_modules/prosemirror-state/dist/index.js': {},
        '/repo/node_modules/i18next/dist/esm/i18next.js': {},
      },
    };
    expect(() => assertNoSharedCode([chunk])).toThrow(/prosemirror-state/);
  });

  it('allows plugin-own modules and asset entries', () => {
    const chunk = {
      type: 'chunk',
      modules: { '/repo/src/index.ts': {}, '/repo/node_modules/markdown-it-emoji/index.mjs': {} },
    };
    expect(() => assertNoSharedCode([chunk, { type: 'asset' }])).not.toThrow();
  });

  it('derives the markers from SHARED_MODULES so no shared package is left uncovered', () => {
    // 空清单会让下面的循环空转
    expect(SHARED_MODULES.length).toBeGreaterThan(0);

    for (const specifier of SHARED_MODULES) {
      const segments = specifier.split('/');
      const pkg = specifier.startsWith('@')
        ? `${segments[0]}/${segments[1]}`
        : segments[0];
      const id = `/repo/node_modules/${pkg}/index.js`;
      expect(() => assertNoSharedCode([{ type: 'chunk', modules: { [id]: {} } }])).toThrow(
        /inlined shared modules/,
      );
    }

    // 手写清单曾漏掉这两类：现在必须拦住
    expect(() =>
      assertNoSharedCode([
        { type: 'chunk', modules: { '/repo/node_modules/@tauri-apps/api/core.js': {} } },
      ]),
    ).toThrow(/@tauri-apps\/api/);
    expect(() =>
      assertNoSharedCode([
        { type: 'chunk', modules: { '/repo/node_modules/@texto/export-runtime/dist/index.js': {} } },
      ]),
    ).toThrow(/@texto\/export-runtime/);
  });
});

describe('buildPlugin Node global guard', () => {
  it('fails the build when main.js still references process.*', async () => {
    const pluginDir = path.join(process.cwd(), '.tmp-node-globals-guard');
    viteBuildMock.mockImplementationOnce(async (options: { build: { outDir: string } }) => {
      mkdirSync(options.build.outDir, { recursive: true });
      writeFileSync(
        path.join(options.build.outDir, 'main.js'),
        'const env = process.env.NODE_ENV;\n',
      );
    });

    await expect(
      buildPlugin(pluginDir, {
        id: 'app.textox.demo',
        name: 'Demo',
        version: '1.0.0',
        minAppVersion: '2.3.8',
        author: { name: 'Textox' },
      }),
    ).rejects.toThrow(/process\.env/);
  });
});

describe('buildPlugin shared module guard', () => {
  it('fails the build when Rollup inlined a shared module', async () => {
    const pluginDir = path.join(process.cwd(), '.tmp-shared-modules-guard');
    viteBuildMock.mockImplementationOnce(async (options: { build: { outDir: string } }) => {
      mkdirSync(options.build.outDir, { recursive: true });
      writeFileSync(path.join(options.build.outDir, 'main.js'), 'export const a = 1;\n');
      // Rollup 的模块图：共享模块出现在 chunk 里说明被内联（产物仍是单文件，单文件守卫拦不住）
      return [
        {
          output: [
            {
              type: 'chunk',
              modules: { [path.join(pluginDir, 'node_modules/react/index.js')]: {} },
            },
          ],
        },
      ];
    });

    await expect(
      buildPlugin(pluginDir, {
        id: 'app.textox.demo',
        name: 'Demo',
        version: '1.0.0',
        minAppVersion: '2.3.8',
        author: { name: 'Textox' },
      }),
    ).rejects.toThrow(/inlined shared modules/);
  });
});
