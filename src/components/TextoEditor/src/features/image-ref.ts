import type { Node as PMNode } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import type { EditorView, NodeView, ViewMutationRecord } from "prosemirror-view";
import {
  EMBED_REF_RE as IMAGE_REF_RE,
  MARKDOWN_EDITOR_EXTENSION,
  parseEmbedRef as parseImageRefSource,
} from "@texto/markdown-editor-api";
import type {
  EmbedRef as ImageRefSource,
  PreviewContext,
  PreviewRegion,
} from "@texto/markdown-editor-api";
import { getContributions } from "@texto/plugin-sdk";

import { getEditorHost } from "../host.ts";

import { isInComposition } from "../composition.ts";
import type { FeatureSpec } from "./_types.ts";
import { getDocumentDir } from "../doc-info.ts";
import {
  createZoomTrigger,
  openMediaContainer,
  svgDownloadNameFromSource,
} from "./image-viewer.ts";
import { focusBlockStart, isSelectionInsideBlock } from "./render-container.ts";

export { IMAGE_REF_RE, parseImageRefSource };
export type { ImageRefSource };

// `![](url)` 图片引用 —— 统一为块级组件，编辑体验对齐 mermaid。
//
// 独占一行的 `![alt](url "title")` 解析为 image_ref 块节点，节点内容就是
// 源码文本本身（content: "text*"、code: true，normalize/行内解析跳过）。
// NodeView 做两态切换：
//   - 光标在节点内（上下键移入 / 点击预览）→ 源码编辑态，直接改 URL 文本
//   - 光标移出（焦点离开）→ 预览态：普通图片渲染 <img>，白板引用渲染
//     内联 SVG 预览（懒加载）
//
// 白板预览额外提供 hover chrome："打开"（进入白板编辑器）与"更换文件"。
// 段落中间的 `![]()` 保持行内图片，不强制断行。

// ─────────────────────────────────────────────────────────────────────────────
// NodeView：预览 / 源码编辑两态
// ─────────────────────────────────────────────────────────────────────────────

const liveViews = new Set<ImageRefNodeView>();

/** 当前 src 归属的嵌入扩展 id（后注册优先）；无匹配返回 null。 */
function embedOwner(src: string | undefined): string | null {
  if (!src) return null;
  const exts = getContributions(MARKDOWN_EDITOR_EXTENSION);
  for (let i = exts.length - 1; i >= 0; i -= 1) {
    const e = exts[i]!;
    if (e.embed?.matches?.(src)) return e.id;
  }
  return null;
}

class ImageRefNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: PMNode;
  private view: EditorView;
  private getPos: () => number | undefined;
  protected preview: PreviewRegion | null = null;
  private renderContainer: HTMLElement;
  private sourceEl: HTMLElement;
  private mode: "code" | "render" | "error" = "code";

  constructor(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
    preview?: PreviewRegion,
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.preview = preview ?? null;

    const wrap = document.createElement("div");
    wrap.className = "image-ref-block";

    this.renderContainer = document.createElement("div");
    this.renderContainer.className = "image-ref-render";
    this.renderContainer.style.display = "none";

    this.sourceEl = document.createElement("div");
    this.sourceEl.className = "image-ref-source";

    wrap.appendChild(this.renderContainer);
    wrap.appendChild(this.sourceEl);
    this.dom = wrap;
    this.contentDOM = this.sourceEl;

    // 点击预览 → 光标移入源码（进入编辑态），与代码块 render 容器一致；
    // chrome 按钮不触发。锁定模式下预览是不可交互的渲染输出：吞掉
    // mousedown，避免 PM/浏览器把光标放回块内文本而触发源码态。
    this.renderContainer.addEventListener("mousedown", (e) => {
      // 只处理左键；右键必须放行，交给编辑器的右键菜单流程
      if (e.button !== 0) {
        // 兜底：右键不移动光标（编辑器根 mousedown 守卫已统一处理）。
        if (e.button === 2) e.preventDefault();
        return;
      }
      // 与代码块渲染容器同一条守卫：任何 mode（含错误态）都阻止浏览器默认
      // 落点，否则 DOM 选区会被放进 SVG/错误面板，PM 同步后光标丢失并回顶。
      e.preventDefault();
      if (this.mode === "code" || !this.view.editable) return;
      // 先切源码态再派发选区，避免选区落进 display:none 的源码区。
      this.enterCodeMode();
      focusBlockStart(this.view, this.getPos(), this.dom, e.clientY);
    });

    // 锁定模式（阅读模式）：预览不可编辑，点击图片直接放大浏览
    this.renderContainer.addEventListener("click", (e) => {
      if (this.mode !== "render" || this.view.editable) return;
      e.preventDefault();
      e.stopPropagation();
      openMediaContainer(this.renderContainer, {
        suggestedName: this.preview
          ? svgDownloadNameFromSource(
              parseImageRefSource(this.node.textContent)?.src,
            )
          : undefined,
      });
    });

    liveViews.add(this);

    // 构造时把 src 打到 wrapper 上，供 pretty DSL / 测试断言
    const ref = parseImageRefSource(node.textContent);
    if (ref) wrap.setAttribute("data-src", ref.src);

    this.onSelectionChange();
  }

  private isCursorInside(): boolean {
    return isSelectionInsideBlock(this.view, this.getPos(), this.node.nodeSize);
  }

  private enterCodeMode(): void {
    if (this.mode === "code") return;
    this.mode = "code";
    this.renderContainer.style.display = "none";
    this.sourceEl.style.display = "";
  }

  private enterRenderMode(): void {
    if (this.mode === "render") return;
    this.mode = "render";
    this.sourceEl.style.display = "none";
    this.renderContainer.style.display = "";
    this.render();
  }

  private render(): void {
    this.renderContainer.innerHTML = "";
    const ref = parseImageRefSource(this.node.textContent);
    if (!ref) {
      this.mode = "error";
      const div = document.createElement("div");
      div.className = "image-ref-error";
      div.textContent = "Not a valid image reference";
      this.renderContainer.appendChild(div);
      return;
    }
    this.dom.setAttribute("data-src", ref.src);
    const documentDir = getDocumentDir(this.view.state);

    if (this.preview) {
      this.renderContainer.appendChild(this.preview.dom);
      this.runPreview();
    } else {
      // 普通图片
      const resolved = getEditorHost().resolveImageSrc(ref.src, documentDir);
      if (!resolved) {
        this.mode = "error";
        const div = document.createElement("div");
        div.className = "image-ref-error";
        div.textContent = "No document path — save the document first";
        this.renderContainer.appendChild(div);
        return;
      }
      const img = document.createElement("img");
      img.className = "image-ref-img";
      img.src = resolved;
      img.alt = ref.alt;
      if (ref.title) img.title = ref.title;
      img.loading = "lazy";
      img.decoding = "async";
      this.renderContainer.appendChild(img);
    }

    // 右上角 hover 放大按钮（每次重渲染重建，事件在点击时才读容器内容）
    const previewName = this.preview
      ? svgDownloadNameFromSource(ref.src)
      : undefined;
    this.renderContainer.appendChild(
      createZoomTrigger(this.renderContainer, { suggestedName: previewName }),
    );
  }

  private previewCtx(): PreviewContext {
    return {
      documentDir: getDocumentDir(this.view.state),
      theme: "base",
      onError: (msg) => this.showPreviewError(msg),
    };
  }

  private runPreview(): void {
    try {
      this.preview?.update?.(this.node, this.previewCtx());
    } catch (e) {
      this.showPreviewError((e as Error)?.message ?? String(e));
    }
  }

  private showPreviewError(msg: string): void {
    // 用户已进入源码态：异步预览失败不得抢走编辑态（两态并置会让布局跳变、
    // 把 DOM 选区挤出源码区）。下次进入渲染态重新渲染时错误会正常呈现。
    if (this.mode === "code") return;
    this.mode = "error";
    this.renderContainer.innerHTML = "";
    const div = document.createElement("div");
    div.className = "image-ref-error";
    div.textContent = msg;
    this.renderContainer.appendChild(div);
  }

  onSelectionChange(): void {
    // 锁定模式：白板/图片预览是纯渲染输出。光标即使因点击或键盘导航
    // 落入块内，也不得切到源码编辑态暴露 `![](...)` 原文。
    if (!this.view.editable) {
      this.enterRenderMode();
      return;
    }
    if (this.isCursorInside()) {
      this.enterCodeMode();
    } else if (this.node.textContent.trim()) {
      this.enterRenderMode();
    } else {
      this.enterCodeMode();
    }
  }

  update(updated: PMNode): boolean {
    if (updated.type !== this.node.type) return false;
    const prevSrc = parseImageRefSource(this.node.textContent)?.src;
    const nextSrc = parseImageRefSource(updated.textContent)?.src;
    if (embedOwner(prevSrc) !== embedOwner(nextSrc)) {
      // 嵌入归属变化：让 PM 重建 NodeView，由分发器重新认领/回退普通图片
      return false;
    }
    const textChanged = updated.textContent !== this.node.textContent;
    this.node = updated;
    if (textChanged && this.mode === "render") {
      this.render();
    }
    this.onSelectionChange();
    return true;
  }

  destroy(): void {
    liveViews.delete(this);
    this.preview?.destroy?.();
  }

  // 预览容器（含异步插入的白板 SVG / 占位、以及本 NodeView 自己写的属性）
  // 由 NodeView 自行管理，不是文档内容。PM 默认在「有 contentDOM 的 NodeView」
  // 上不忽略任何变更，会把异步插入的预览当作 DOM 编辑而重建 NodeView，
  // 新 NodeView 再次渲染 → 异步插入 → 再重建……形成无界的重渲染循环
  // （白板预览每次循环还要同步跑 exportToSvg，直接卡死主线程）。
  // 只有源码编辑区（contentDOM）内的变更才需要交给 ProseMirror。
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (!this.contentDOM) return true;
    return !this.contentDOM.contains(mutation.target);
  }
}

