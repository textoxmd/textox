import path from 'node:path';
import type { OutputBundle } from 'rollup';
import type { Plugin, ResolvedConfig } from 'vite';
import type { SharedModule } from '@textox/plugin-sdk';

/**
 * 插件包可共享的裸模块 → 共享入口文件（相对 `src/plugins/runtime`）。
 * 键必须与 `@textox/plugin-sdk` 的 `SHARED_MODULES` 完全一致（由类型与单测双重守卫），
 * 任务 11 的 `@textox/plugin-build` 用同一份清单做 `external`。
 */
export const SHARED_SPECIFIERS: Record<SharedModule, string> = {
  react: 'shared/react.ts',
  'react/jsx-runtime': 'shared/react-jsx-runtime.ts',
  'react-dom': 'shared/react-dom.ts',
  'react-dom/client': 'shared/react-dom-client.ts',
  'prosemirror-model': 'shared/prosemirror-model.ts',
  'prosemirror-state': 'shared/prosemirror-state.ts',
  'prosemirror-view': 'shared/prosemirror-view.ts',
  'prosemirror-transform': 'shared/prosemirror-transform.ts',
  i18next: 'shared/i18next.ts',
  'react-i18next': 'shared/react-i18next.ts',
  '@textox/plugin-sdk': 'shared/plugin.ts',
  '@texto/export-runtime': 'shared/export-runtime.ts',
  '@tauri-apps/api/core': 'shared/tauri-core.ts',
  '@tauri-apps/api/event': 'shared/tauri-event.ts',
};

/**
 * 构建期把共享入口作为额外 rollup 输入打进 `assets/<name>-<hash>.js`，
 * 并向 `index.html` 注入 import map，使插件包里的裸导入复用宿主同一份实例。
 *
 * 两个与 Vite 6 实现细节相关的约束（均有实测依据，改动时勿回退）：
 * - `preserveEntrySignatures: 'strict'`：应用构建默认会丢弃纯 re-export 入口的导出，
 *   会让 import map 指向 0 字节 chunk；
 * - import map 必须在 `transformIndexHtml` 的 **normal**（非 `pre`）阶段生成：Vite 6 的
 *   `pre` 钩子在 transform 阶段执行，此时 chunk 文件名还不存在，拿到的 map 是空的。
 *   该阶段的 `ctx.bundle` 才是「最终文件名」的来源，`generateBundle` 记录只作兜底。
 */
export function sharedModulesPlugin(root: string): Plugin {
  const runtimeDir = path.resolve(root, 'src/plugins/runtime');
  const files = Object.values(SHARED_SPECIFIERS).map((rel) => path.resolve(runtimeDir, rel));
  const byFacade = new Map(
    Object.entries(SHARED_SPECIFIERS).map(([specifier, rel]) => [
      path.resolve(runtimeDir, rel),
      specifier,
    ]),
  );
  const emitted: Record<string, string> = {};
  let command: ResolvedConfig['command'] = 'serve';

  const devImports = (): Record<string, string> =>
    Object.fromEntries(
      Object.entries(SHARED_SPECIFIERS).map(([specifier, rel]) => [
        specifier,
        `/${path.posix.join('src/plugins/runtime', rel)}`,
      ]),
    );

  const importsFromBundle = (bundle: OutputBundle): Record<string, string> => {
    const imports: Record<string, string> = {};
    for (const item of Object.values(bundle)) {
      if (item.type !== 'chunk' || !item.isEntry || !item.facadeModuleId) continue;
      const specifier = byFacade.get(item.facadeModuleId);
      if (!specifier) continue;
      imports[specifier] = `/${item.fileName}`;
    }
    return imports;
  };

  return {
    name: 'texto-plugin-shared-modules',
    config(_config, env) {
      if (env.command !== 'build') return null;
      return {
        build: {
          rollupOptions: {
            input: [path.resolve(root, 'index.html'), ...files],
            // 硬前提：纯 re-export 入口必须保留导出，否则 chunk 会被摇成 0 字节。
            // 注意 Vite 的插件 config 优先于用户 config，这里会覆盖用户的同名字段。
            preserveEntrySignatures: 'strict' as const,
          },
        },
      };
    },
    configResolved(config) {
      command = config.command;
    },
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.isEntry || !chunk.facadeModuleId) continue;
        const specifier = byFacade.get(chunk.facadeModuleId);
        if (!specifier) continue;
        // 兜底记录：watch 模式下不清理，只覆盖同名键
        emitted[specifier] = `/${chunk.fileName}`;
      }
    },
    transformIndexHtml: {
      handler(html, ctx) {
        const bundle = ctx?.bundle;
        const imports = bundle
          ? importsFromBundle(bundle)
          : command === 'build'
            ? { ...emitted }
            : devImports();
        return {
          html,
          tags: [
            {
              tag: 'script',
              attrs: { type: 'importmap' },
              children: JSON.stringify({ imports }),
              injectTo: 'head-prepend' as const,
            },
          ],
        };
      },
    },
  };
}
