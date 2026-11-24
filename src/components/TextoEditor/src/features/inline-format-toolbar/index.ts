import { Plugin, AllSelection } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { FormatToolbarItemMeta, SelectionActionMeta } from "@texto/markdown-editor-api";
import { formatToolbarItemIncludesSurface } from "@texto/markdown-editor-api";
import type { FeatureSpec } from "../_types.ts";
import i18next from "i18next";
import { mountIcon } from "../../editorIcons.ts";
import { visibleBoundaries } from "../inline-toggle.ts";
import { collectFormatToolbarSuppressedMarks } from "../index.ts";
import { editorFormatToolbarItems, editorSelectionActions } from "../../extension/registry.ts";
import { CORE_FORMAT_ITEMS, runFormatToolbarItem, selectionFullyInMark, selectionHasMark } from "./items.ts";

// 悬浮行内格式工具栏的运行时开关。默认开启；开关只控制格式按钮，
// 选区动作（AI 按钮）独立显示（由动作自身的 when() 决定）。
let inlineFormatToolbarEnabled = true;

export function setInlineFormatToolbarEnabled(enabled: boolean): void {
  inlineFormatToolbarEnabled = enabled;
}

export function isInlineFormatToolbarEnabled(): boolean {
  return inlineFormatToolbarEnabled;
}

export const INLINE_FORMAT_TOOLBAR_CHANGED_EVENT = "inline-format-toolbar-changed";

function isSelectionInSuppressedMark(state: EditorState): boolean {
  return collectFormatToolbarSuppressedMarks().some((name) => selectionFullyInMark(state, name));
}

function isCrossBlockSelection(state: EditorState): boolean {
  const sel = state.selection;
  if (sel instanceof AllSelection) return true;
  return !sel.$from.sameParent(sel.$to);
}

function isInsideCodeBlock(state: import("prosemirror-state").EditorState): boolean {
  const $from = state.selection.$from;
  for (let d = $from.depth; d >= 0; d--) {
    const name = $from.node(d).type.name;
    if (name === "code_block" || name === "fenced_code") return true;
  }
  return false;
}

function isInsideHeading(state: import("prosemirror-state").EditorState): boolean {
  const $from = state.selection.$from;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === "heading") return true;
  }
  return false;
}

export type FmtButton = { el: HTMLButtonElement; meta: FormatToolbarItemMeta };

/**
 * 悬浮工具栏按钮集合：核心项 + 插件贡献项（surfaces 含 floating）。
 * 先按 id 覆盖（Map 保核心首次位置），再按 order 升序。
 * 注意：与顶部工具栏 `listToolbarItems` 的「保位不排序」策略不同。
 */
export function mergeFormatItems(): FormatToolbarItemMeta[] {
  const byId = new Map<string, FormatToolbarItemMeta>();
  for (const m of CORE_FORMAT_ITEMS) byId.set(m.id, m);
  for (const m of editorFormatToolbarItems()) {
    if (formatToolbarItemIncludesSurface(m, "floating")) byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function mkBtn(view: EditorView, meta: FormatToolbarItemMeta, buttons: FmtButton[]): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "floating-toolbar-btn";
  btn.title = i18next.t(meta.labelKey);
  mountIcon(btn, meta.icon);
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", () => {
    runFormatToolbarItem(view, meta);
  });
  buttons.push({ el: btn, meta });
  return btn;
}

export interface BuiltToolbar {
  root: HTMLElement;
  buttons: FmtButton[];
  actionHost: HTMLElement;
  actionSep: HTMLElement;
}

function buildToolbar(view: EditorView): BuiltToolbar {
  const root = document.createElement("div");
  root.className = "floating-toolbar fmt-toolbar";
  root.style.display = "none";
  const buttons: FmtButton[] = [];
  for (const meta of mergeFormatItems()) root.appendChild(mkBtn(view, meta, buttons));
  const actionSep = document.createElement("span");
  actionSep.className = "floating-toolbar-sep";
  actionSep.style.display = "none";
  root.appendChild(actionSep);
  const actionHost = document.createElement("span");
  actionHost.className = "floating-toolbar-actions";
  root.appendChild(actionHost);
  return { root, buttons, actionHost, actionSep };
}

function mkActionBtn(view: EditorView, meta: SelectionActionMeta): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "floating-toolbar-btn";
  btn.title = i18next.t(meta.labelKey);
  mountIcon(btn, meta.icon);
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", () => {
    // 双层保护：同步 throw 与异步 reject 都只记录日志，不冒泡到 click 事件。
    try {
      void Promise.resolve(meta.run(view)).catch((err) => {
        console.error(`[selection-action] run failed: ${meta.id}`, err);
      });
    } catch (err) {
      console.error(`[selection-action] run failed: ${meta.id}`, err);
    }
  });
  return btn;
}

/**
 * 悬浮栏显示时可用的选区动作：每次调用都重新求值 `when()`
 * （启动期配置可能晚于扩展注册到达）。单个动作抛错只跳过自身。
 * 按 `order` 升序（相等时保持注册序）。
 */
