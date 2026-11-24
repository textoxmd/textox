import { declareAppExtensionPoints } from '@texto/app-api';

import { declareMarkdownEditorExtensionPoint } from '@/components/TextoEditor/src/extension/registry';
import { registerPluginMessages } from '@/i18n';

import { primePluginConfigs, registerPluginManifests, subscribePluginConfigChanges } from './configSync';
import { syncEditorInsertSurfaces } from './editorInsertSurfaces';
import { migrateLegacyPluginState } from './migrate';
import { listEnabledPlugins, registerPlugins } from './registry';
import { initializePluginRuntimes } from './runtime';
import type { TextoPlugin } from './types';

// 第一方插件清单：构建期用 glob 收集 `official-plugins/*` 的默认导出。
// 不用目录扫描的运行时写法——glob 在构建期展开为静态 import，Vite 仍能做
// 静态分析与懒加载拆 chunk；同时骨架源码不出现任何具体插件标识。
const pluginModules = import.meta.glob<{ default: TextoPlugin }>(
  '/official-plugins/*/src/index.ts',
  { eager: true },
);
const PLUGINS: TextoPlugin[] = Object.values(pluginModules).map((m) => m.default);

/**
 * 启动入口：先做一次性迁移（插件注册读 localStorage，迁移必须先完成），
 * 再声明宿主扩展点、登记插件贡献。
 */
export async function initPlugins(): Promise<void> {
  try {
    await migrateLegacyPluginState(PLUGINS);
  } catch (error) {
    console.error('[plugins] legacy migration failed:', error);
  }
  // 先声明宿主点（编辑器 + 应用），再登记插件贡献——保证贡献指向的点已存在。
  declareMarkdownEditorExtensionPoint();
  declareAppExtensionPoints();
  registerPlugins(PLUGINS);
  // 注入全部插件（含未启用）的多语言资源：设置页对未启用插件也需显示文案。
  for (const plugin of PLUGINS) {
    if (plugin.locales) {
      try {
        await registerPluginMessages(plugin.id, plugin.locales, plugin.defaultLocale);
      } catch (error) {
        console.error(`[plugins] i18n injection failed for ${plugin.id}:`, error);
      }
    }
  }
  registerPluginManifests(PLUGINS);
  await primePluginConfigs(listEnabledPlugins());
  subscribePluginConfigChanges();
  // 插件登记后再把编辑器插入命令接入快捷键 / 命令分发派生面。
  syncEditorInsertSurfaces();
  // 最后对启用插件执行一次启动期激活（单个失败已隔离）。
  await initializePluginRuntimes(listEnabledPlugins());
  // 激活期还可能登记插入命令（运行时插件经 `requestReload` 也会同步一次）：
  // 收尾再对齐一遍，保证启动完成时三张表已含全部命令。
  syncEditorInsertSurfaces();
}
