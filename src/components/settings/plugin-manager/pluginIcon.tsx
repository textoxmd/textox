import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { WandSparkles } from 'lucide-react';
import type { IconDef, IconSpec } from '@texto/plugin-sdk';

import { iconComponentFromDef } from '@/components/TextoEditor/src/editorIcons';
import { loadIcon, resolveIcon } from '@/components/TextoEditor/src/iconLoader';
import { pluginIpc } from '@/plugins/runtime/ipc';

/** lucide 名称形状（kebab-case）。 */
const KEBAB_NAME = /^[a-z][a-z0-9-]*$/;

/** 清单 `icon` 写成相对路径时按位图资源处理（构建期随插件一起分发）。 */
const ICON_ASSET = /\.(svg|png|webp|jpe?g)$/i;

const MIME_BY_EXT: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/** 资源图标的进程内缓存：同一个插件图标在多处渲染只读一次。 */
const assetCache = new Map<string, string | null>();

function mimeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

async function loadIconAsset(pluginId: string, path: string): Promise<string | null> {
  const key = `${pluginId}:${path}`;
  const cached = assetCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const base64 = await pluginIpc.readAsset(pluginId, path);
    // 二进制资源直接拼 data URL：避免异步 fetch 与 CSP 差异
    const url = `data:${mimeOf(path)};base64,${base64}`;
    assetCache.set(key, url);
    return url;
  } catch {
    assetCache.set(key, null);
    return null;
  }
}

export interface PluginIconProps {
  /** 插件清单声明的图标：lucide 名称（kebab-case）或手绘 `IconDef`。 */
  icon?: IconSpec;
  /** 渲染尺寸（px），同时决定宽高。 */
  size?: number;
  /** 插件 id：`icon` 是资源路径（`icon.svg`）时用它读插件目录里的文件。 */
  pluginId?: string;
}

type Resolution =
  | { kind: 'def'; def: IconDef }
  | { kind: 'pending'; name: string }
  | { kind: 'fallback' };

/**
 * 同步可判定的规格：`IconDef` 直接可渲染；kebab 名称命中的走 `iconLoader` 缓存；
 * 名称尚未缓存返回 pending；缺省 / 空 `IconDef` / 非法字符串直接回退。
 */
function resolveSync(icon: IconSpec | undefined): Resolution {
  if (!icon) return { kind: 'fallback' };
  if (Array.isArray(icon)) {
    return icon.length > 0 ? { kind: 'def', def: icon } : { kind: 'fallback' };
  }
  if (!KEBAB_NAME.test(icon)) return { kind: 'fallback' };
  const cached = resolveIcon(icon);
  return cached ? { kind: 'def', def: cached } : { kind: 'pending', name: icon };
}

/**
 * 插件图标渲染入口（设置页列表 / 插件管理面板）。
 *
 * 复用编辑器侧的图标基础设施：lucide kebab 名称走 `iconLoader` 的懒加载缓存，
 * 手绘 `IconDef` 走 `editorIcons` 的线框渲染。缺省或非法规格回退 `wand-sparkles`，
 * 保证每一行都有图标可画；名称在 lucide 里不存在（加载 reject）同样回退，
 * 不留永久空白占位。
 */
export function PluginIcon({ icon, size = 16, pluginId }: PluginIconProps): ReactElement {
  // 资源图标（彩色品牌图）：与 lucide 名称区分开，按 data URL 渲染 <img>
  const assetPath = typeof icon === 'string' && ICON_ASSET.test(icon) ? icon : null;
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [assetFailed, setAssetFailed] = useState(false);

  useEffect(() => {
    if (!assetPath || !pluginId) return;
    let alive = true;
    void loadIconAsset(pluginId, assetPath).then((url) => {
      if (!alive) return;
      setAssetUrl(url);
      setAssetFailed(url === null);
    });
    return () => {
      alive = false;
    };
  }, [assetPath, pluginId]);

  const base = useMemo(() => resolveSync(assetPath ? undefined : icon), [assetPath, icon]);
  const [loaded, setLoaded] = useState<{ name: string; resolution: Resolution } | null>(null);

  useEffect(() => {
    if (base.kind !== 'pending') return;
    const { name } = base;
    let alive = true;
    loadIcon(name).then(
      (def) => {
        if (alive) setLoaded({ name, resolution: { kind: 'def', def } });
      },
      () => {
        if (alive) setLoaded({ name, resolution: { kind: 'fallback' } });
      },
    );
    return () => {
      alive = false;
    };
  }, [base]);

  // 结果与来源名称绑定：icon 切换后即使异步结果晚到，也不会画出上一个图标。
  const resolved =
    base.kind === 'pending' && loaded?.name === base.name ? loaded.resolution : base;

  if (assetPath) {
    if (!assetUrl && assetFailed) {
      // 资源缺失或读取失败：回退默认图标，不留永久空白
      return <WandSparkles size={size} aria-hidden="true" />;
    }
    if (!assetUrl) {
      // 与 lucide 图标同尺寸占位：加载完成前不改变卡片布局
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          aria-hidden="true"
          data-slot="plugin-icon-placeholder"
        />
      );
    }
    // 品牌图标按容器铺满（而不是内缩到 size）：资源图自带圆角与留白，
    // 缩到 18px 会显得四周空一大圈
    return (
      <img
        src={assetUrl}
        alt=""
        aria-hidden="true"
        data-slot="plugin-icon-asset"
        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
      />
    );
  }
  if (resolved.kind === 'fallback') {
    return <WandSparkles size={size} aria-hidden="true" />;
  }
  if (resolved.kind === 'pending') {
    // 同尺寸空 svg 占位：DOM 始终是 svg，容器布局在加载前后不跳动。
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden="true"
        data-slot="plugin-icon-placeholder"
      />
    );
  }
  const Glyph = iconComponentFromDef(resolved.def);
  return <Glyph size={size} />;
}
