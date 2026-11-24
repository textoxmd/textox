import {
  contextMenuItemAppliesTo,
  type EditorContextMenuCtx,
  type EditorContextMenuItemMeta,
  type EditorContextMenuRequirement,
} from '@texto/markdown-editor-api';

/** 装配后的原生菜单条目（分隔符条目忽略 id / text / enabled）。 */
export interface ContextMenuModelEntry {
  id: string;
  text: string;
  enabled: boolean;
  separator?: boolean;
  /** 已包一层错误隔离的执行体。 */
  run?(): void;
}

export interface BuildContextMenuModelArgs {
  ctx: EditorContextMenuCtx;
  /** 文案解析：内置项 key（`contextMenu.*`）与插件 key（`<插件id>.*`）共用。 */
  t(key: string): string;
  /** 编辑器内置项（组内再按 `order` 排序）。 */
  builtins: EditorContextMenuItemMeta[];
  /** 契约读取器结果（组内按 `order` 排序，相等按注册序）。 */
  contributions: EditorContextMenuItemMeta[];
}

/**
 * 当前可用场景集合：有选区 ⇒ 选区优先（block 场景不参与）；
 * 无选区时仅在命中块的情况下开放 block 场景（未命中块 ⇒ 无插件场景项）。
 */
function availableScenes(ctx: EditorContextMenuCtx): EditorContextMenuRequirement[] {
  if (ctx.hasSelection) return ['selection'];
  return ctx.block ? ['block'] : [];
}

function isVisible(
  meta: EditorContextMenuItemMeta,
  ctx: EditorContextMenuCtx,
  available: readonly EditorContextMenuRequirement[],
): boolean {
  if (!contextMenuItemAppliesTo(meta, available)) return false;
  if (!meta.when) return true;
  try {
    return meta.when(ctx);
  } catch (err) {
    console.error(`[context-menu] when failed: ${meta.id}`, err);
    return false;
  }
}

function isEnabled(meta: EditorContextMenuItemMeta, ctx: EditorContextMenuCtx): boolean {
  if (!meta.enabled) return true;
  try {
    return meta.enabled(ctx);
  } catch (err) {
    console.error(`[context-menu] enabled failed: ${meta.id}`, err);
    return false;
  }
}

function toEntry(
  meta: EditorContextMenuItemMeta,
  ctx: EditorContextMenuCtx,
  t: (key: string) => string,
): ContextMenuModelEntry {
  return {
    id: meta.id,
    text: t(meta.labelKey),
    enabled: isEnabled(meta, ctx),
    run: () => {
      try {
        const result = meta.run(ctx);
        void Promise.resolve(result).catch((err) =>
          console.error(`[context-menu] run failed: ${meta.id}`, err),
        );
      } catch (err) {
        console.error(`[context-menu] run failed: ${meta.id}`, err);
      }
    },
  };
}

function byOrder(a: EditorContextMenuItemMeta, b: EditorContextMenuItemMeta): number {
  return (a.order ?? 0) - (b.order ?? 0);
}

function toGroup(
  items: EditorContextMenuItemMeta[],
  ctx: EditorContextMenuCtx,
  t: (key: string) => string,
  available: readonly EditorContextMenuRequirement[],
): ContextMenuModelEntry[] {
  return items
    // filter 已产生新数组，故随后的 sort 是原地排序副本、不会改写调用方传入的数组。
    .filter((meta) => isVisible(meta, ctx, available))
    .sort(byOrder) // Array.prototype.sort 稳定：order 相等保持传入顺序
    .map((meta) => toEntry(meta, ctx, t));
}

/**
 * 装配正文右键菜单 model：组内按 order 排序、组间固定「内置在前、贡献在后」，
 * 两组都非空时插一条分隔符。空数组表示「无可用项」，但内置项恒在，正常不会为空。
 * 分隔符只由本函数产出（贡献项无 `separator` 字段），故不会出现连续/首尾分隔符。
 */
export function buildContextMenuModel(args: BuildContextMenuModelArgs): ContextMenuModelEntry[] {
  const { ctx, t, builtins, contributions } = args;
  // 场景互斥：有选区 ⇒ 选区优先，block 场景的项不参与。
  const available = availableScenes(ctx);
  const builtinEntries = toGroup(builtins, ctx, t, available);
  const contributedEntries = toGroup(contributions, ctx, t, available);
  if (builtinEntries.length === 0) return contributedEntries;
  if (contributedEntries.length === 0) return builtinEntries;
  return [
    ...builtinEntries,
    { id: '__sep__', text: '', enabled: false, separator: true },
    ...contributedEntries,
  ];
}
