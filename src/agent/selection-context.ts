import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { AgentAnchorRect, SelectionContextSnapshot } from '@texto/plugin-sdk';

const MAX_SELECTION = 4000;
const MAX_PARAGRAPH = 2000;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n（已截断）` : text;
}

/**
 * 从编辑器状态读出选区上下文：选区文字、起始段落、标题祖先链。
 * 空选区返回 null（调用方据此判断「没有可解释的内容」）。
 */
export function extractSelectionContext(
  state: EditorState,
): Omit<SelectionContextSnapshot, 'anchor'> | null {
  const { from, to, $from } = state.selection;
  const selection = clip(state.doc.textBetween(from, to, '\n'), MAX_SELECTION);
  if (!selection.trim()) return null;

  // 顶层 leaf（图片、分割线等）没有 textblock 父节点；此时不要把整个文档当段落。
  const isTextblock = $from.depth > 0 && $from.parent.isTextblock;
  const paragraph = isTextblock
    ? clip($from.parent.textBetween(0, $from.parent.content.size, '\n'), MAX_PARAGRAPH)
    : '';

  // 标题链：取当前顶层块之前最近的各级标题（文档顺序的祖先链）。
  const stack: Array<{ level: number; text: string }> = [];
  const blockIndex = $from.index(0);
  for (let i = 0; i < blockIndex; i += 1) {
    const node = state.doc.child(i);
    if (node.type.name !== 'heading') continue;
    const level = Number(node.attrs.level ?? 1);
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
    stack.push({ level, text: node.textContent });
  }
  if ($from.depth > 0 && $from.parent.type.name === 'heading') {
    const level = Number($from.parent.attrs.level ?? 1);
    // 同级或更深的标题弹出后，当前标题必然成为祖先链末项。
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
    stack.push({ level, text: $from.parent.textContent });
  }

  return { selection, paragraph, headings: stack.map((item) => item.text) };
}

function anchorOf(view: EditorView): AgentAnchorRect {
  try {
    const { from, to } = view.state.selection;
    const start = view.coordsAtPos(from, 1);
    const end = view.coordsAtPos(to, -1);
    const left = Math.min(start.left, end.left);
    const top = Math.min(start.top, end.top);
    const right = Math.max(start.right, end.right);
    const bottom = Math.max(start.bottom, end.bottom);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  } catch {
    const r = view.dom.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    };
  }
}

/** 读取当前编辑器视图的选区上下文快照；无视图或空选区返回 null。 */
export function readSelectionContext(view: EditorView | null | undefined): SelectionContextSnapshot | null {
  if (!view) return null;
  const ctx = extractSelectionContext(view.state);
  if (!ctx) return null;
  return { ...ctx, anchor: anchorOf(view) };
}
