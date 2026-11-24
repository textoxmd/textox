/** 插件分类的固定枚举，数组顺序即设置页分组显示顺序。 */
export const PLUGIN_CATEGORIES = ['llm', 'editor', 'export', 'image-hosting'] as const;
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

/** 官方插件约定的作者值；非此值视为第三方。 */
export const OFFICIAL_AUTHOR = 'Textox';

export function isOfficialPlugin(plugin: { author?: string }): boolean {
  return plugin.author === OFFICIAL_AUTHOR;
}

/** 是否为内置分类（有本地化标题）；否则视为插件自定义分类，按原文显示。 */
export function isKnownCategory(category: string): category is PluginCategory {
  return (PLUGIN_CATEGORIES as readonly string[]).includes(category);
}
