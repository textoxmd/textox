// Cursor-aware syntax hints — Typora's signature visual: when the cursor sits
// inside a mark range, show the source delimiters (*, **, `, ~~, [, ]) as a
// gray hint; when it leaves, hide them.
//
// Every inline feature (em/strong/code/strike/link) follows method-B: the
// delim chars live in the textblock text and `normalize` derives the marks.
// This plugin just reads normalize's delim ranges and wraps each in an
// inline Decoration whose class tells the stylesheet (and test-pretty)
// whether to show it gray (cursor inside the surrounding span) or hide it
// (cursor outside).

import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

import { getDelims, getExtras, getWidgets, type WidgetDecoration } from "./normalize.ts";
import { collectDecorationWidgets } from "./features/index.ts";
import { editablePluginKey } from "./editable-key.ts";
import { getDocumentDir } from "./doc-info.ts";
import { getEditorHost } from "./host.ts";
import { getViewport, getViewportDocRange, sameViewport } from "./viewport.ts";
import { isImageUploading } from "./features/image-upload-state.ts";
import { registerImageProbe } from "./features/image.ts";
import { openMediaContainer } from "./features/image-viewer.ts";

// Widget builders — keyed by `kind`. A widget renders as a DOM element
// at a specific position; decorations.ts decides whether to emit it based
// on the cursor's relation to the parent span.
type WidgetBuilderCtx = { documentDir: string | null };
const builtinWidgetBuilders: Record<
  string,
  (attrs: Record<string, string>, ctx: WidgetBuilderCtx) => HTMLElement
> = {
  "image-render": (attrs) => {
    const img = document.createElement("img");
    // Linked image badges stay inline (single-line link); standalone
    // images render as blocks on their own line.
    img.className =
      attrs.inline === "1" ? "image-render image-render-inline" : "image-render";
    if (attrs.src) img.setAttribute("src", attrs.src);
    if (attrs.alt) img.setAttribute("alt", attrs.alt);
    if (attrs.title) img.setAttribute("title", attrs.title);
    // 懒加载：正文/标记文本优先渲染，图片接近视口才发起请求；解码异步、
    // 低优先级，避免打开文档时一次性拉满所有图片（含离屏图与注定 403/404
    // 的坏图），减少首屏请求数与报错刷屏。
    img.loading = "lazy";
    img.decoding = "async";
    img.fetchPriority = "low";

    // 行内图片没有 hover chrome（会打乱行内排版）：双击放大浏览。
    img.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMediaContainer(img);
    });

    // 右键（非主键）不得移动光标：光标进入源码范围会把渲染态切回 ![alt](url)。
    // 只 preventDefault、不 stopPropagation —— 左键与 cmd+click 依赖 mousedown
    // 冒泡给 ProseMirror（见该 decoration 的 stopEvent 放行说明）。
    img.addEventListener("mousedown", (e) => {
      if (e.button !== 0) e.preventDefault();
    });

    if (attrs.uploading === "1") {
      const wrapper = document.createElement("span");
      wrapper.className = "image-uploading";
      const spinner = document.createElement("span");
      spinner.className = "uploading-spinner";
      wrapper.appendChild(img);
      wrapper.appendChild(spinner);
      return wrapper;
    }

    return img;
  },
  checkbox: (attrs) => {
    // Task-list checkbox. data-checked stamped so test-pretty can
    // surface state and so the click handler in the task feature can
    // toggle it via its own DOM event listener (we don't take
    // visible margin from the source — the gap between checkbox and
    // text comes from `.checkbox` margin-right CSS).
    const el = document.createElement("span");
    el.className = "checkbox";
    el.setAttribute("data-checked", attrs.checked === "1" ? "1" : "0");
    return el;
  },
  "file-input": (attrs) => {
    // Wrapping element: PM marks widgets contenteditable=false but a real
    // <input type="file"> still misbehaves inside contenteditable (focus
    // tug-of-war with the surrounding editable area, observed as input
    // hangs in Chromium). We render a non-editable <span> trigger that
    // lazily spawns a detached <input> on click.
    const el = document.createElement("span");
    el.className = "file-input";
    el.setAttribute("contenteditable", "false");
    el.textContent = "📎";
    el.addEventListener("mousedown", (e) => {
      // Prevent focus from leaving the editor.
      e.preventDefault();
    });
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = document.createElement("input");
      input.type = "file";
      if (attrs.accept) input.accept = attrs.accept;
      input.style.display = "none";
      input.addEventListener("change", () => {
        // Bubble up via a synthetic CustomEvent on the trigger so the
        // image plugin (which delegates from the editor root) can pick
        // it up uniformly with the input's own `change`.
        el.dispatchEvent(
          new CustomEvent("file-input-pick", {
            bubbles: true,
            detail: { files: input.files },
          }),
        );
        document.body.removeChild(input);
      });
      document.body.appendChild(input);
      input.click();
    });
    return el;
  },
};

