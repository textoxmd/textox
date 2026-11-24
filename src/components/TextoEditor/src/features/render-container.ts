import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import { getScrollParent } from "../scroll-parent.ts";
import { typewriterPluginKey } from "./typewriter/index.ts";

// 渲染容器（代码块 / 图表 / 图片等 NodeView 的渲染区）与块的交互原语。
// 核心内两个 NodeView（fenced-code / image-ref）共用一份，插件侧的同名实现
// 受 `check:editor-boundary` 约束不能共享（插件不得依赖骨架）。

/**
 * 选区插入点是否落在该块内 —— 渲染态 ⇄ 源码态切换的唯一判定依据。
 * `pos` 为块起始位置（`getPos()` 可能返回 undefined，视为不在块内）。
 */
export function isSelectionInsideBlock(
  view: EditorView,
  pos: number | undefined,
  nodeSize: number,
): boolean {
  if (pos == null) return false;
  const from = view.state.selection.from;
  return from > pos && from < pos + nodeSize;
}

/** 文档位置是否可作为文本插入点（在范围之内且父节点有行内内容）。 */
function isTextInsertPos(view: EditorView, pos: number): boolean {
  if (!Number.isInteger(pos)) return false;
  if (pos < 0 || pos > view.state.doc.content.size) return false;
  try {
    return view.state.doc.resolve(pos).parent.inlineContent;
  } catch {
    return false;
  }
}

/**
 * 解析块内首个文本插入点，是「渲染图 ↔ 代码块」的唯一绑定入口。
 *
 * 优先用 `getPos()`（块起始位置）推导，但必须与点击的 NodeView 根 DOM 对得上：
 * 文档变化后旧位置可能落到别的节点上，位置越界还会让 `TextSelection.create`
 * 直接抛 RangeError。任一校验失败时退回 `posAtDOM(NodeView 根 DOM, 0)` ——
 * 它由当前 DOM 反查描述符得到内容起点，不依赖任何缓存位置。
 */
function resolveBlockInsertPos(
  view: EditorView,
  pos: number | undefined,
  nodeViewDom: HTMLElement | undefined,
): number | null {
  if (pos != null) {
    try {
      const node = view.state.doc.nodeAt(pos);
      const domMatches = !nodeViewDom || view.nodeDOM(pos) === nodeViewDom;
      const insert = pos + 1;
      if (node && domMatches && insert < pos + node.nodeSize && isTextInsertPos(view, insert)) {
        return insert;
      }
    } catch {
      // 位置越界 / 描述符已分离：走 DOM 回退
    }
  }
  if (nodeViewDom) {
    try {
      // NodeView 根 DOM 的本地位置 0 即内容起点（pre 的 chrome/渲染区都在内容之外）。
      const insert = view.posAtDOM(nodeViewDom, 0);
      if (isTextInsertPos(view, insert)) return insert;
    } catch {
      // DOM 不在当前文档的视图树里：无法解析，保持选区不动
    }
  }
  return null;
}

function typewriterEnabled(view: EditorView): boolean {
  return typewriterPluginKey.getState(view.state)?.enabled === true;
}

/** 把插入点所在行对齐到视口坐标 targetY（best-effort；边界由浏览器钳制）。 */
function alignInsertTo(
  view: EditorView,
  insert: number,
  targetY: number,
): void {
  let caret: ReturnType<EditorView["coordsAtPos"]>;
  try {
    caret = view.coordsAtPos(insert);
  } catch {
    // 位置在派发与测量之间失效：放弃对齐，选区/聚焦已生效。
    return;
  }
  if (!caret) return;
  // 容器不可见 / 尚未布局时 ProseMirror 返回退化矩形；此时对齐会把内容
  // 滚到文档顶部，直接放弃。
  if (caret.top === 0 && caret.bottom === 0) return;
  const delta = caret.top - targetY;
  if (Math.abs(delta) < 1) return;
  getScrollParent(view).scrollTop += delta;
}

/**
 * 点渲染容器 ⇒ 把选区放进块内首位置（进入源码编辑态）并滚动可见、聚焦。
 *
 * `nodeViewDom` 是点击的 NodeView 根元素：`pos` 失效时用它重新绑定位置。
 * 两者都无法解析时不派发事务（绝不让调用方退回到浏览器的默认落点行为）。
 * `anchorY` 是点击的视口纵坐标：派发并聚焦成功后，把插入点所在行对齐到该位置
 * （仅有限值生效；差值 < 1px 不写；滚动容器自动向上探测）。
 */
export function focusBlockStart(
  view: EditorView,
  pos: number | undefined,
  nodeViewDom?: HTMLElement,
  anchorY?: number,
): void {
  const insert = resolveBlockInsertPos(view, pos, nodeViewDom);
  if (insert == null) return;
  try {
    const tr = view.state.tr
      .setSelection(TextSelection.create(view.state.doc, insert))
      .scrollIntoView();
    view.dispatch(tr);
    view.focus();
  } catch {
    // 位置在解析与派发之间失效（并发文档更新）：放弃本次落点，交给下一次点击。
    return;
  }
  if (anchorY != null && Number.isFinite(anchorY) && !typewriterEnabled(view)) {
    alignInsertTo(view, insert, anchorY);
  }
}
