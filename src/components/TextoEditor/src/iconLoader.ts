import type { IconDef, IconElement, IconSpec } from "@texto/markdown-editor-api";
import type { IconNode } from "lucide-react";

type IconModule = {
  /** lucide-react <=1.7x */
  __iconNode?: IconNode;
  /** lucide-react 1.77+ 把节点数据挂在 __iconData.node 上 */
  __iconData?: { node: IconNode };
};
type IconImport = () => Promise<IconModule>;
type IconImports = Record<string, IconImport>;

const cache = new Map<string, IconDef>();
let importsPromise: Promise<IconImports> | null = null;

function loadImports(): Promise<IconImports> {
  importsPromise ??= import("lucide-react/dynamicIconImports")
    .then((mod) => (mod as unknown as { default: IconImports }).default)
    .catch((error) => {
      importsPromise = null; // 失败不粘滞，允许后续重试
      throw error;
    });
  return importsPromise;
}

function num(value: string | number | undefined): number {
  return value === undefined ? 0 : Number(value);
}

/** 将 lucide 图标节点转换为骨架的 IconDef（仅保留受支持的图元）。 */
export function iconNodeToIconDef(node: IconNode): IconDef {
  const out: IconDef = [];
  for (const [tag, attrs] of node) {
    if (tag === "path") {
      if (attrs.d) out.push(["path", attrs.d]);
    } else if (tag === "line") {
      out.push(["line", num(attrs.x1), num(attrs.y1), num(attrs.x2), num(attrs.y2)]);
    } else if (tag === "rect") {
      const rx = attrs.rx;
      const el: IconElement =
        rx === undefined
          ? ["rect", num(attrs.x), num(attrs.y), num(attrs.width), num(attrs.height)]
          : ["rect", num(attrs.x), num(attrs.y), num(attrs.width), num(attrs.height), num(rx)];
      out.push(el);
    } else if (tag === "circle") {
      out.push(["circle", num(attrs.cx), num(attrs.cy), num(attrs.r)]);
    } else if (tag === "ellipse") {
      out.push(["ellipse", num(attrs.cx), num(attrs.cy), num(attrs.rx), num(attrs.ry)]);
    } else if (tag === "polyline") {
      if (attrs.points) out.push(["polyline", attrs.points]);
    } else if (tag === "polygon") {
      if (attrs.points) out.push(["polygon", attrs.points]);
    } else {
      if (import.meta.env.DEV) console.warn(`[iconLoader] unsupported svg tag: ${tag}`);
    }
  }
  return out;
}

/** 解析图标规格为 IconDef：IconDef 直返；字符串按 lucide 名懒加载并缓存。 */
export async function loadIcon(spec: IconSpec): Promise<IconDef> {
  if (Array.isArray(spec)) return spec;
  const cached = cache.get(spec);
  if (cached) return cached;
  const imports = await loadImports();
  const loader = imports[spec];
  if (!loader) throw new Error(`[iconLoader] unknown lucide icon: ${spec}`);
  const mod = await loader();
  const node = mod.__iconData?.node ?? mod.__iconNode;
  if (!node) throw new Error(`[iconLoader] icon data missing: ${spec}`);
  const def = iconNodeToIconDef(node);
  cache.set(spec, def);
  return def;
}

/** 同步读取已缓存的 IconDef；IconDef 规格直接返回，字符串未缓存返回 undefined。 */
export function resolveIcon(spec: IconSpec): IconDef | undefined {
  if (Array.isArray(spec)) return spec;
  return cache.get(spec);
}

/** 预热：并行加载一组规格（同名去重），失败静默。 */
export function prefetchIcons(specs: IconSpec[]): void {
  const seen = new Set<string>();
  for (const spec of specs) {
    if (Array.isArray(spec) || seen.has(spec)) continue;
    seen.add(spec);
    void loadIcon(spec).catch(() => {});
  }
}

/** 仅供测试：清空缓存与映射 Promise。 */
export function resetIconLoaderForTests(): void {
  cache.clear();
  importsPromise = null;
}