let _widgetBuilders: Record<
  string,
  (attrs: Record<string, string>, ctx: WidgetBuilderCtx) => HTMLElement
> | undefined;

// 惰性合并：内置 builders + 插件贡献（插件优先），首次构建装饰时计算。
function getWidgetBuilders(): Record<
  string,
  (attrs: Record<string, string>, ctx: WidgetBuilderCtx) => HTMLElement
> {
  return (_widgetBuilders ??= { ...builtinWidgetBuilders, ...collectDecorationWidgets() });
}

function isLinkedImage(state: EditorState, w: WidgetDecoration): boolean {
  // A link mark covering the image span means `[![alt](src)](href)` —
  // the image is inside a link and must render inline.
  let linked = false;
  state.doc.nodesBetween(w.spanFrom, w.spanTo, (node) => {
    if (node.isText && node.marks.some((m) => m.type.name === "link")) {
      linked = true;
      return false;
    }
    return true;
  });
  return linked;
}

function buildWidget(w: WidgetDecoration, documentDir: string | null): HTMLElement {
  let attrs = w.attrs ?? {};
  let originalSrc: string | null = null;
  if (w.kind === "image-render" && attrs.src) {
    originalSrc = attrs.src;
    if (isImageUploading(originalSrc)) {
      attrs = { ...attrs, uploading: "1" };
    }
    const resolved = getEditorHost().resolveImageSrc(originalSrc, documentDir);
    if (resolved !== null) {
      attrs = { ...attrs, src: resolved };
    } else {
      attrs = { ...attrs, src: "" };
    }
  }
  const builder = getWidgetBuilders()[w.kind];
  const el = builder
    ? builder(attrs, { documentDir })
    : (() => {
        const span = document.createElement("span");
        span.className = w.kind;
        return span;
      })();
  // 懒探测：widget 接近视口时才发起图片加载探测（image.ts 的探针），
  // 配合 <img loading="lazy"> 让正文先渲染、图片按滚动渐进加载。
  // 用原始 src（解析前的写法）作为 status map 的 key。
  if (w.kind === "image-render" && originalSrc) {
    const imgEl = el instanceof HTMLImageElement ? el : el.querySelector("img") as HTMLImageElement | null;
    if (imgEl) {
      imgEl.dataset.probeSrc = originalSrc;
      registerImageProbe(imgEl);
    }
  }
  // Make sure PM/browser don't treat the widget DOM as editable content
  // (otherwise typing near a widget can land in the widget's textContent
  // instead of the doc, which we observed as a hang while typing inside
  // an image span).
  el.setAttribute("contenteditable", "false");
  el.setAttribute("data-pos", String(w.pos));
  return el;
}

