import { createPluginHost, NOOP_HOST_DEPS } from './host';
import type { TextoPlugin } from './types';

/**
 * 对给定插件调用 `activate`（单个失败隔离，不阻断其它插件）。
 * 传入的列表应为「启用插件」（调用方负责过滤；切换插件需重启）。
 *
 * 并发执行：各插件的 activate 都只操作自己的配置/主题，互不依赖；串行会让
 * 启动路径按「插件数 × IPC 往返」累加（syntax-highlight 一个就有 4 次串行
 * invoke）。activate 完成顺序不影响最终状态。
 */
export async function initializePluginRuntimes(plugins: TextoPlugin[]): Promise<void> {
  await Promise.all(
    plugins.map(async (plugin) => {
      if (!plugin.activate) return;
      try {
        await plugin.activate(createPluginHost(NOOP_HOST_DEPS, plugin.id));
      } catch (error) {
        console.error(`[plugins] activate 失败：${plugin.id}`, error);
      }
    }),
  );
}
