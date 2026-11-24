import { EditorState, Plugin, Selection, TextSelection, Transaction } from "prosemirror-state";
import type { Node as PMNode, ResolvedPos } from "prosemirror-model";
import { EditorView } from "prosemirror-view";

import { defaultPlugins } from "./editor.ts";
import { parse } from "./parser.ts";
import { getSchema } from "./schema.ts";
import { serialize } from "./serializer.ts";
import { isSourcePreserveEnabled } from "./source-preserve-config.ts";
import {
  parseWithSource,
  preservedLineColToPos,
  preservedPosToLineCol,
  preservedHeadingLines,
  serializePreserving,
  type PreservationContext,
} from "./source-preserve.ts";
import * as posMap from "./position.ts";
import type { CursorRange, ScrollAlign } from "./history/types.ts";
import { getScrollParent } from "./scroll-parent.ts";
import { modeSwitchAnchorY } from "./scroll-anchor.ts";

import { editablePluginKey } from "./editable-key.ts";

export interface EditorOptions {
  initialContent?: string;
  documentPath?: string;
  isSingleFileMode?: boolean;
  /** meta.beforeSelection 是事务**开始前**的位置，已按事务前的 doc/保真上下文
   *  换算成行/列——消费者不可再用当前 doc 二次换算（删除会让旧位置越界）。
   *
   *  惰性形态：行/列换算在大文档下是每次按键最贵的一步，而沿用同一历史组合时
   *  只有**组合开始的那一次**提交真正用到它。因此这里给的是 thunk，消费者按需
   *  求值（内部已捕获事务前的 doc 与选区，求值时机不影响正确性）。 */
  onChange?: (
    md: string,
    meta?: { beforeSelection?: CursorRange | (() => CursorRange) },
  ) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  extraPlugins?: Plugin[];
  openableExtensions?: string[];
  onOpenFileLink?: (path: string) => void;
  /** 启用源文本保留序列化（默认跟随 Settings 里的 Beta 开关，未显式选择时回退
   *  VITE_SOURCE_PRESERVE 环境变量；显式传入时以本参数为准） */
  sourcePreserve?: boolean;
  /** 是否启用 ProseMirror 原生 history（默认 true）。关闭后撤销/重做由外部
   *  历史会话经 historyCommands 接管。 */
  nativeHistory?: boolean;
  /** nativeHistory 关闭时接管 Mod-z/y/Shift-z 的命令。 */
  historyCommands?: { undo: () => boolean; redo: () => boolean };
  /** 是否在 onChange 的 meta 里上报事务前的光标行/列（beforeSelection）。
   *  只有外部历史会话（双模式）需要它；单 IR 用原生 history 时可关掉，省掉每次
   *  按键的整篇行列换算（大文档下这是最贵的一步）。传函数时每次事务重新判定。
   *  默认 true。 */
  reportBeforeSelection?: boolean | (() => boolean);
}

export interface Editor {
  getMarkdown(): string;
  /** 保真输出 P 中顶层标题行号；未启用/嵌套标题时返回 null */
  headingLines(): number[] | null;
  setMarkdown(md: string): void;
  /**
   * 整篇替换，但按普通编辑事务处理：上报 onChange、进入历史（外部桥接用）。
   * 与 setMarkdown 的区别是后者视为外部同步，抑制 onChange 且不进历史。
   */
  replaceDocument(md: string): void;
  /** 把目标 markdown 作为历史状态应用：只替换变化的顶层块，不进入原生历史。 */
  applyMarkdownFromHistory(
    md: string,
    selection: CursorRange | null,
    align?: ScrollAlign,
  ): void;
  /**
   * 语法管线（插件贡献的解析规则 / NodeView）变化后重建编辑器状态：
   * 文本与保真上下文保持不变，光标 offset 与滚动位置尽量恢复。
   * 源码模式不做处理（返回 false）；返回是否真的重建过。
   */
  reloadSyntax(): boolean;
  toggleSource(): void;
  isSourceMode(): boolean;
  focus(): void;
  destroy(): void;
  readonly view: EditorView;
  readonly editable: boolean;
  setEditable(editable: boolean): void;
  /** 将 ProseMirror 文档位置转换为 Markdown 中的行号（1 起）与列（0 起） */
  posToLineCol(pos: number): { line: number; col: number };
  /** 将 Markdown 中的行号（1 起）与列（0 起）转换为 ProseMirror 文档位置 */
  lineColToPos(line: number, col: number): number;
}