function buildDecorationSet(state: EditorState): DecorationSet {
  const decos: Decoration[] = [];
  // While the mouse is held down, treat the cursor as absent so no delim
  // is revealed — the line keeps its stable (hidden-delim) layout for the
  // whole drag. mouseDown is set/cleared by the plugin's view hook.
  const cursor = state.selection.empty && !mouseDown ? state.selection.from : null;
  const editable = editablePluginKey.getState(state) ?? true;
  const documentDir = getDocumentDir(state);
  const vp = getViewport(state);

  let delims = getDelims(state);
  let extras = getExtras(state);
  let widgets = getWidgets(state);

  if (!vp.fullDoc) {
    // 与 normalize 的窗口过滤同一份实现（getViewportDocRange），避免在这里
    // 再写一遍「从文档头走到窗口末尾」的遍历。
    const range = getViewportDocRange(state);
    if (range) {
      const { from: rangeFrom, to: rangeTo } = range;
      delims = delims.filter((d) => d.spanFrom < rangeTo && d.spanTo > rangeFrom);
      extras = extras.filter((ex) => ex.from < rangeTo && ex.to > rangeFrom);
      widgets = widgets.filter((w) => w.pos >= rangeFrom && w.pos < rangeTo);
    }
  }

  for (const d of delims) {
    const cursorInside =
      cursor !== null && cursor >= d.spanFrom && cursor <= d.spanTo;
    if (d.forceHidden) {
      decos.push(
        Decoration.inline(d.from, d.to, {
          class: d.className ?? "syntax-hidden",
        }),
      );
      continue;
    }
    if (d.softInside) {
      // Soft range: hidden when cursor outside, plain (no decoration)
      // when cursor inside so the chars render as ordinary text.
      // When not editable (locked), always hide — no source reveal.
      if (!cursorInside || !editable) {
        decos.push(Decoration.inline(d.from, d.to, { class: "syntax-hidden" }));
      }
      continue;
    }
    // When not editable (locked), never show syntax hints.
    const visible = editable && (d.forceVisible || cursorInside);
    const cls = visible ? "syntax-hint" : "syntax-hidden";
    decos.push(Decoration.inline(d.from, d.to, { class: cls }));
  }
  for (const ex of extras) {
    decos.push(
      Decoration.inline(ex.from, ex.to, { nodeName: ex.nodeName, ...(ex.attrs ?? {}) }),
    );
  }
  for (const w of widgets) {
    const cursorInsideSpan =
      cursor !== null && cursor >= w.spanFrom && cursor <= w.spanTo;
    if (w.when === "inside" && !cursorInsideSpan) continue;
    if (w.when === "outside" && cursorInsideSpan) continue;
    // Linked image: `[![alt](src)](href)` renders as an inline badge
    // (the image is the link's display content), not as a standalone
    // block image. Detect via the doc — if a link mark covers the image
    // span, the <img> must stay inline so the link stays single-line.
    let attrs = w.attrs ?? {};
    if (w.kind === "image-render" && isLinkedImage(state, w)) {
      attrs = { ...attrs, inline: "1" };
    }
    const dom = buildWidget({ ...w, attrs }, documentDir);
    // 内置 widget 沿用既有事件语义：除 click 外吞掉事件（避免图片刚出现时事件
    // 回灌触发 auto-pair/normalize 循环）；image-render 额外放行 mousedown 以便
    // cmd+click 打开链接。插件 widget 默认使用 PM 默认 spec——放行事件，否则
    // mousedown 被吞会导致点击公式无法把光标放入、无法编辑；原子/纯装饰型插件
    // widget 可声明 `stopEvents: true` 沿用内置的「吞事件」语义（如 emoji glyph）。
    // 内置 kind 名（image-render / checkbox / file-input）为保留字：
    // 插件若用同名 kind，会因合并优先级覆盖内置 builder 并继承内置事件语义
    // （除 click 外吞事件、放行 image 的 mousedown）。插件请使用独立 kind。
    const isBuiltinKind = Object.prototype.hasOwnProperty.call(builtinWidgetBuilders, w.kind);
    const stopEvents = isBuiltinKind || w.stopEvents === true;
    decos.push(
      Decoration.widget(
        w.pos,
        dom,
        stopEvents
          ? {
              side: w.side ?? -1,
              key: `${w.kind}@${w.pos}`,
              ignoreSelection: true,
              // PM should not forward DOM events bubbled out of the widget
              // back as editor input — otherwise input/keydown fired around
              // the widget mount can land in handleTextInput and re-trigger
              // our own auto-pair / normalize work, which we observed looping
              // when an image span first appears mid-typing. Images additionally
              // let mousedown through so PM's click flow (handleClick) can reach
              // link-wrapped images (cmd+click opens the link). Other widgets
              // (file-input) keep the old fully-stopped behavior.
              stopEvent: (e: Event) =>
                e.type !== "click" && (w.kind !== "image-render" || e.type !== "mousedown"),
            }
          : {
              side: w.side ?? -1,
              key: `${w.kind}@${w.pos}`,
            },
      ),
    );
  }
  return decos.length > 0 ? DecorationSet.create(state.doc, decos) : DecorationSet.empty;
}

function cursorBlockPos(state: EditorState): number | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).isTextblock) return $from.before(d);
  }
  return null;
}

