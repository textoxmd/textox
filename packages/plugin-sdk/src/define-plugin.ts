import type { TextoPlugin } from './types';

/** 类型辅助：声明插件清单，提供类型检查与补全。运行时为恒等函数。 */
export function definePlugin(plugin: TextoPlugin): TextoPlugin {
  return plugin;
}