export function availableSelectionActions(): SelectionActionMeta[] {
  const result: SelectionActionMeta[] = [];
  for (const meta of editorSelectionActions()) {
    try {
      if (meta.when && !meta.when()) continue;
      result.push(meta);
    } catch (err) {
      console.error(`[selection-action] when failed: ${meta.id}`, err);
    }
  }
  return result.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** 重建动作区（按钮随 `when()` 结果变化，不能只在首次挂载时构建）。 */
export function syncActions(view: EditorView, tb: BuiltToolbar, actions: SelectionActionMeta[]): void {
  tb.actionHost.replaceChildren();
  for (const meta of actions) tb.actionHost.appendChild(mkActionBtn(view, meta));
  // 空 span 会吃掉父级 flex gap；无动作时直接隐藏。
  tb.actionHost.style.display = actions.length > 0 ? "" : "none";
}

/** 统一设置格式按钮与分隔符的可见性（动作区可见性由 syncActions 负责）。 */
function applyVisibility(tb: BuiltToolbar, hasActions: boolean, showFormat: boolean): void {
  for (const btn of tb.buttons) btn.el.style.display = showFormat ? "" : "none";
  tb.actionSep.style.display = showFormat && hasActions ? "" : "none";
}

/**
 * 只负责定位与可见性：不重新求值 `when()`、不重建按钮。
 * 滚动/resize 使用缓存的 actions 调用，避免重复触发贡献求值。
 */
function positionToolbar(
  view: EditorView,
  tb: BuiltToolbar,
  actions: SelectionActionMeta[],
  showFormat: boolean,
): void {
  const { from, to } = view.state.selection;
  // Nudge from/to off hidden delimiter chars: coordsAtPos on a
  // font-size:0 / display:none delim returns a degenerate rect, which
  // would throw the toolbar to the viewport corner. Query the rect of
  // the visible boundary chars instead (side -1 for `to` gives the
  // left-of/to boundary = the last visible char).
  const v = visibleBoundaries(view, from, to);
  const start = view.coordsAtPos(v.from, 1);
  const end = view.coordsAtPos(v.to, -1);
  if (!start || !end) return;

  // Display before measuring so the first show uses the real width
  // (including action buttons) instead of the fallback.
  tb.root.style.display = "flex";
  applyVisibility(tb, actions.length > 0, showFormat);

  const selTop = Math.min(start.top, end.top);
  const selBottom = Math.max(start.bottom, end.bottom);
  const selLeft = Math.min(start.left, end.left);
  const selRight = Math.max(start.right, end.right);
  const selWidth = selRight - selLeft;
  const tbWidth = tb.root.offsetWidth || 160;
  const tbHeight = tb.root.offsetHeight || 30;
  const gap = 6;

  let top: number;
  if (selTop >= tbHeight + gap) {
    top = selTop - tbHeight - gap;
  } else {
    top = selBottom + gap;
  }
  const left = selLeft + selWidth / 2 - tbWidth / 2;

  tb.root.style.top = `${Math.max(4, top)}px`;
  tb.root.style.left = `${Math.max(4, left)}px`;
}

export function inlineFormatToolbarPlugin(): Plugin {
  return new Plugin({
    view(view) {
      let toolbar: ReturnType<typeof buildToolbar> | null = null;
      let showTimer: ReturnType<typeof setTimeout> | null = null;
      let positionRaf: number | null = null;
      // 最近一次显示时的动作快照：滚动/resize 只重新定位，不重新求值 `when()`。
      let lastActions: SelectionActionMeta[] = [];
      let lastCanShowFormat = false;
      let lastActionIds = "";

      const cancelPositionFrame = () => {
        if (positionRaf !== null) {
          cancelAnimationFrame(positionRaf);
          positionRaf = null;
        }
      };

      const ensureMounted = () => {
        if (!toolbar) toolbar = buildToolbar(view);
        if (!toolbar.root.isConnected) document.body.appendChild(toolbar.root);
        return toolbar;
      };
      const unmount = () => {
        if (showTimer) { clearTimeout(showTimer); showTimer = null; }
        cancelPositionFrame();
        if (toolbar?.root.isConnected) {
          toolbar.root.style.display = "none";
          toolbar.root.remove();
        }
      };

      const applyActiveState = () => {
        if (!toolbar) return;
        for (const btn of toolbar.buttons) {
          const { meta } = btn;
          const active = meta.isActive
            ? meta.isActive(view.state)
            : selectionHasMark(view.state, meta.markName);
          btn.el.classList.toggle("active", active);
        }
      };

      // A selection whose visible text starts or ends with whitespace can't
      // be wrapped into a valid markdown delim (`** hello **` is not
      // recognized by the inline parser — canOpen/canClose require a
      // non-space neighbor). Hiding the toolbar prevents producing invalid
      // syntax.
      const selectionEdgesWhitespace = (): boolean => {
        const { from, to } = view.state.selection;
        if (from >= to) return true;
        // Use the *visible* boundaries: the raw selection may end on a
        // hidden delim char (`word **bold**` dragging up to the close `**`),
        // so textBetween on the raw range would see the `*` instead of the
        // real edge. Nudge first so the check matches what the user sees.
        const v = visibleBoundaries(view, from, to);
        const text = view.state.doc.textBetween(v.from, v.to);
        return /^\s/.test(text) || /\s$/.test(text);
      };

      /**
       * 原有格式按钮的显示条件。工具栏开关与只读只约束格式按钮，
       * 不约束选区动作（AI 按钮），因此这里不包含选区/焦点判断。
       */
      const formatConditionsOk = (): boolean => {
        if (!inlineFormatToolbarEnabled || !view.editable) return false;
        if (isInsideCodeBlock(view.state) || isInsideHeading(view.state)
          || isCrossBlockSelection(view.state) || isSelectionInSuppressedMark(view.state)) {
          return false;
        }
        return !selectionEdgesWhitespace();
      };

      const render = (actions: SelectionActionMeta[], showFormat: boolean) => {
        if (view.state.selection.empty || !view.hasFocus()) return;
        if (!showFormat && actions.length === 0) return;

        const tb = ensureMounted();
        const ids = actions.map((a) => a.id).join("\u0000");
        // 只有动作集合变化时才重建按钮；普通事务/滚动不重复创建 DOM。
        if (ids !== lastActionIds) {
          syncActions(view, tb, actions);
          lastActionIds = ids;
        }
        lastActions = actions;
        lastCanShowFormat = showFormat;

        positionToolbar(view, tb, actions, showFormat);
        applyActiveState();
      };

      const doShow = () => {
        showTimer = null;
        // 空选区不显示，也避免无谓地求值 `when()`。
        if (view.state.selection.empty) return;
        // `when()` 在显示时重新求值：启动期配置可能晚于扩展注册到达。
        render(availableSelectionActions(), formatConditionsOk());
      };

      const scheduleShow = () => {
        if (showTimer) clearTimeout(showTimer);
        showTimer = setTimeout(doShow, 500);
      };

      const isVisible = () => toolbar != null && toolbar.root.style.display !== "none";

      const update = () => {
        // 空选区直接隐藏，避免无谓地求值 `when()`。
        if (view.state.selection.empty) { unmount(); return; }
        // 一次求值同时用于「是否显示」与渲染，避免 `when()` 两次结果不一致。
        const actions = availableSelectionActions();
        const showFormat = formatConditionsOk();
        if (!view.hasFocus() || (!showFormat && actions.length === 0)) {
          unmount();
          return;
        }
        if (isVisible()) {
          // Toolbar already showing: re-sync buttons/active state and
          // reposition (a button click just applied/removed a mark without
          // changing the selection).
          render(actions, showFormat);
        } else {
          scheduleShow();
        }
      };

      // 滚动/resize 只按缓存重新定位；不调用 availableSelectionActions() / syncActions()。
      const reposition = () => {
        if (positionRaf !== null) return;
        positionRaf = requestAnimationFrame(() => {
          positionRaf = null;
          if (!toolbar || !isVisible()) return;
          positionToolbar(view, toolbar, lastActions, lastCanShowFormat);
        });
      };

      const onFocusOut = () => unmount();

      const onEnabledChanged = (e: Event) => {
        const detail = (e as CustomEvent<{ enabled: boolean }>).detail;
        if (detail && typeof detail.enabled === "boolean") {
          setInlineFormatToolbarEnabled(detail.enabled);
        }
        // 开关只影响格式按钮；动作按钮仍需按新状态刷新（关闭时不能整体卸载）。
        update();
      };

      view.dom.addEventListener("scroll", reposition, true);
      window.addEventListener("scroll", reposition, true);
      window.addEventListener("resize", reposition);
      view.dom.addEventListener("focusin", update);
      view.dom.addEventListener("focusout", onFocusOut);
      window.addEventListener(INLINE_FORMAT_TOOLBAR_CHANGED_EVENT, onEnabledChanged);

      return {
        update() { update(); },
        destroy() {
          window.removeEventListener("scroll", reposition, true);
          window.removeEventListener("resize", reposition);
          view.dom.removeEventListener("scroll", reposition, true);
          window.removeEventListener(INLINE_FORMAT_TOOLBAR_CHANGED_EVENT, onEnabledChanged);
          view.dom.removeEventListener("focusin", update);
          view.dom.removeEventListener("focusout", onFocusOut);
          if (showTimer) clearTimeout(showTimer);
          cancelPositionFrame();
          if (toolbar?.root.isConnected) toolbar.root.remove();
        },
      };
    },
  });
}

export const inlineFormatToolbar: FeatureSpec = {
  name: "inline-format-toolbar",
  plugins: () => [inlineFormatToolbarPlugin()],
};