/**
 * 把选区所在行对齐到**模式切换的视觉锚点**（best-effort）。
 *
 * ProseMirror 自带的 `scrollIntoView`/`scrollToSelection` 是「最小滚动」：
 * 目标位置在视口外时只会贴到最近的一条边。
 *
 * 锚点由 `modeSwitchAnchorY()` 给出（窗口高度 × 0.47），而不是编辑器视口中线：
 * 主窗口在 macOS 用 `TitleBarStyle::Overlay` + 32px 自绘标题栏，IR 视口顶部还
 * 可能有格式操作栏，按视口中线对齐会比窗口视觉中线低，看起来偏下。
 */
function alignSelectionToVisualAnchor(view: EditorView): void {
  const parent = getScrollParent(view);
  const rect = parent.getBoundingClientRect();
  // 容器不可见 / 尚未布局时没有可对齐的视口。
  if (rect.height <= 0) return;
  let caret: ReturnType<EditorView["coordsAtPos"]> | null = null;
  try {
    caret = view.coordsAtPos(view.state.selection.head);
  } catch {
    // 位置在派发与测量之间失效：选区已恢复，放弃对齐。
    return;
  }
  if (!caret) return;
  // 容器不可见 / 尚未布局时坐标退化（与 alignInsertTo 同一判据）。
  if (caret.top === 0 && caret.bottom === 0) return;
  const delta = (caret.top + caret.bottom) / 2 - modeSwitchAnchorY();
  if (Math.abs(delta) < 1) return;
  parent.scrollTop += delta;
}

