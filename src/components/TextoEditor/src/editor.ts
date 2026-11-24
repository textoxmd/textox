import type { Node as PMNode, Schema } from "prosemirror-model";
import { EditorState, Plugin, TextSelection } from "prosemirror-state";
import type { Command, Transaction } from "prosemirror-state";
import type { Decoration, EditorView, NodeView } from "prosemirror-view";
import type { EditorContext, NodeViewFactory } from "@texto/markdown-editor-api";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";

import { compositionPlugin } from "./composition.ts";
import { cursorRenderPlugin } from "./cursor-render.ts";
import { docInfoPlugin } from "./doc-info.ts";
import { syntaxHintsPlugin } from "./decorations.ts";
import { collectKeymaps, collectPlugins, editableGuard } from "./features/index.ts";
import { editableInputRulesGuard, markdownInputRules, spaceBreaksStoredMarks } from "./input-rules.ts";
import { normalizeInlinePlugin } from "./normalize.ts";
import { pasteMarkdownPlugin } from "./features/paste-markdown.ts";
import { getSchema } from "./schema.ts";
import { viewportPlugin } from "./viewport.ts";
import { collectEditorExtensions } from "./extension/registry.ts";
import { CodeBlockView } from "./features/fenced-code.ts";
import { createImageRefNodeView } from "./features/image-ref.ts";

import { navigateLink } from "./link-navigation.ts";

// Open `<a>` links on Cmd/Ctrl+click. Inside contenteditable, a plain
// click moves the caret instead of navigating — opting in to the
// modifier preserves selection-by-click while letting users follow
// links. Auto-collected by collectPlugins indirectly via this module
// so the lib's defaultPlugins() ships it.
const MOD_CLASS = "mod-active";

function openLinkOnModClickPlugin(): Plugin {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const modKey: "metaKey" | "ctrlKey" = isMac ? "metaKey" : "ctrlKey";
  return new Plugin({
    view(view) {
      function onKey(e: KeyboardEvent) {
        view.dom.classList.toggle(MOD_CLASS, e[modKey]);
      }
      document.addEventListener("keydown", onKey);
      document.addEventListener("keyup", onKey);
      window.addEventListener("blur", () => view.dom.classList.remove(MOD_CLASS));
      return {
        destroy() {
          document.removeEventListener("keydown", onKey);
          document.removeEventListener("keyup", onKey);
        },
      };
    },
    props: {
      handleClick(view, _pos, event) {
        const mod = isMac ? event.metaKey : event.ctrlKey;
        if (!mod && view.editable) return false;
        const a = (event.target as Element | null)?.closest("a");
        if (!a) return false;
        const href = a.getAttribute("data-href") || a.getAttribute("href");
        if (!href) return false;
        event.preventDefault();
        navigateLink(href, view);
        return true;
      },
    },
  });
}

function selectLine(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $head } = state.selection;
  let depth = $head.depth;
  while (depth > 0 && !$head.node(depth).isTextblock) depth--;
  if (depth === 0) return false;
  const start = $head.start(depth);
  const end = $head.end(depth);
  if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, end)));
  return true;
}

function buildEditorContext(base: {
  schema: Schema;
  documentPath?: string;
  isSingleFileMode?: boolean;
}): EditorContext {
  return {
    ...base,
    views: {
      codeBlock: ({ node, view, getPos, preview }) =>
        new CodeBlockView(node, view, getPos, preview),
      embed: ({ node, view, getPos, preview }) =>
        createImageRefNodeView(node, view, getPos, preview),
    },
    // 实际 config 由 collectEditorExtensions 按 owner 覆盖；此处仅为满足类型。
    config: { get: () => undefined, all: <T,>() => ({}) as T },
  };
}

function safeNodeView(
  factory: NodeViewFactory,
  node: PMNode,
  view: EditorView,
  getPos: () => number | undefined,
  decorations: readonly Decoration[],
): NodeView | null {
  try {
    return factory(node, view, getPos, decorations) ?? null;
  } catch (err) {
    console.error("[plugins] 编辑器扩展 NodeView 构造失败，回退内置视图", err);
    return null;
  }
}

function makeNodeViewsPlugin(nodeViews: Record<string, NodeViewFactory[]>): Plugin {
  for (const type of Object.keys(nodeViews)) {
    if (type !== "code_block" && type !== "image_ref" && import.meta.env.DEV) {
      console.warn(
        `[plugins] 编辑器扩展节点类型 "${type}" 暂不支持分发（仅 code_block / image_ref），已忽略`,
      );
    }
  }

  const dispatch = (
    type: string,
    fallback: (
      node: PMNode,
      view: EditorView,
      getPos: () => number | undefined,
      decorations: readonly Decoration[],
    ) => NodeView,
  ) => (
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
    decorations: readonly Decoration[],
  ): NodeView => {
    const list = nodeViews[type] ?? [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const v = safeNodeView(list[i]!, node, view, getPos, decorations);
      if (v) return v;
    }
    return fallback(node, view, getPos, decorations);
  };

  return new Plugin({
    props: {
      nodeViews: {
        code_block: dispatch("code_block", (node, view, getPos) => new CodeBlockView(node, view, getPos)),
        image_ref: dispatch("image_ref", (node, view, getPos) => createImageRefNodeView(node, view, getPos)),
      },
    },
  });
}

