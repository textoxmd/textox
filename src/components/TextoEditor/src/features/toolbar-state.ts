import { Plugin } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";

import { canInsertBlockAt } from "./block-insert.ts";

export interface ToolbarActiveState {
  headingLevel: number | null; // null = 段落
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  inlineCode: boolean;
  marks: string[];
  blockquote: boolean;
  codeBlock: boolean;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  blockInsertDisabled: boolean;
}

const EMPTY: ToolbarActiveState = {
  headingLevel: null,
  bold: false,
  italic: false,
  strikethrough: false,
  inlineCode: false,
  marks: [],
  blockquote: false,
  codeBlock: false,
  bulletList: false,
  orderedList: false,
  taskList: false,
  blockInsertDisabled: false,
};

type InlineToggleKey = "bold" | "italic" | "strikethrough" | "inlineCode";

const INLINE_MARK_TO_KEY: Record<string, InlineToggleKey> = {
  strong: "bold",
  em: "italic",
  strike: "strikethrough",
  code: "inlineCode",
};

export function computeToolbarState(state: EditorState): ToolbarActiveState {
  const out: ToolbarActiveState = { ...EMPTY };
  out.blockInsertDisabled = !canInsertBlockAt(state);
  const { $from, $to } = state.selection;

  const marks = new Set([
    ...$from.marks().map((m) => m.type.name),
    ...$to.marks().map((m) => m.type.name),
  ]);
  out.marks = [...marks];
  for (const [markName, key] of Object.entries(INLINE_MARK_TO_KEY)) {
    if (marks.has(markName)) out[key] = true;
  }

  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    const name = node.type.name;
    if (name === "heading") {
      out.headingLevel = node.attrs.level as number;
    } else if (name === "blockquote") {
      out.blockquote = true;
    } else if (name === "code_block") {
      out.codeBlock = true;
    } else if (name === "bullet_list") {
      out.bulletList = true;
    } else if (name === "ordered_list") {
      out.orderedList = true;
    } else if (name === "list_item") {
      const first = node.firstChild;
      if (first && first.type.name === "paragraph") {
        const inner = first.firstChild;
        if (inner && inner.type.name === "task_marker") out.taskList = true;
      }
    }
  }
  return out;
}

export interface ToolbarStateController {
  plugin: Plugin;
  subscribe: (listener: (s: ToolbarActiveState) => void) => () => void;
}

export function createToolbarStatePlugin(): ToolbarStateController {
  const listeners = new Set<(s: ToolbarActiveState) => void>();
  let latest: ToolbarActiveState = { ...EMPTY };

  const notify = (s: ToolbarActiveState) => {
    latest = s;
    for (const l of listeners) l(s);
  };

  const plugin = new Plugin({
    view(view) {
      notify(computeToolbarState(view.state));
      return {
        update(view) {
          notify(computeToolbarState(view.state));
        },
      };
    },
  });

  return {
    plugin,
    subscribe(listener) {
      listeners.add(listener);
      listener(latest);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
