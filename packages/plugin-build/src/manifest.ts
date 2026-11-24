import { validateManifest, validatePluginId, type PluginManifest } from '@textox/plugin-sdk';

/** 插件项目在 `plugin.config.ts` 里声明的元数据。 */
export interface PluginConfig {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  description?: string;
  author: { name: string; id?: string };
  category?: string;
  icon?: string;
  defaultEnabled?: boolean;
  isDesktopOnly?: boolean;
  /** 声明式设置字段；形状由宿主侧 `parseManifestSettings` 做 type 白名单过滤。 */
  settings?: unknown[];
}

/** 生成 `manifest.json` 的内容；未知/未定义的可选字段不写入，最后用契约校验兜底。 */
export function buildManifest(
  config: PluginConfig,
  builtAgainst: Record<string, string> = {},
): PluginManifest {
  const raw: Record<string, unknown> = {
    id: config.id,
    name: config.name,
    version: config.version,
    minAppVersion: config.minAppVersion,
    author: config.author,
  };
  if (config.description !== undefined) raw.description = config.description;
  if (config.category !== undefined) raw.category = config.category;
  if (config.icon !== undefined) raw.icon = config.icon;
  if (config.defaultEnabled !== undefined) raw.defaultEnabled = config.defaultEnabled;
  if (config.isDesktopOnly !== undefined) raw.isDesktopOnly = config.isDesktopOnly;
  if (config.settings && config.settings.length > 0) raw.settings = config.settings;
  if (Object.keys(builtAgainst).length > 0) raw.builtAgainst = builtAgainst;

  const result = validateManifest(raw);
  if (!result.ok) {
    // `validateManifest` 把 id 问题统一归成 `invalid-id`，再取一次细粒度原因便于定位
    const detail =
      result.issue === 'invalid-id' ? ` (${validatePluginId(config.id) ?? 'invalid-id'})` : '';
    throw new Error(`invalid plugin config: ${result.issue}${detail}`);
  }
  return result.manifest;
}