export function createImageRefNodeView(
  node: PMNode,
  view: EditorView,
  getPos: () => number | undefined,
  preview?: PreviewRegion,
): ImageRefNodeView {
  return new ImageRefNodeView(node, view, getPos, preview);
}

// 光标变化（纯 selection 事务不触发 NodeView.update）→ 通知所有块同步模式
function imageRefSelectionPlugin(): Plugin {
  return new Plugin({
    view: () => ({
      update: () => {
        for (const v of liveViews) v.onSelectionChange();
      },
    }),
  });
}

// 输入过程中「独占一行的 `![](...)` 一写完就切到块源码态」，不再停留
// 在行内图片管线（img widget + 源码显隐）里等 Enter。
//
// 两个方向：
//   - 段落恰好成为完整引用（一般是刚敲完 `)`）→ 立即替换为 image_ref 块，
//     光标按原偏移留在块内 → NodeView 自动进入源码编辑态（.image-ref-source）
//   - 块文本不再是完整引用（续写正文 / 引用被改成不完整格式）→ 回退为
//     普通段落 —— 格式不满足时不该被困在块源码态里
//
// undo/redo 与 IME 组合期间不自动转换，保证撤销可恢复、输入法不被打断。
function immediateImageRefCommitPlugin(): Plugin {
  return new Plugin({
    appendTransaction(trs, oldState, newState) {
      if (isInComposition()) return null;
      const lastTr = trs[trs.length - 1];
      // 自动配对下收尾的 `)` 是纯 selection 事务（跳过已配对的括号）。
      // 用户敲下它时光标越过 `)` 到达段尾，引用才算真正写完——只有这种
      // selection 事务才允许触发提交；其余 selection 事务一律忽略。
      const typedClosingParen =
        !lastTr?.docChanged &&
        oldState.selection.from + 1 === newState.selection.from &&
        oldState.doc.textBetween(
          oldState.selection.from,
          oldState.selection.from + 1,
        ) === ")";
      if (!lastTr?.docChanged && !typedClosingParen) return null;
      if (trs.some((tr) => tr.getMeta("history"))) return null;

      const $head = newState.selection.$head;
      const parent = $head.parent;
      const schema = newState.schema;

      // 段落 → 块：整段恰好是完整引用（刚输入完成 / 粘贴独占行）
      if (
        parent.type.name === "paragraph" &&
        !(
          $head.depth > 0 &&
          $head.node($head.depth - 1).type.name === "list_item"
        )
      ) {
        const text = parent.textContent;
        if (!IMAGE_REF_RE.test(text)) return null;
        // 光标必须在段尾：src 一非空就会被自动配对的 `)` 补成"完整引用"，
        // 但此时用户可能还在输入 src（如含空格的路径）。只有光标越过右括号
        // 到达段尾，才说明引用真的写完，避免格式未满足就提前切成块源码态。
        if ($head.parentOffset !== $head.parent.content.size) return null;
        // 只有「本次事务让它变成完整引用」才转换：oldState 同位置段落此前
        // 不匹配。避免 undo 之后光标一动就被重新转换（撤销形同虚设）。
        const oldPos = lastTr.mapping.invert().map($head.before());
        const oldNode = oldState.doc.nodeAt(oldPos);
        if (oldNode?.type.name !== "paragraph") return null;
        // 跳过括号场景下 oldState 的文本因自动配对已经完整（`![x](y)`），
        // 不能用文本匹配做"刚刚完整"判定；此时以 typedClosingParen 为准。
        if (!typedClosingParen && IMAGE_REF_RE.test(oldNode.textContent)) return null;

        const paraStart = $head.before();
        const paraEnd = $head.after();
        const node = schema.nodes.image_ref.create(null, schema.text(text));
        const tr = newState.tr.replaceWith(paraStart, paraEnd, node);
        const offset = Math.min($head.parentOffset, text.length);
        tr.setSelection(TextSelection.create(tr.doc, paraStart + 1 + offset));
        return tr;
      }

      // 块 → 段落：文本不再是完整引用（被续写正文，或引用本身被改成不完整
      // 格式）就回退为普通段落。
      //
      // 这样有两个效果：
      //  - 格式不满足时不再一直显示 image-ref-source 源码框（与 parse 侧一致：
      //    非法引用解析为普通段落）；
      //  - serialize/parse round-trip 稳定：块会原样写出文本，而普通段落会按
      //    Markdown 转义（如 `[` → `\[`）。若块在非法状态下被保存，重载后
      //    解析成段落，序列化结果与文件内容不一致，保存/重载链路会反复改写
      //    文件（用户保存后卡顿的根因）。
      //
      // 光标位置保持不变：替换为同文本段落并按原选区映射。
      if (parent.type.name === "image_ref") {
        const text = parent.textContent;
        if (IMAGE_REF_RE.test(text)) return null;

        const blockStart = $head.before();
        const blockEnd = $head.after();
        // 文本可能为空（整段删除）：空 text 节点会抛异常，需用空段落
        const para = text
          ? schema.nodes.paragraph.create(null, schema.text(text))
          : schema.nodes.paragraph.create();
        const tr = newState.tr.replaceWith(blockStart, blockEnd, para);
        const selFrom = newState.selection.from;
        if (selFrom > blockStart && selFrom < blockEnd) {
          // 光标在块文本内：新段落文本相同，按原偏移放回
          const offset = Math.min($head.parentOffset, text.length);
          tr.setSelection(TextSelection.create(tr.doc, blockStart + 1 + offset));
        } else {
          // 光标在块外（如外部重载/undo）：映射原位置
          const mapped = Math.min(tr.mapping.map(selFrom), tr.doc.content.size);
          tr.setSelection(TextSelection.create(tr.doc, mapped));
        }
        return tr;
      }

      return null;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FeatureSpec
// ─────────────────────────────────────────────────────────────────────────────

function transformBlocks(node: PMNode): PMNode {
  const schema = node.type.schema;
  const refType = schema.nodes.image_ref;
  if (!refType) return node;
  if (node.type.name === "image_ref") return node;

  const out: PMNode[] = [];
  let changed = false;
  node.forEach((child) => {
    // list_item 的 content 是 `paragraph block*`，首个块必须是 paragraph；
    // 若在列表项内把首个段落换成 image_ref，createAndFill 会填充一个空
    // 段落（渲染出"空列表行 + 下方图片"）。列表项内保持行内图片，不转换。
    if (child.type.name === "paragraph" && node.type.name !== "list_item") {
      const ref = parseImageRefSource(child.textContent);
      if (ref) {
        out.push(
          refType.create(
            null,
            child.textContent.trim() ? [schema.text(child.textContent.trim())] : [],
          ),
        );
        changed = true;
        return;
      }
    }
    const next =
      child.isBlock && child.childCount > 0 ? transformBlocks(child) : child;
    out.push(next);
    if (next !== child) changed = true;
  });
  return changed ? node.type.createAndFill(node.attrs, out)! : node;
}

export const imageRef: FeatureSpec = {
  name: "image-ref",

  nodes: {
    image_ref: {
      group: "block",
      content: "text*",
      marks: "",
      code: true,
      defining: true,
      toDOM: () => ["div", { class: "image-ref-block" }, 0],
    },
  },

  parserPostProcess: (doc) => transformBlocks(doc),

  blockHandlers: {
    image_ref: (state, node) => {
      // 源码文本原样写出，roundtrip 无损
      state.write(node.textContent);
      state.closeBlock(node);
    },
  },

  keymap: () => ({
    // 独占一行的 `![](...)` 在 Enter 时提交为块（同 ref-def/toc 模式）
    Enter: (state, dispatch) => {
      const sel = state.selection;
      if (!sel.empty) return false;
      const $from = sel.$from;

      // 源码编辑态内回车 → 退出到下方新段落（不在 `![]()` 里插换行）
      if ($from.parent.type.name === "image_ref") {
        if (dispatch) {
          const schema = state.schema;
          const blockEnd = $from.after();
          const tr = state.tr;
          tr.insert(blockEnd, schema.nodes.paragraph.create());
          tr.setSelection(TextSelection.create(tr.doc, blockEnd + 1));
          dispatch(tr);
        }
        return true;
      }

      if ($from.parent.type.name !== "paragraph") return false;
      // 列表项内不提交为块（同 parse 侧：list_item 首个块必须是 paragraph，
      // 转换会产生空段落填充，破坏渲染）。注意 Node 没有 .parent 属性，
      // 必须通过 ResolvedPos 取祖先（$from.node($from.depth - 1)）。
      if (
        $from.depth > 0 &&
        $from.node($from.depth - 1).type.name === "list_item"
      ) {
        return false;
      }
      const ref = parseImageRefSource($from.parent.textContent);
      if (!ref) return false;
      if (dispatch) {
        const schema = state.schema;
        const node = schema.nodes.image_ref.create(
          null,
          schema.text($from.parent.textContent.trim()),
        );
        const paraStart = $from.before();
        const paraEnd = $from.after();
        const tr = state.tr;
        tr.replaceWith(paraStart, paraEnd, [
          node,
          schema.nodes.paragraph.create(),
        ]);
        tr.setSelection(TextSelection.create(tr.doc, paraStart + node.nodeSize + 1));
        dispatch(tr);
      }
      return true;
    },
  }),

  plugins: () => [
    imageRefSelectionPlugin(),
    immediateImageRefCommitPlugin(),
  ],
};
