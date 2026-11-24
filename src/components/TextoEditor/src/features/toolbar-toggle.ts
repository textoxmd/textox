import { Fragment } from "prosemirror-model";
import { setBlockType, wrapIn } from "prosemirror-commands";
import { wrapInList } from "prosemirror-schema-list";
import { TextSelection, type Command } from "prosemirror-state";

function isInside(state: import("prosemirror-state").EditorState, nodeName: string): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === nodeName) return true;
  }
  return false;
}

// After a replaceWith that collapses a wrapped block, map the cursor
// through the replace and clamp the selection back inside the doc.
function setCursorAfterReplace(tr: import("prosemirror-state").Transaction, cursor: number): void {
  const mapped = tr.mapping.map(cursor);
  const sel = TextSelection.near(tr.doc.resolve(Math.min(mapped, tr.doc.content.size)));
  tr.setSelection(sel);
}

// 把光标所在 list_item 从列表取出，重建为顶层块。list_item 在顶层时
// liftListItem / lift 均无法提升（schema 不允许 list_item 直接作 doc 子节点），
// 故需手动把该 li 的内容拆出来、其余 li 保留原列表。
function unwrapListItem(state: import("prosemirror-state").EditorState, dispatch?: (tr: import("prosemirror-state").Transaction) => void): boolean {
  const { $from } = state.selection;
  let liDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "list_item") { liDepth = d; break; }
  }
  if (liDepth < 0) return false;
  const listDepth = liDepth - 1;
  const list = $from.node(listDepth);
  if (list.type.name !== "bullet_list" && list.type.name !== "ordered_list") return false;
  const li = $from.node(liDepth);

  // $from.index(d) = index of the child at depth d+1 within the node at
  // depth d — so the li's index within the list is index(liDepth - 1).
  // (eq-based matching would misfire on identical sibling items.)
  const liIndex = $from.index(liDepth - 1);
  if (liIndex < 0 || liIndex >= list.childCount) return false;

  const listStart = $from.before(listDepth);
  const listEnd = $from.after(listDepth);
  const children = list.content.content;
  const beforeItems = children.slice(0, liIndex);
  const afterItems = children.slice(liIndex + 1);
  let newContent = Fragment.empty;
  if (beforeItems.length > 0) newContent = newContent.append(Fragment.from(list.copy(Fragment.from(beforeItems))));
  newContent = newContent.append(li.content);
  if (afterItems.length > 0) newContent = newContent.append(Fragment.from(list.copy(Fragment.from(afterItems))));

  if (dispatch) {
    const tr = state.tr.replaceWith(listStart, listEnd, newContent);
    setCursorAfterReplace(tr, $from.pos);
    dispatch(tr);
  }
  return true;
}

export function toggleBlockquote(): Command {
  return (state, dispatch, view) => {
    if (isInside(state, "blockquote")) {
      // 自定义 unwrap：把 blockquote 内容提升为顶层块（lift 对 blockquote 不可靠）。
      const { $from } = state.selection;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type.name === "blockquote") {
          const start = $from.before(d);
          const end = $from.after(d);
          if (dispatch) {
            const tr = state.tr.replaceWith(start, end, node.content);
            setCursorAfterReplace(tr, $from.pos);
            dispatch(tr);
          }
          return true;
        }
      }
      return false;
    }
    return wrapIn(state.schema.nodes.blockquote)(state, dispatch, view);
  };
}

export function toggleCodeBlock(): Command {
  return (state, dispatch, view) => {
    if (isInside(state, "code_block")) {
      return setBlockType(state.schema.nodes.paragraph)(state, dispatch, view);
    }
    return setBlockType(state.schema.nodes.code_block)(state, dispatch, view);
  };
}

export function toggleBulletList(): Command {
  return (state, dispatch, view) => {
    if (isInside(state, "bullet_list")) return unwrapListItem(state, dispatch);
    return wrapInList(state.schema.nodes.bullet_list)(state, dispatch, view);
  };
}

export function toggleOrderedList(): Command {
  return (state, dispatch, view) => {
    if (isInside(state, "ordered_list")) return unwrapListItem(state, dispatch);
    return wrapInList(state.schema.nodes.ordered_list)(state, dispatch, view);
  };
}
