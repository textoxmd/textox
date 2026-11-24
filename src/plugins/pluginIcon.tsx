import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Puzzle } from 'lucide-react';
import type { IconDef, IconSpec } from '@texto/plugin-sdk';

import { iconComponentFromSpec } from '@/components/TextoEditor/src/editorIcons';
import { loadIcon, prefetchIcons, resolveIcon } from '@/components/TextoEditor/src/iconLoader';

/** lucide 名称形状（kebab-case）。 */
const KEBAB_NAME = /^[a-z][a-z0-9-]*$/;

/** 判定「像 SVG path 数据」：合法 path 必须以 M/m 开头，后接数字或分隔符。 */
const looksLikePathData = (value: string): boolean => /^[Mm][\s\d.,+-]/.test(value.trimStart());

const warned = new Set<string>();

/** 仅供测试：清空告警去重集合。 */
export function resetPluginIconWarningsForTests(): void {
  warned.clear();
}

/** DEV-only：同一插件的同一问题只告警一次。 */
function warnOnce(pluginId: string, detail: string): void {
  if (!import.meta.env.DEV) return;
  const key = `${pluginId}:${detail}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[plugins] ${pluginId} 的 icon ${detail}`);
}

type Resolution =
  | { type: 'def'; def: IconDef }
  | { type: 'path'; d: string }
  | { type: 'fallback' }
  | { type: 'pending' };

/** 同步可判定的渲染规格；只有「lucide 名称尚未缓存」返回 pending。 */
function resolveSync(icon: IconSpec | undefined): Resolution {
  if (!icon) return { type: 'fallback' };
  if (Array.isArray(icon)) return icon.length === 0 ? { type: 'fallback' } : { type: 'def', def: icon };
  if (KEBAB_NAME.test(icon)) {
    const cached = resolveIcon(icon);
    return cached ? { type: 'def', def: cached } : { type: 'pending' };
  }
  return looksLikePathData(icon) ? { type: 'path', d: icon } : { type: 'fallback' };
}

export interface PluginGlyphProps {
  /** 插件 id；仅用于 DEV 告警定位。 */
  id: string;
  /** 清单声明的图标：lucide 名称、手绘 IconDef，或遗留的裸 path 字符串。 */
  icon?: IconSpec;
  /** 渲染尺寸（px）。 */
  size?: number;
}

/**
 * 插件卡片图标的唯一渲染入口（设置页列表 / 二级页头 / 引导页 tile）。
 *
 * 分支：缺省 → Puzzle；lucide 名称 → 懒解析后线框（未就绪先同尺寸占位）；
 * 手绘 IconDef → 线框；名称未命中且像 path → 遗留填充渲染 + DEV 告警；
 * 其余未命中 → Puzzle + DEV 告警。
 */
export function PluginGlyph({ id, icon, size = 24 }: PluginGlyphProps): ReactElement {
  const cached = useMemo(() => resolveSync(icon), [icon]);
  // override 与来源 icon 绑定：props 切换后即使 effect 尚未执行，也不会闪出上一个图标。
  const [override, setOverride] = useState<{
    icon: IconSpec | undefined;
    resolution: Resolution;
  } | null>(null);

  useEffect(() => {
    setOverride(null);
    if (Array.isArray(icon)) {
      if (icon.length === 0) {
        warnOnce(id, '是空 IconDef（未声明任何图元），已回退为默认图标');
      }
      return;
    }
    if (typeof icon !== 'string') return;
    if (!KEBAB_NAME.test(icon)) {
      warnOnce(
        id,
        looksLikePathData(icon)
          ? '是遗留的裸 SVG path 写法，请改用 lucide 图标名或 IconDef 数组'
          : `"${icon}" 不可用作图标（既不是 lucide 图标名，也不像 path 数据），已回退为默认图标`,
      );
      return;
    }
    let alive = true;
    loadIcon(icon).then(
      (def) => {
        if (alive) setOverride({ icon, resolution: { type: 'def', def } });
      },
      () => {
        if (!alive) return;
        warnOnce(id, `找不到 lucide 图标 "${icon}"，已回退为默认图标`);
        setOverride({
          icon,
          resolution: looksLikePathData(icon) ? { type: 'path', d: icon } : { type: 'fallback' },
        });
      },
    );
    return () => {
      alive = false;
    };
  }, [id, icon]);

  const resolved = override && override.icon === icon ? override.resolution : cached;

  if (resolved.type === 'pending') {
    return <span aria-hidden="true" style={{ display: 'inline-block', width: size, height: size }} />;
  }
  if (resolved.type === 'fallback') {
    return <Puzzle size={size} aria-hidden="true" />;
  }
  if (resolved.type === 'path') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={resolved.d} />
      </svg>
    );
  }
  const Glyph = iconComponentFromSpec(resolved.def);
  return <Glyph size={size} />;
}

/** 预热一组插件的卡片图标（只处理 lucide 名称）；由消费点挂载时调用。 */
export function prefetchPluginIcons(plugins: readonly { icon?: IconSpec }[]): void {
  prefetchIcons(
    plugins
      .map((plugin) => plugin.icon)
      .filter((icon): icon is string => typeof icon === 'string' && KEBAB_NAME.test(icon)),
  );
}
