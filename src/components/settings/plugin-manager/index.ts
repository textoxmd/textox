// 插件管理（设置 → 插件）的对外入口：设置页只需要容器，其余是内部构件。
export { PluginManagerPanel } from './PluginManagerPanel';
export { PluginIcon, type PluginIconProps } from './pluginIcon';
export { usePluginSettings, type PluginSettingsApi } from './usePluginSettings';
export { PluginRow, type PluginRowProps } from './PluginRow';
export { PluginListView, type PluginListViewProps } from './PluginListView';
export { PluginDetailView, type PluginDetailViewProps } from './PluginDetailView';
