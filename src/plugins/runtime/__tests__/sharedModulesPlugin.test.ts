import path from 'node:path';
import type { OutputBundle, OutputChunk } from 'rollup';
import { describe, expect, it } from 'vitest';
import type { Plugin } from 'vite';
import { SHARED_MODULES } from '@textox/plugin-sdk';

import { SHARED_SPECIFIERS, sharedModulesPlugin } from '../sharedModulesPlugin';

const ROOT = '/repo';
const RUNTIME_DIR = path.resolve(ROOT, 'src/plugins/runtime');
const SPECIFIERS = Object.keys(SHARED_SPECIFIERS);

type ConfigHook = (config: unknown, env: { command: string }) => unknown;
type ResolvedHook = (config: { command: string }) => void;
type GenerateBundleHook = (options: unknown, bundle: Record<string, unknown>) => void;
type HtmlContext = { bundle?: OutputBundle };
type TransformIndexHtmlHook = {
  handler: (
    html: string,
    ctx?: HtmlContext,
  ) => {
    html: string;
    tags: Array<{ tag: string; attrs: Record<string, string>; children: string; injectTo: string }>;
  };
};

function hooks(plugin: Plugin) {
  return {
    config: plugin.config as unknown as ConfigHook,
    configResolved: plugin.configResolved as unknown as ResolvedHook,
    generateBundle: plugin.generateBundle as unknown as GenerateBundleHook,
    transformIndexHtml: plugin.transformIndexHtml as unknown as TransformIndexHtmlHook,
  };
}

function chunk(fileName: string, facadeModuleId: string): OutputChunk {
  return {
    type: 'chunk',
    isEntry: true,
    fileName,
    facadeModuleId,
  } as unknown as OutputChunk;
}

function importsOf(plugin: Plugin, ctx?: HtmlContext): Record<string, string> {
  const result = hooks(plugin).transformIndexHtml.handler('<html></html>', ctx);
  return JSON.parse(result.tags[0].children).imports as Record<string, string>;
}

describe('sharedModulesPlugin', () => {
  it('covers exactly the contract shared modules', () => {
    expect(Object.keys(SHARED_SPECIFIERS).sort()).toEqual([...SHARED_MODULES].sort());
  });

  it('adds every shared entry to the build input with strict entry signatures', () => {
    const plugin = sharedModulesPlugin(ROOT);
    const { config } = hooks(plugin);

    const built = config({}, { command: 'build' }) as {
      build: {
        rollupOptions: { input: string[]; preserveEntrySignatures: string };
      };
    };
    expect(built.build.rollupOptions.input).toEqual([
      path.resolve(ROOT, 'index.html'),
      ...Object.values(SHARED_SPECIFIERS).map((rel) => path.resolve(RUNTIME_DIR, rel)),
    ]);
    expect(built.build.rollupOptions.input).toHaveLength(1 + SPECIFIERS.length);
    // 不带 strict 时纯 re-export 入口会被摇成 0 字节，import map 指向空 chunk
    expect(built.build.rollupOptions.preserveEntrySignatures).toBe('strict');

    expect(config({}, { command: 'serve' })).toBeNull();
  });

  it('maps the build bundle entries to asset urls and ignores unknown entries', () => {
    const plugin = sharedModulesPlugin(ROOT);
    hooks(plugin).configResolved({ command: 'build' });

    const bundle = {
      'assets/react-abc123.js': chunk(
        'assets/react-abc123.js',
        path.resolve(RUNTIME_DIR, 'shared/react.ts'),
      ),
      'index.html': chunk('index.html', path.resolve(ROOT, 'index.html')),
    } as unknown as OutputBundle;

    const imports = importsOf(plugin, { bundle });

    expect(imports.react).toBe('/assets/react-abc123.js');
    expect(Object.keys(imports)).toEqual(['react']);
  });

  it('falls back to the recorded bundle output when the html context has no bundle', () => {
    const plugin = sharedModulesPlugin(ROOT);
    const { configResolved, generateBundle } = hooks(plugin);
    configResolved({ command: 'build' });

    generateBundle({}, {
      'assets/react-abc123.js': chunk(
        'assets/react-abc123.js',
        path.resolve(RUNTIME_DIR, 'shared/react.ts'),
      ),
    });

    expect(importsOf(plugin).react).toBe('/assets/react-abc123.js');
  });

  it('points at source entry files in dev', () => {
    const plugin = sharedModulesPlugin(ROOT);
    hooks(plugin).configResolved({ command: 'serve' });

    // 独立字面量（不从 SHARED_SPECIFIERS 推导），否则值写错时两边一起错、断言空转
    expect(importsOf(plugin)).toEqual({
      react: '/src/plugins/runtime/shared/react.ts',
      'react/jsx-runtime': '/src/plugins/runtime/shared/react-jsx-runtime.ts',
      'react-dom': '/src/plugins/runtime/shared/react-dom.ts',
      'react-dom/client': '/src/plugins/runtime/shared/react-dom-client.ts',
      'prosemirror-model': '/src/plugins/runtime/shared/prosemirror-model.ts',
      'prosemirror-state': '/src/plugins/runtime/shared/prosemirror-state.ts',
      'prosemirror-view': '/src/plugins/runtime/shared/prosemirror-view.ts',
      'prosemirror-transform': '/src/plugins/runtime/shared/prosemirror-transform.ts',
      i18next: '/src/plugins/runtime/shared/i18next.ts',
      'react-i18next': '/src/plugins/runtime/shared/react-i18next.ts',
      '@textox/plugin-sdk': '/src/plugins/runtime/shared/plugin.ts',
      '@texto/export-runtime': '/src/plugins/runtime/shared/export-runtime.ts',
      '@tauri-apps/api/core': '/src/plugins/runtime/shared/tauri-core.ts',
      '@tauri-apps/api/event': '/src/plugins/runtime/shared/tauri-event.ts',
    });
  });

  it('injects the import map at the top of head', () => {
    const plugin = sharedModulesPlugin(ROOT);
    const { handler } = hooks(plugin).transformIndexHtml;

    // 必须留在 normal（非 `pre`）阶段：`pre` 钩子在 transform 阶段执行，那时还没有
    // chunk 文件名，构建出来的 import map 会是空对象（已用真实 vite build 验证）。
    expect((plugin.transformIndexHtml as { order?: string }).order).toBeUndefined();

    const result = handler('<html></html>');

    expect(result.tags[0].tag).toBe('script');
    expect(result.tags[0].attrs.type).toBe('importmap');
    expect(result.tags[0].injectTo).toBe('head-prepend');
  });
});
