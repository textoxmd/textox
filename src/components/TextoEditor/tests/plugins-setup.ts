// 测试期插件注册：与生产入口（src/plugins/index.ts）同构，构建期用
// `import.meta.glob` 发现全部第一方插件清单，不做针对具体插件目录的静态 import。
// 这样某个插件目录被删除时（例如移除 official-plugins/html）本文件仍可编译，
// 目录发现本身对缺失天然容错。
//
// 本文件位于 tests/ 下，属于允许依赖骨架（`@/`）与 official-plugins 的测试夹具
// （见 scripts/check-editor-boundary.mjs 的 SKIP_DIRS）。
import { declareAppExtensionPoints } from "@texto/app-api";
import type { TextoPlugin } from "@texto/plugin-sdk";

import { declareMarkdownEditorExtensionPoint } from "../src/extension/registry.ts";
import { registerPlugins, resetPluginRegistryForTests } from "../../../plugins/registry";

// 生产插件（`official-plugins/*`）+ 已合并进外置插件、仅作测试夹具保留的语法插件
// （`test-fixtures/plugins/*`）。后者不入包、不参与生产注册，只为编辑器整合测试提供
// 这些语法特性（parse/serialize 往返、装饰、输入规则）。
const pluginModules = import.meta.glob<{ default: TextoPlugin }>(
  [
    "../../../../official-plugins/*/src/index.ts",
    "../../../../test-fixtures/plugins/*/src/index.ts",
  ],
  { eager: true },
);

const PLUGINS: TextoPlugin[] = Object.values(pluginModules).map((m) => m.default);

/** 仅测试：重置插件/导出器/扩展点注册并重放官方插件注册。 */
export function bootstrapPluginsForTests(): void {
  resetPluginRegistryForTests();
  declareMarkdownEditorExtensionPoint();
  declareAppExtensionPoints();
  registerPlugins(PLUGINS);
}

bootstrapPluginsForTests();

// 语法高亮语言包在插件里是惰性加载的（生产按文档实际用到的语言加载）。
// 测试是同步断言高亮结果的，这里先把全部语法包预热一遍，避免断言时还在加载中。
const { preloadAllHighlightLanguages } = await import("../src/features/fenced-code.ts");
await preloadAllHighlightLanguages();

import { registerPluginMessages } from "@/i18n";

// 与生产 `initPlugins` 同构：注入插件自带多语言，保证按标题/文案断言的编辑器测试拿到真实翻译。
// setup 文件按序 await，故测试运行前资源已就绪。
await Promise.all(
  PLUGINS.filter((plugin) => plugin.locales).map((plugin) =>
    registerPluginMessages(plugin.id, plugin.locales!, plugin.defaultLocale),
  ),
);