export function createEditor(
  host: HTMLElement,
  options: EditorOptions = {},
): Editor {
  const wrap = document.createElement("div");
  wrap.className = "texto-web-wrap";
  const editorHost = document.createElement("div");
  editorHost.className = "texto-web-editor-host";
  editorHost.id = "writer";
  const sourceTextarea = document.createElement("textarea");
  sourceTextarea.className = "texto-web-source";
  sourceTextarea.hidden = true;
  wrap.append(editorHost, sourceTextarea);
  host.append(wrap);

  let view: EditorView;
  let inSource = false;
  let _editable = true;
  const sourcePreserveEnabled =
    options.sourcePreserve ?? isSourcePreserveEnabled();
  let preserveCtx: PreservationContext | null = null;

  /** 解析 md 为 doc；启用保真时顺带构建/刷新 PreservationContext。 */
  function loadDoc(md: string): { doc: import("prosemirror-model").Node; ctx: PreservationContext | null } {
    if (!md) {
      return { doc: getSchema().nodes.doc.createAndFill()!, ctx: null };
    }
    if (sourcePreserveEnabled) {
      try {
        const ctx = parseWithSource(md);
        return { doc: ctx.doc, ctx };
      } catch (e) {
        console.error("[editor] parseWithSource failed, falling back to parse:", e);
      }
    }
    return { doc: parse(md), ctx: null };
  }

  function buildEditablePlugin(editable: boolean): Plugin<boolean> {
    return new Plugin<boolean>({
      key: editablePluginKey,
      state: {
        init: () => editable,
        apply: (tr, prev) => {
          const meta = tr.getMeta(editablePluginKey);
          return meta !== undefined ? meta : prev;
        },
      },
      props: {
        editable: (state) => editablePluginKey.getState(state) ?? true,
      },
    });
  }

  /** PM 文档位置 → 行/列；保真上下文可用时优先用保真映射（与 posToLineCol 同源，
   *  但作用于传入的 doc，而不是当前 doc）。 */
  function lineColOf(doc: PMNode, pos: number): { line: number; col: number } {
    if (preserveCtx && preserveCtx.supported) {
      const mapped = preservedPosToLineCol(preserveCtx, doc, pos);
      if (mapped) return mapped;
    }
    return posMap.posToLineCol(doc, pos);
  }

  function needsBeforeSelection(): boolean {
    const flag = options.reportBeforeSelection;
    return typeof flag === "function" ? flag() : flag !== false;
  }

  function buildView(initialMd: string, editable = true): EditorView {
    const { doc, ctx } = loadDoc(initialMd);
    preserveCtx = ctx;
    const plugins = defaultPlugins({
      cursorWidget: false,
      documentPath: options.documentPath,
      isSingleFileMode: options.isSingleFileMode,
      openableExtensions: options.openableExtensions,
      onOpenFileLink: options.onOpenFileLink,
      nativeHistory: options.nativeHistory,
      historyCommands: options.historyCommands,
    });
    plugins.unshift(buildEditablePlugin(editable));
    if (options.extraPlugins) {
      plugins.push(...options.extraPlugins);
    }
    const base = EditorState.create({
      schema: getSchema(),
      doc,
      plugins,
    });
    const state = base.apply(base.tr.setSelection(TextSelection.atStart(doc)));
    const v: EditorView = new EditorView(editorHost, {
      state,
      // 光标跟随滚动对齐 Typora 的贴边缓冲：光标行进入距顶/底 140px 的区域才滚，
      // 滚完停在边界内 140px 处（其余时间不动视口）。打字、方向键、粘贴、撤销、
      // IME 的事务本身都带 scrollIntoView，无需再补选区兜底；打字机模式在同一帧
      // 稍后会把光标行放回 45% 处，两者互不干扰。
      scrollThreshold: { top: 140, right: 0, bottom: 140, left: 0 },
      scrollMargin: { top: 140, right: 5, bottom: 140, left: 5 },
      dispatchTransaction(tr) {
        // 事务开始前的选区：onChange 的消费者（统一历史会话）需要它作为撤销目标
        // 光标。事务后的光标可能落在块边界（代码块末尾输入），撤销按行/列回推
        // 就会跳到块外。这里必须用**事务前的 doc 与事务前的保真上下文**换算成
        // 行/列：删除会让旧位置在事务后的 doc 上越界（删掉代码块末尾字符时，
        // 块内末尾位置落到块外 ⇒ 撤销跑到下一行）。
        const startDoc = v.state.doc;
        const startSelection = v.state.selection;
        // externalReplace：外部同步内容；source=history：历史会话回写。两者都不上报 onChange。
        const suppressed =
          tr.getMeta("externalReplace") || tr.getMeta("source") === "history";
        const reportsChange = tr.docChanged && !suppressed;
        // 只有真正上报的变更才需要 before 光标：选区类事务（方向键、拖选）每次
        // 都跑一遍整篇保真映射纯属浪费，大文档下是可见卡顿。换算仍在事务前完成。
        // 折叠选区（打字最常见）只算一次：anchor === head 时复用同一结果。
        // 惰性求值：同一历史组合里只有组合起点那一次提交会消费它。
        const beforeSelection: (() => CursorRange) | undefined =
          reportsChange && needsBeforeSelection()
            ? () => {
                const anchor = lineColOf(startDoc, startSelection.anchor);
                const head =
                  startSelection.head === startSelection.anchor
                    ? anchor
                    : lineColOf(startDoc, startSelection.head);
                return { anchor, head };
              }
            : undefined;
        let newState = v.state.apply(tr);

        // Replicate PM's internal dispatch logic: run appendTransaction for
        // every plugin so that mark reconciliation (normalize), task-marker
        // propagation, and block-draft commit actually execute.  PM's own
        // dispatch skips this when dispatchTransaction is provided as a view
        // prop (which it is here) instead of from within a plugin.
        const trs: Transaction[] = [tr];
        for (const plugin of newState.plugins) {
          const at = plugin.spec.appendTransaction;
          if (at) {
            const result = at.call(plugin, trs, v.state, newState);
            if (result && result.docChanged) {
              trs.push(result);
              newState = newState.apply(result);
            }
          }
        }

        v.updateState(newState);
        if (reportsChange) {
          options.onChange?.(getCurrentMd(newState.doc), { beforeSelection });
        }
      },
      handleDOMEvents: {
        focus: () => { options.onFocus?.(); return false; },
        blur: () => { options.onBlur?.(); return false; },
      },
    });
    // 编辑器根右键守卫：右键不得移动光标。否则浏览器会把 DOM 光标放进节点 /
    // 装饰 widget 内，触发「渲染态 → 源码态」切换（代码块、mermaid/math 块、
    // 行内公式/图片等），且点在渲染容器 / chrome / 块内留白时表现不一 ——
    // 这正是「有些位置仍进源码态」的根因。
    //
    // 用 view.dom 上的原生冒泡监听，而不是 handleDOMEvents.mousedown：后者被
    // ProseMirror 的 eventBelongsToView 门控，会先咨询各 NodeView 的 stopEvent，
    // 而代码块的 chrome / 渲染容器 stopEvent 返回 true ⇒ 根 handleDOMEvents
    // 根本收不到这些位置的事件。原生监听不受 stopEvent 影响（stopEvent 只让 PM
    // 自身跳过处理，不阻断冒泡），因而能一次覆盖块根 / chrome / 渲染容器 / widget。
    //
    // 只 preventDefault（取消默认的插入点移动），不 stopPropagation：编辑器自己
    // 的 contextmenu 流程与其他监听器仍要收到 mousedown。语言输入框自行
    // stopPropagation，收不到这里 ⇒ 由 fenced-code.ts 自行 preventDefault。
    //
    // 右键不移动光标：浏览器（WebKit 在 mouseup / Chromium 在 mousedown）可能把
    // 插入点放进节点 / 装饰 widget 内，触发「渲染态 → 源码态」切换；同时也会劫持
    // 用户已有的文本选区。故记录右键前的选区，并在右键手势的后续事件里若发现选区
    // 被改动就恢复——语义：右键只用于打开菜单，不改变选区。
    //
    // 执行顺序：view.dom 上的原生 contextmenu 监听在冒泡阶段先于 React 容器上的
    // onContextMenu 触发，因此恢复发生在菜单装配之前 ⇒ 菜单内容基于「右键前的
    // 选区」（符合「选区优先」语义）。
    let pendingSelectionRestore: { selection: Selection; doc: PMNode; ts: number } | null = null;

    const restoreSelectionAfterRightClick = () => {
      const pending = pendingSelectionRestore;
      if (!pending) return;
      // 只对「刚刚那次右键」生效，避免陈旧快照在无关事件上误恢复。
      if (performance.now() - pending.ts > 700) {
        pendingSelectionRestore = null;
        return;
      }
      // 文档变化（撤销/内容重建等）时放弃恢复，避免把旧位置强塞进新文档。
      if (pending.doc !== v.state.doc) {
        pendingSelectionRestore = null;
        return;
      }
      if (v.state.selection.eq(pending.selection)) return;
      v.dispatch(v.state.tr.setSelection(pending.selection));
    };

    v.dom.addEventListener("mousedown", (event) => {
      if (event.button === 2) {
        event.preventDefault();
        pendingSelectionRestore = {
          selection: v.state.selection,
          doc: v.state.doc,
          ts: performance.now(),
        };
        return;
      }
      pendingSelectionRestore = null;
    });
    for (const type of ["contextmenu", "mouseup", "auxclick"] as const) {
      v.dom.addEventListener(type, restoreSelectionAfterRightClick);
    }
    return v;
  }

  // 全文 markdown 按 (ctx, doc) 身份缓存：一次按键里 onChange 上报、大纲提取、
  // getMarkdown 会各取一次，保真拼接近似线性于正文长度，缓存后只算一次。
  let mdCache: { ctx: PreservationContext | null; doc: PMNode; md: string } | null = null;

  function getCurrentMd(doc: PMNode): string {
    if (mdCache && mdCache.doc === doc && mdCache.ctx === preserveCtx) return mdCache.md;
    const md =
      preserveCtx && preserveCtx.supported
        ? (serializePreserving(preserveCtx, doc) ?? serialize(doc))
        // canonical 路径复用 position 的按 doc 缓存：上一次按键产出的 doc 就是下一次
        // 按键的行列换算起点，共享同一份全文 markdown，省掉一整次整篇序列化。
        : posMap.docMarkdown(doc);
    mdCache = { ctx: preserveCtx, doc, md };
    return md;
  }

  function rebuild(md: string): void {
    view.destroy();
    editorHost.innerHTML = "";
    view = buildView(md, _editable);
  }

  /**
   * 语法管线（插件贡献的解析规则 / NodeView）变化后重建编辑器状态。
   * 文本与保真上下文保持不变，光标 offset 与滚动位置尽量恢复。
   * 源码模式不做处理：`exitSource()` 本来就会 `rebuild`。
   *
   * 返回是否真的重建过。Agent 逐字插入期间调用方必须跳过（重建会换掉 view，
   * 打断逐字节奏）——该状态由骨架侧持有，编辑器不感知，见 TextoEditor 的注册处。
   */
  function reloadSyntax(): boolean {
    if (inSource) return false;
    // 先序列化：rebuild 会重建 `preserveCtx`，之后的序列化不再对应同一份源。
    const md = getCurrentMd(view.state.doc);
    // 非折叠选区必须连同方向一起恢复：只存 `from` 再用 `TextSelection.near`
    // 会把跨行选择（尤其 Shift+点击 / 反向选择）压成折叠光标。
    const anchor = view.state.selection.anchor;
    const head = view.state.selection.head;
    // 滚动容器是编辑器的祖先（`.prosemirror-editor-container`），不在重建范围内，
    // 但清空 `editorHost` 会让它瞬间塌陷、scrollTop 被夹到 0，必须显式写回。
    const scroller = getScrollParent(view);
    const scrollTop = scroller.scrollTop;
    rebuild(md);
    const size = view.state.doc.content.size;
    const clamp = (n: number) => Math.max(0, Math.min(n, size));
    try {
      // `between` 按传入顺序保留 anchor/head（方向），并把落点吸附到最近的合法
      // 行内位置；位置越界时由 clamp 夹到新文档范围内。
      const $anchor = view.state.doc.resolve(clamp(anchor));
      const $head = view.state.doc.resolve(clamp(head));
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.between($anchor, $head))
          .setMeta("addToHistory", false),
      );
    } catch {
      /* 位置非法时保持 rebuild 的默认选区 */
    }
    scroller.scrollTop = scrollTop;
    return true;
  }

  // 廉价的整文档替换：不销毁重建 view（保留插件/DOM），避免模式切换时卡顿。
  // 用 replaceExternal meta 抑制 onChange，避免外部同步内容时产生自激循环；
  // addToHistory:false 防止污染撤销历史。
  function replaceContent(md: string): void {
    try {
      const { doc: newDoc, ctx } = loadDoc(md);
      preserveCtx = ctx;
      // 整篇替换（外部同步）会把选区映射到文档末尾，旧实现因此
      // 显式重置到文档开头——但那会直接丢掉用户刚点击/编辑的位置，且下一次
      // 光标跟随滚动会把视口带回文档头部。这里保留替换前的插入点（越界则夹
      // 到新文档范围内）并吸附到最近的合法文本位置：打开文档时旧位置本就是
      // 开头，与 buildView 的初始选区一致；运行期同步不再抢走光标。
      const prevFrom = view.state.selection.from;
      const tr = view.state.tr
        .replaceWith(0, view.state.doc.content.size, newDoc.content)
        .setMeta("externalReplace", true)
        .setMeta("addToHistory", false);
      const anchor = Math.max(0, Math.min(prevFrom, tr.doc.content.size));
      try {
        tr.setSelection(TextSelection.near(tr.doc.resolve(anchor)));
      } catch {
        tr.setSelection(TextSelection.atStart(tr.doc));
      }
      view.dispatch(tr);
    } catch (e) {
      console.error("[editor] replaceContent threw, falling back to rebuild:", e);
      rebuild(md);
    }
  }

  // 历史会话回写：把目标 markdown 作为「当前状态」应用到 IR。
  // 只替换首尾相等块之间的差异块，未变化的顶层块保持节点身份不变
  // （NodeView 不重建，图表/公式等不闪）。事务不进原生历史，也不上报
  // onChange（外部历史会话已是真值来源）。
  function applyHistoryMarkdown(
    md: string,
    selection: CursorRange | null,
    align: ScrollAlign = "nearest",
  ): void {
    let targetDoc: PMNode;
    let nextCtx: PreservationContext | null;
    try {
      const loaded = loadDoc(md);
      targetDoc = loaded.doc;
      nextCtx = loaded.ctx;
    } catch (e) {
      console.error("[editor] parse history target failed, rebuilding:", e);
      rebuild(md);
      return;
    }

    const current = view.state.doc;
    const currentCount = current.childCount;
    const targetCount = targetDoc.childCount;
    let prefix = 0;
    while (
      prefix < currentCount &&
      prefix < targetCount &&
      current.child(prefix).eq(targetDoc.child(prefix))
    ) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < currentCount - prefix &&
      suffix < targetCount - prefix &&
      current.child(currentCount - 1 - suffix).eq(targetDoc.child(targetCount - 1 - suffix))
    ) {
      suffix += 1;
    }

    let from = 0;
    for (let i = 0; i < prefix; i += 1) from += current.child(i).nodeSize;
    let to = current.content.size;
    for (let i = 0; i < suffix; i += 1) to -= current.child(currentCount - 1 - i).nodeSize;

    const middle: PMNode[] = [];
    for (let i = prefix; i < targetCount - suffix; i += 1) {
      middle.push(targetDoc.child(i));
    }

    const changed = from !== to || middle.length > 0;
    const tr = view.state.tr;
    if (changed) {
      tr.replaceWith(from, to, middle);
    }
    tr.setMeta("addToHistory", false)
      .setMeta("history", true)
      .setMeta("source", "history");

    if (selection) {
      const toPos = (point: { line: number; col: number }): number | null => {
        if (nextCtx && nextCtx.supported) {
          const mapped = preservedLineColToPos(nextCtx, tr.doc, point.line, point.col);
          if (mapped !== null) return mapped;
        }
        return posMap.lineColToPos(tr.doc, point.line, point.col);
      };
      const anchor = toPos(selection.anchor);
      const head = toPos(selection.head);
      if (anchor !== null && head !== null) {
        const max = tr.doc.content.size;
        const a = Math.max(0, Math.min(anchor, max));
        const h = Math.max(0, Math.min(head, max));
        const $a = tr.doc.resolve(a);
        const $h = tr.doc.resolve(h);
        // 行/列可能落在块边界（如第 3 行第 0 列 = 段落起点，或空文档的 pos 0），
        // 也可能描述的是图片/图表等原子块（NodeSelection）——这类位置读出来只有
        // 行/列，恢复时若直接建 TextSelection 就会变成跨块选区，紧接着打字会把
        // 中间块（图片）删掉。因此只有两端都在**同一个顶层文本块**内时才建
        // TextSelection（between 会把端点吸附到最近 inline 位置），否则降级为
        // caret 吸附。
        const topStart = (pos: ResolvedPos): number | null =>
          pos.depth >= 1 ? pos.before(1) : null;
        const sameTextBlock =
          $a.parent.isTextblock &&
          $h.parent.isTextblock &&
          topStart($a) !== null &&
          topStart($a) === topStart($h);
        try {
          tr.setSelection(
            sameTextBlock ? TextSelection.between($a, $h, 1) : Selection.near($a, 1),
          );
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn("[editor] history selection fallback", err);
          }
          tr.setSelection(Selection.near($a, 1));
        }
      }
    }
    // 只有内容真正变化时才滚动：纯选区同步（例如历史回写同一份内容）不该改变视口。
    // 居中由 dispatch 后显式对齐完成，先走自带滚动只会多滚一次。
    if (changed && align !== "center") tr.scrollIntoView();

    view.dispatch(tr);
    if (align === "center") alignSelectionToVisualAnchor(view);
    preserveCtx = nextCtx;
  }

  function autoSizeSource(): void {
    sourceTextarea.style.height = "auto";
    sourceTextarea.style.height = `${sourceTextarea.scrollHeight}px`;
  }

  function caretYInTextarea(offset: number): number | null {
    const ta = sourceTextarea;
    if (!ta.isConnected) return null;
    const cs = window.getComputedStyle(ta);
    const mirror = document.createElement("div");
    const props = [
      "fontFamily", "fontSize", "fontWeight", "fontStyle",
      "letterSpacing", "lineHeight", "tabSize",
      "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
      "boxSizing", "whiteSpace", "wordBreak", "wordWrap", "width",
    ] as const;
    for (const p of props) {
      (mirror.style as unknown as Record<string, string>)[p] = cs[p];
    }
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.top = "0";
    mirror.style.left = "0";
    mirror.style.height = "auto";
    const value = ta.value;
    mirror.textContent = value.slice(0, offset);
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    mirror.appendChild(marker);
    mirror.appendChild(document.createTextNode(value.slice(offset) || " "));
    document.body.appendChild(mirror);
    const markerRect = marker.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();
    const taRect = ta.getBoundingClientRect();
    document.body.removeChild(mirror);
    return taRect.top + (markerRect.top - mirrorRect.top);
  }

  function scrollTextareaCursorIntoView(): void {
    const offset = sourceTextarea.selectionStart;
    if (offset == null) return;
    const y = caretYInTextarea(offset);
    if (y == null) return;
    const pageY = y + window.scrollY;
    const target = pageY - window.innerHeight / 3;
    window.scrollTo({ top: target, behavior: "instant" as ScrollBehavior });
  }

  function renderedCursorToMdOffset(): number {
    return posMap.posToMdOffset(view.state.doc, view.state.selection.from);
  }

  function mdOffsetToRenderedPos(md: string, offset: number): number {
    try {
      return posMap.mdOffsetToPos(parse(md), offset);
    } catch {
      return 0;
    }
  }

  function enterSource(): void {
    const md = getCurrentMd(view.state.doc);
    const mdCursor = renderedCursorToMdOffset();
    sourceTextarea.value = md;
    editorHost.hidden = true;
    sourceTextarea.hidden = false;
    autoSizeSource();
    sourceTextarea.focus();
    const clamped = Math.min(mdCursor, md.length);
    sourceTextarea.setSelectionRange(clamped, clamped);
    scrollTextareaCursorIntoView();
    inSource = true;
  }

  function exitSource(): void {
    const md = sourceTextarea.value;
    const mdCursor = sourceTextarea.selectionStart ?? md.length;
    const targetRaw = mdOffsetToRenderedPos(md, mdCursor);
    rebuild(md);
    const target = Math.min(targetRaw, view.state.doc.content.size);
    try {
      const sel = TextSelection.near(view.state.doc.resolve(target));
      view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
    } catch {}
    sourceTextarea.hidden = true;
    editorHost.hidden = false;
    view.focus();
    inSource = false;
  }

  if (options.onFocus) {
    sourceTextarea.addEventListener("focus", () => options.onFocus!());
  }
  if (options.onBlur) {
    sourceTextarea.addEventListener("blur", () => options.onBlur!());
  }
  sourceTextarea.addEventListener("input", autoSizeSource);

  view = buildView(options.initialContent ?? "", _editable);

  return {
    getMarkdown(): string {
      if (inSource) return sourceTextarea.value;
      return getCurrentMd(view.state.doc);
    },
    headingLines(): number[] | null {
      if (!preserveCtx || !preserveCtx.supported) return null;
      return preservedHeadingLines(preserveCtx, view.state.doc);
    },
    setMarkdown(md: string): void {
      if (inSource) {
        sourceTextarea.value = md;
      } else {
        replaceContent(md);
      }
    },
    replaceDocument(md: string): void {
      if (inSource) {
        sourceTextarea.value = md;
        return;
      }
      try {
        const { doc: newDoc, ctx } = loadDoc(md);
        preserveCtx = ctx;
        const tr = view.state.tr.replaceWith(
          0,
          view.state.doc.content.size,
          newDoc.content,
        );
        try {
          tr.setSelection(TextSelection.atStart(tr.doc));
        } catch {}
        view.dispatch(tr.scrollIntoView());
      } catch (e) {
        // 解析失败保持原文档不动，由调用方报错（不要静默 rebuild 成空文档）
        throw e instanceof Error ? e : new Error(String(e));
      }
    },
    applyMarkdownFromHistory(
      md: string,
      selection: CursorRange | null,
      align?: ScrollAlign,
    ): void {
      applyHistoryMarkdown(md, selection, align);
    },
    reloadSyntax(): boolean {
      return reloadSyntax();
    },
    toggleSource(): void {
      if (inSource) exitSource();
      else enterSource();
    },
    isSourceMode(): boolean {
      return inSource;
    },
    focus(): void {
      if (inSource) sourceTextarea.focus();
      else view.focus();
    },
    destroy(): void {
      view.destroy();
      wrap.remove();
    },
    get view() {
      return view;
    },
    get editable() {
      return _editable;
    },
    setEditable(editable: boolean): void {
      _editable = editable;
      view.dispatch(view.state.tr.setMeta(editablePluginKey, editable));
    },
    posToLineCol(pos: number): { line: number; col: number } {
      if (preserveCtx && preserveCtx.supported) {
        const mapped = preservedPosToLineCol(preserveCtx, view.state.doc, pos);
        if (mapped) return mapped;
      }
      return posMap.posToLineCol(view.state.doc, pos);
    },
    lineColToPos(line: number, col: number): number {
      if (preserveCtx && preserveCtx.supported) {
        const mapped = preservedLineColToPos(preserveCtx, view.state.doc, line, col);
        if (mapped !== null) return mapped;
      }
      return posMap.lineColToPos(view.state.doc, line, col);
    },
  };
}
