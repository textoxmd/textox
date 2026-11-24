import { CODE_HIGHLIGHT_THEMES } from '@texto/markdown-editor-api';
import type { PluginHost } from '@texto/plugin-sdk';

import { CONFIG_DARK, CONFIG_LIGHT, DEFAULT_DARK, DEFAULT_LIGHT } from './settings';

/** 值为非空且属于高亮主题目录才算已知。 */
function isKnownTheme(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && CODE_HIGHLIGHT_THEMES.some((t) => t.value === value);
}

export async function activate(host: PluginHost): Promise<void> {
  const legacy = await host.theme.codeHighlightThemeDefaults();
  let light = await host.config.get<string>(CONFIG_LIGHT);
  let dark = await host.config.get<string>(CONFIG_DARK);

  // 一次性迁移：缺失/无效时用当前配色主题的历史值种子化（历史值也须在目录内）。
  if (!isKnownTheme(light) && isKnownTheme(legacy.light)) {
    light = legacy.light;
    await host.config.set(CONFIG_LIGHT, light);
  }
  if (!isKnownTheme(dark) && isKnownTheme(legacy.dark)) {
    dark = legacy.dark;
    await host.config.set(CONFIG_DARK, dark);
  }

  let appliedLight = isKnownTheme(light) ? light : DEFAULT_LIGHT;
  let appliedDark = isKnownTheme(dark) ? dark : DEFAULT_DARK;
  const apply = () => host.theme.applyCodeHighlightTheme(appliedLight, appliedDark);

  apply();
  host.theme.subscribe(apply);

  // 配置即时生效：清单声明 settingsApply: 'immediate'，宿主写入后刷新快照并通知，
  // 这里据此重新应用，无需重启。回调收到含字段默认值的有效配置。
  host.config.subscribe((config) => {
    appliedLight = isKnownTheme(config[CONFIG_LIGHT]) ? config[CONFIG_LIGHT] : DEFAULT_LIGHT;
    appliedDark = isKnownTheme(config[CONFIG_DARK]) ? config[CONFIG_DARK] : DEFAULT_DARK;
    apply();
  });
}
