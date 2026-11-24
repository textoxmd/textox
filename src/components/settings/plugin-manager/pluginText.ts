import i18n from '@/i18n';
import type { RuntimeEntry } from '@/plugins/runtime/index';

/**
 * 插件文案读取：插件的 `plugins` 命名空间优先，缺失时回退清单里的静态值。
 *
 * 清单（`manifest.json`）里的 `name` / `description` 是构建期的单一字符串，
 * 无法随界面语言变化；插件可以在自己的 `locales` 里提供同名 key 做本地化。
 * 这里统一按 `<插件 id>.name` / `<插件 id>.description` 取，取不到（i18next 会
 * 原样回显 key）才用清单值。
 *
 * 只读文案，不参与权限判定：名称仅用于展示与搜索。
 */
function translatePluginKey(pluginId: string, key: 'name' | 'description'): string | null {
  const fullKey = `${pluginId}.${key}`;
  const value = i18n.getFixedT(null, 'plugins')(fullKey);
  return typeof value === 'string' && value !== '' && value !== fullKey ? value : null;
}

/** 插件显示名：插件文案 → 清单 `name` → 插件 id。 */
export function pluginDisplayName(entry: RuntimeEntry): string {
  return translatePluginKey(entry.id, 'name') ?? entry.manifest?.name ?? entry.id;
}

/** 插件描述：插件文案 → 清单 `description` → 空串。 */
export function pluginDisplayDescription(entry: RuntimeEntry): string {
  return translatePluginKey(entry.id, 'description') ?? entry.manifest?.description ?? '';
}