function blockHasDelims(state: EditorState, blockPos: number): boolean {
  const node = state.doc.nodeAt(blockPos);
  if (!node) return false;
  const blockEnd = blockPos + node.nodeSize;
  return getDelims(state).some(
    (d) => d.spanFrom < blockEnd && d.spanTo > blockPos,
  );
}

type SyntaxHintsState = {
  set: DecorationSet;
  prevBlock: number | null;
};

const syntaxHintsKey = new PluginKey<SyntaxHintsState>("syntaxHints");

// While the mouse button is held down (drag selection), delimiter reveal
// is suppressed so the layout stays stable under the pointer. Revealing a
// delim adds gray chars (width), hiding it collapses them — toggling that
// mid-drag reflows the line, which is the jitter users feel when trying to
// select text that crosses mark spans. On mouseup we dispatch a rebuild so
// a plain click (empty selection inside a span) still reveals the source
// delimiters.
//
// The press state is per-editor, not global: `mouseDownOwner` records which
// view initiated the press, so a mouseup/blur only resets that view, and a
// click outside any editor's DOM (toolbar, dialogs, a hidden IR editor in
// SV mode) never starts a press here.
let mouseDown = false;
let mouseDownOwner: EditorView | null = null;
const MOUSEUP_META = "syntax-hints-mouseup";

export function setSyntaxHintsMouseDown(down: boolean): void {
  mouseDown = down;
}

export function syntaxHintsPlugin(): Plugin<SyntaxHintsState> {
  return new Plugin<SyntaxHintsState>({
    key: syntaxHintsKey,
    view(view) {
      const doc = view.dom.ownerDocument;
      let destroyed = false;
      const onMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        if (!view.dom.contains(e.target as Node)) return;
        mouseDownOwner = view;
        mouseDown = true;
      };
      const release = (): boolean => {
        if (mouseDownOwner !== view) return false;
        mouseDownOwner = null;
        mouseDown = false;
        return true;
      };
      const onMouseUp = (e: MouseEvent) => {
        if (e.button !== 0) return;
        if (!release()) return;
        // Force a rebuild so a plain click (empty selection, cursor inside
        // a span) reveals the delims again after the press. PM may not
        // dispatch a selection transaction for a click whose caret didn't
        // move, so we dispatch a meta-only tx ourselves. Deferred to the
        // next tick: PM's own mouseup/click flow reads the DOM during this
        // event, and re-rendering synchronously here would detach the
        // target node before that (breaking cmd+click link navigation).
        setTimeout(() => {
          if (destroyed) return;
          view.dispatch(view.state.tr.setMeta(MOUSEUP_META, true));
        }, 0);
      };
      const onBlur = () => {
        if (!release()) return;
        setTimeout(() => {
          if (destroyed) return;
          view.dispatch(view.state.tr.setMeta(MOUSEUP_META, true));
        }, 0);
      };
      doc.addEventListener("mousedown", onMouseDown);
      doc.addEventListener("mouseup", onMouseUp);
      window.addEventListener("blur", onBlur);
      return {
        destroy() {
          destroyed = true;
          doc.removeEventListener("mousedown", onMouseDown);
          doc.removeEventListener("mouseup", onMouseUp);
          window.removeEventListener("blur", onBlur);
          release();
        },
      };
    },
    state: {
      init: (_, state) => {
        const set = buildDecorationSet(state);
        return { set, prevBlock: cursorBlockPos(state) };
      },
      apply: (tr, prev, oldState, newState) => {
        const viewportChanged = !sameViewport(
          getViewport(oldState),
          getViewport(newState),
        );
        if (
          tr.docChanged ||
          viewportChanged ||
          tr.getMeta("image-upload-state-changed") ||
          tr.getMeta(MOUSEUP_META)
        ) {
          const set = buildDecorationSet(newState);
          return { set, prevBlock: cursorBlockPos(newState) };
        }
        // Selection-only: skip rebuild if cursor stays in a block with no delims
        if (newState.selection.empty) {
          const block = cursorBlockPos(newState);
          if (block !== null && block === prev.prevBlock && !blockHasDelims(newState, block)) {
            return prev;
          }
          const set = buildDecorationSet(newState);
          return { set, prevBlock: block };
        }
        const set = buildDecorationSet(newState);
        return { set, prevBlock: null };
      },
    },
    props: {
      decorations(state) {
        return syntaxHintsKey.getState(state)?.set ?? DecorationSet.empty;
      },
    },
  });
}
