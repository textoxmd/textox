import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { FeatureSpec } from "../_types.ts";

export type SlashMenuState = {
  active: boolean;
  triggerPos: number;
};

export type SlashStateListener = (state: SlashMenuState) => void;

let stateListener: SlashStateListener | null = null;

export function setSlashStateListener(fn: SlashStateListener | null): void {
  stateListener = fn;
}

const slashMenuKey = new PluginKey("slash-menu");

export function getSlashPluginState(
  view: EditorView,
): SlashMenuState | null {
  return slashMenuKey.getState(view.state) ?? null;
}

function createSlashTriggerPlugin() {
  return new Plugin<SlashMenuState>({
    key: slashMenuKey,
    state: {
      init() {
        return { active: false, triggerPos: 0 };
      },
      apply(tr, prev) {
        const meta = tr.getMeta(slashMenuKey);
        if (meta) {
          const next = { ...prev, ...meta };
          stateListener?.(next);
          return next;
        }
        return prev;
      },
    },
    props: {
      handleTextInput(view, from, _to, text) {
        if (text !== "/") return false;
        if (!view.editable) return false;
        if (view.composing) return false;

        const { state } = view;
        const $from = state.doc.resolve(from);
        if ($from.parent.type.name !== "paragraph") return false;

        const isBlockStart = $from.parentOffset === 0;
        const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
        const isEmpty =
          $from.parent.textContent.trim() === "" ||
          /^\s*$/.test($from.parent.textContent);
        const afterWhitespace = /\s$/.test(textBefore);

        if (isBlockStart || (isEmpty && afterWhitespace)) {
          const tr = state.tr
            .replaceWith(from, _to, state.schema.text("/"))
            .setMeta(slashMenuKey, { active: true, triggerPos: from });
          view.dispatch(tr);
          return true;
        }
        return false;
      },

      handleKeyDown(view, event) {
        const ps = slashMenuKey.getState(view.state);
        if (!ps?.active) return false;

        if (event.key === "Escape") {
          const tr = view.state.tr.setMeta(slashMenuKey, {
            active: false,
            triggerPos: 0,
          });
          view.dispatch(tr);
          return true;
        }

        if (event.key === "Backspace") {
          const { state } = view;
          const atTrigger = Math.abs(state.selection.from - ps.triggerPos) <= 1;
          if (atTrigger) {
            const tr = state.tr
              .delete(ps.triggerPos, ps.triggerPos + 1)
              .setMeta(slashMenuKey, { active: false, triggerPos: 0 });
            view.dispatch(tr);
            return true;
          }
        }

        return false;
      },
    },
  });
}

export function getFilterText(view: EditorView, triggerPos: number): string {
  const { state } = view;
  const from = triggerPos + 1;
  const to = state.selection.from;
  if (from >= to) return "";
  try {
    return state.doc.textBetween(from, to);
  } catch {
    return "";
  }
}

export function dismissMenu(view: EditorView): void {
  const tr = view.state.tr.setMeta(slashMenuKey, {
    active: false,
    triggerPos: 0,
  });
  view.dispatch(tr);
}

export function getTriggerCoords(
  view: EditorView,
  triggerPos: number,
): { top: number; left: number; bottom: number } | null {
  try {
    return view.coordsAtPos(triggerPos);
  } catch {
    return null;
  }
}

export const slashMenu: FeatureSpec = {
  name: "slash-menu",
  plugins: () => [createSlashTriggerPlugin()],
};
