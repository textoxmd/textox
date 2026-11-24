import type { EditorView } from "prosemirror-view";

/**
 * 从编辑器根向上找第一个可纵向滚动的祖先。
 * 找不到时回退到 `view.dom.parentElement`（无布局 / 自滚动页面的兜底）。
 */
export function getScrollParent(view: EditorView): HTMLElement {
  let el: HTMLElement | null = view.dom.parentElement;
  while (el) {
    const style = window.getComputedStyle(el);
    if (style.overflowY === "auto" || style.overflowY === "scroll") return el;
    el = el.parentElement;
  }
  return (view.dom.parentElement || view.dom) as HTMLElement;
}
