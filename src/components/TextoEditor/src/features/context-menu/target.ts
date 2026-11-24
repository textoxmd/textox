import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/** 右键命中的目标顶层块（未命中为 null）。 */
export interface ContextMenuContext {
  block: { pos: number; node: PMNode } | null;
}

export interface ResolveContextMenuContextArgs {
  view: EditorView;
  coords: { left: number; top: number };
}

/**
 * 求右键菜单上下文：按坐标定位命中块。
 * PM 的 `posAtCoords().inside` 是「命中的最内层节点的起始位置」（点不到节点为 -1）；
 * 点在 NodeView 的非 contentDOM 区域（渲染出的图表等）时 `pos` 常落在块边界（depth 0），
 * 故在 `inside` 上 +1 取样，保证落点在目标节点内部（嵌套节点则解析到其所属顶层块）。
 * 已知边界：顶层原子 leaf 块（horizontal_rule / 顶层图片等 nodeSize 1）取不到块 ⇒ block = null。
 */
export function resolveContextMenuContext(
  args: ResolveContextMenuContextArgs,
): ContextMenuContext {
  const { view, coords } = args;
  const hit = view.posAtCoords(coords);
  if (!hit) return { block: null };
  const probe = Math.min(
    hit.inside >= 0 ? hit.inside + 1 : hit.pos,
    view.state.doc.content.size,
  );
  const $pos = view.state.doc.resolve(probe);
  if ($pos.depth < 1) return { block: null };
  return { block: { pos: $pos.before(1), node: $pos.node(1) } };
}
