import { getPluginConfigSnapshot, type PluginConfigReader } from '@texto/plugin-sdk';

import { getPluginApp } from './runtime/app';

/**
 * `EditorContext.config` 的唯一来源（经 `EditorHost.readPluginConfig` 注入编辑器）。
 *
 * 编辑器不允许 import 骨架的插件运行时，所以「读哪个插件的配置」这件事只能由宿主
 * 在这里决定。三层回退，先命中者胜：
 *
 * 1. **运行时插件**（`@textox/plugin-sdk`，`source: 'runtime'`）：设置存在运行中的
 *    `PluginApp` 里，`all()` 每次返回含清单默认值的冻结副本——插件改设置后新建的
 *    编辑器扩展立刻读到新值；
 * 2. **旧体系插件**：读 `configSync` 维护的实时配置快照（`setPluginConfigSnapshot`），
 *    与 `subscribePluginConfig` 是同一份数据；
 * 3. **都没有**：返回空读取器（`get` 恒 `undefined`、`all()` 为空对象），插件据此走
 *    自己的代码兜底，而不是拿到 `undefined` 崩掉。
 */
export function readPluginConfig(pluginId: string): PluginConfigReader {
  const runtime = getPluginApp(pluginId);
  if (runtime) {
    return {
      get: <T,>(key: string) => runtime.settings.get<T>(key),
      // 快照的 `values` 是冻结副本：转成普通对象，调用方不必知道它是只读的
      all: <T,>() => ({ ...runtime.settings.all().values }) as T,
    };
  }
  return {
    get: <T,>(key: string) => getPluginConfigSnapshot(pluginId)[key] as T | undefined,
    all: <T,>() => getPluginConfigSnapshot(pluginId) as T,
  };
}