export interface DefaultPluginsOptions {
  cursorWidget?: boolean;
  documentPath?: string;
  isSingleFileMode?: boolean;
  openableExtensions?: string[];
  onOpenFileLink?: (path: string) => void;
  /** 是否启用 ProseMirror 原生 history 插件与 Mod-z/y 快捷键。
   *  关闭时撤销/重做交由外部历史会话（经 historyCommands 转发）。 */
  nativeHistory?: boolean;
  /** nativeHistory 关闭时接管 Mod-z/y/Shift-z 的命令。 */
  historyCommands?: { undo: () => boolean; redo: () => boolean };
}

export function defaultPlugins(options: DefaultPluginsOptions = {}): Plugin[] {
  // cursorRenderPlugin paints a visible caret even when the view is not
  // focused — only useful for the replay harness (fakeView has no focus).
  // A real browser editor already draws its own caret, so a live editor
  // should pass `{ cursorWidget: false }`.
  const { cursorWidget = true, documentPath, isSingleFileMode = false, openableExtensions = [], onOpenFileLink } = options;
  const { nativeHistory = true, historyCommands } = options;
  const schema = getSchema();
  const featureKeymap = collectKeymaps(schema);
  // 原生 history 与快捷键：关闭原生历史时把撤销/重做转发给外部历史会话。
  const historyPlugins: Plugin[] = [];
  if (nativeHistory) {
    historyPlugins.push(
      history(),
      keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo, "Mod-l": selectLine }),
    );
  } else if (historyCommands) {
    // 恒返回 true：即使外部会话没有可撤销/重做项（或命令抛错）也要消费快捷键，
    // 否则 PM 会放行浏览器默认行为，原生 DOM undo 可能直接改坏文档。
    // 注意：不能用 `finally { return true }`——finally 里的 return 会吞掉异常，
    // 这里显式 catch 后记录，异常可诊断且快捷键仍被消费。
    historyPlugins.push(
      keymap({
        "Mod-z": () => {
          try {
            historyCommands.undo();
          } catch (err) {
            console.error("[editor] history undo failed", err);
          }
          return true;
        },
        "Mod-y": () => {
          try {
            historyCommands.redo();
          } catch (err) {
            console.error("[editor] history redo failed", err);
          }
          return true;
        },
        "Mod-Shift-z": () => {
          try {
            historyCommands.redo();
          } catch (err) {
            console.error("[editor] history redo failed", err);
          }
          return true;
        },
        "Mod-l": selectLine,
      }),
    );
  } else {
    historyPlugins.push(keymap({ "Mod-l": selectLine }));
  }
  const plugins: Plugin[] = [
    viewportPlugin(),
    docInfoPlugin(documentPath, isSingleFileMode, openableExtensions, onOpenFileLink),
    ...historyPlugins,
    editableInputRulesGuard(),
    markdownInputRules(),
    spaceBreaksStoredMarks(),
    normalizeInlinePlugin(),
    // IME composition guard (sets the shared in-composition flag read by
    // heading / image-ref and inserts the empty-block ZWSP anchor). Core
    // infrastructure — registered here so it does not depend on any single
    // feature/plugin being active.
    compositionPlugin(),
    // Feature-contributed plugins sit after normalize (so block-draft
    // watchers see the post-normalize doc) and before syntaxHints (so any
    // extra decorations merge into PM's decoration pipeline naturally).
    ...collectPlugins(schema),
    // Markdown paste handler after feature plugins (so paste-image gets
    // first crack at image clipboard data).
    pasteMarkdownPlugin(),
    syntaxHintsPlugin(),
    openLinkOnModClickPlugin(),
  ];
  // 编辑器扩展贡献的 ProseMirror 插件；置于内置插件之后、feature keymap 之前。
  const editorExtensions = collectEditorExtensions(
    buildEditorContext({ schema, documentPath, isSingleFileMode }),
  );
  plugins.push(...(editorExtensions.plugins ?? []));
  plugins.push(makeNodeViewsPlugin(editorExtensions.nodeViews));
  if (cursorWidget) plugins.push(cursorRenderPlugin());
  // Feature keymap wins over baseKeymap — features that override Enter /
  // Backspace for block exits rely on this ordering.
  if (Object.keys(featureKeymap).length > 0) plugins.push(keymap(featureKeymap));
  // Guard baseKeymap commands so they also respect locked mode.
  const guardedBaseKeymap: Record<string, Command> = {};
  for (const [key, cmd] of Object.entries(baseKeymap)) {
    guardedBaseKeymap[key] = editableGuard(cmd);
  }
  plugins.push(keymap(guardedBaseKeymap));
  return plugins;
}

export function createState(doc: PMNode): EditorState {
  return EditorState.create({ schema: getSchema(), doc, plugins: defaultPlugins() });
}
