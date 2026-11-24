import { useEffect, useRef, forwardRef, useImperativeHandle, useState, lazy, Suspense, type ReactNode } from "react";
import { type EditorView } from "prosemirror-view";
import { toggleMark, setBlockType, wrapIn } from "prosemirror-commands";
import { EditorState, Plugin, TextSelection, type Selection } from "prosemirror-state";
import { undo as undoCommand, redo as redoCommand } from "prosemirror-history";
import { createEditor } from "./src/editor-api.ts";
import type { Editor } from "./src/editor-api.ts";
import { EditorDocumentSession } from "./src/history/session.ts";
import { createIrAdapter } from "./src/history/adapters/ir.ts";
import { createSvAdapter } from "./src/history/adapters/sv.ts";
import type { ChangeMeta, CursorRange } from "./src/history/types.ts";
import type { SourceViewApi } from "./src/source-view/index.ts";
import { getEditorPosition, setEditorPosition } from "./src/editorPositionStore.ts";
import { getSchema } from "./src/schema.ts";
import type { TextoEditorRef, EditorSelectionInfo, EditorTextPoint } from "./TextoEditorRef.ts";
import { extractHeadings, findHeadingPosition, transactionTouchesHeading } from "./src/outline.ts";
import { setSlashStateListener } from "./src/features/slash-menu/index.ts";
import { toggleTaskList as toggleTaskListCmd } from "./src/features/task.ts";
import { typewriterPluginKey } from "./src/features/typewriter/index.ts";
import { SlashMenu } from "./src/features/slash-menu/SlashMenu.tsx";
import { setImageUploading as setUploadState, clearImageUploading as clearUploadState } from "./src/features/image-upload-state.ts";
import { insertLinkTransaction } from "./src/features/link-insert.ts";
import { canInsertBlockAt } from "./src/features/block-insert.ts";
import { editorContextMenuItems, editorInsertCommands } from "./src/extension/registry.ts";
import { buildContextMenuModel } from "./src/features/context-menu/build.ts";
import { CORE_CONTEXT_MENU_ITEMS } from "./src/features/context-menu/builtins.ts";
import { openContextMenu } from "./src/features/context-menu/open.ts";
import { resolveContextMenuContext } from "./src/features/context-menu/target.ts";
import { usePaneTransition } from "./src/panes/usePaneTransition.ts";
import { EditorPanes } from "./src/panes/EditorPanes.tsx";
import { lockEditorInput, runAgentStream } from "./src/agent-stream.ts";
import { getEditorHost } from "./src/host.ts";
import { isSourceCodeEditorReady, loadSourceCodeEditor } from "./src/source-view/loader.ts";
import { useTranslation } from "react-i18next";
import type { EditorContextMenuCtx, EmbedInsert } from "@texto/markdown-editor-api";
import "prosemirror-view/style/prosemirror.css";
import "./styles/widgets.css";

// 源码编辑器按需加载；与 loader 共用同一个 chunk（只 import 一次）。
const SourceCodeView = lazy(async () => ({
  default: (await loadSourceCodeEditor()).SourceCodeEditor,
}));

/** 双模式下 SV 组件的延迟挂载时间：先让 IR 首帧/内容渲染完成。 */
export const SV_MOUNT_DELAY_MS = 800;

export interface TextoEditorProps {
  content: string;
  /** 双模式下附带统一历史会话的状态元信息（任务 11 起由宿主消费）。 */
  onChange: (content: string, meta?: ChangeMeta) => void;
  onSave?: () => void;
  onInsertImage?: (callback: (imageUrl: string, fileName: string, title?: string, slashPos?: number) => void) => void;
  onInsertImageRequest?: () => void;
  /** 宿主/骨架弹框选文件后回调：由 embed 贡献的"插入引用"命令使用 */
  onInsertEmbedRequest?: (embed: EmbedInsert) => void;
  onEditorReady?: (view: EditorView, state: EditorState) => void;
  // 代码块高亮主题由 syntax-highlight 插件应用，编辑器不感知具体主题
  appearance?: "light" | "dark" | "system";
  codeBlockWordWrap?: boolean;
  readableLineLength?: boolean;
  typewriterEnabled?: boolean;
  scrollToLine?: number;
  scrollTrigger?: number;
  scrollToHeading?: string;
  onOutlineChange?: (outline: { level: number; text: string; line: number; pos?: number; excerpt?: string }[]) => void;
  documentPath?: string;
  isSingleFileMode?: boolean;
  openableExtensions?: string[];
  onOpenFileLink?: (path: string) => void;
  autoCapitalize?: boolean;
  editable?: boolean;
  positionKey?: number;
  /** 附加 ProseMirror plugins，在 EditorState.create 时注入 */
  extraPlugins?: Plugin[];
  /** 传入时进入 IR/SV 双模式；不传时保持纯 IR。 */
  editorMode?: "ir" | "sv";
  /** IR pane 顶部槽位（骨架工具栏）。 */
  irHeader?: ReactNode;
  /** 根节点是否使用 RTL 布局。 */
  rtl?: boolean;
  /** 额外根节点 class。 */
  rootClassName?: string;
  /** SV 行号显示。 */
  showLineNumbers?: boolean;
}

/** 在当前光标处插入 `![alt](src)`：空段落 → image_ref 块 + 空段落；否则行内文本。 */
function applyInsertImageRef(view: EditorView, src: string, alt: string): void {
  if (!view.editable) return;
  const schema = getSchema();
  const text = `![${alt}](${src})`;
  const { from, to } = view.state.selection;
  const $from = view.state.doc.resolve(from);
  const inEmptyParagraph =
    $from.parent.type.name === "paragraph" &&
    $from.parent.content.size === 0 &&
    from >= $from.before() &&
    to <= $from.after();
  if (inEmptyParagraph) {
    const paraStart = $from.before();
    const paraEnd = $from.after();
    const node = schema.nodes.image_ref.create(null, schema.text(text));
    const tr = view.state.tr.replaceWith(paraStart, paraEnd, [
      node,
      schema.nodes.paragraph.create(),
    ]);
    tr.setSelection(TextSelection.create(tr.doc, paraStart + node.nodeSize + 1));
    view.dispatch(tr);
  } else {
    view.dispatch(view.state.tr.insertText(text, from, to));
  }
  view.focus();
}

/** PM 选区 → 会话用的行/列范围（非折叠选区保留 anchor/head 方向）。 */
function toCursorRange(editor: Editor, selection: Selection): CursorRange {
  const head = editor.posToLineCol(selection.head);
  return selection.empty
    ? { anchor: head, head }
    : { anchor: editor.posToLineCol(selection.anchor), head };
}

/** 外部口径（行 1 起、列 1 起）→ 编辑器内部（行 1 起、列 0 起）。 */
function lineColToPos(editor: Editor, point: EditorTextPoint): number {
  const line = Number.isFinite(point.line) ? Math.max(1, Math.floor(point.line)) : 1;
  const column = Number.isFinite(point.column) ? Math.max(1, Math.floor(point.column)) : 1;
  return editor.lineColToPos(line, column - 1);
}

/** 编辑器内部选区 → 外部口径（行 1 起、列 1 起）。 */
function describeSelection(editor: Editor, view: EditorView): EditorSelectionInfo {
  const { from, to } = view.state.selection;
  const start = editor.posToLineCol(from);
  const end = editor.posToLineCol(to);
  return {
    start: { line: start.line, column: start.col + 1 },
    end: { line: end.line, column: end.col + 1 },
    empty: from === to,
    text: view.state.doc.textBetween(from, to, "\n"),
  };
}

export const TextoEditor = forwardRef<TextoEditorRef, TextoEditorProps>(function TextoEditor(  { content, onChange, onInsertImageRequest, onInsertEmbedRequest,
    onEditorReady, onSave, onInsertImage,
    appearance,
    codeBlockWordWrap, readableLineLength = true, typewriterEnabled = false, scrollToLine,
    scrollTrigger, scrollToHeading,
    onOutlineChange, documentPath, isSingleFileMode, openableExtensions, onOpenFileLink, autoCapitalize, editable = true, positionKey, extraPlugins,
    editorMode, irHeader, rtl, rootClassName, showLineNumbers },
  ref,
) {
  // 不变量：editorMode 在组件生命周期内不出现 undefined ↔ 'ir' 的切换；否则 IR 容器会换父节点重挂。
  const dualMode = editorMode !== undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  const irContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const onChangeRef = useRef(onChange);
  // 统一历史会话（仅双模式）：必须在 render 期创建。SourceCodeView 的 mount
  // effect 早于本组件的 mount effect（React passive effect 子先父后），若在父
  // mount effect 里才建会话，同一次 commit 挂载的 SV 在 onViewReady 里读到的
  // 就是 null，registerView("sv") 永不执行，SV 会停在旧文本。
  const [session] = useState<EditorDocumentSession | null>(() => {
    if (editorMode === undefined) return null;
    return new EditorDocumentSession(content, {
      onChange: (md, meta) => onChangeRef.current(md, meta),
    });
  });
  const sessionRef = useRef<EditorDocumentSession | null>(session);
  sessionRef.current = session;
  const onSaveRef = useRef(onSave);
  const onOutlineChangeRef = useRef(onOutlineChange);
  const openableExtensionsRef = useRef(openableExtensions);
  const onOpenFileLinkRef = useRef(onOpenFileLink);
  // 以下同步守卫（internalChangeGen / lastAppliedGen / mountContentGuardRef /
  // mountContentRef）仅单 IR 模式使用；双模式的内部编辑统统经 session.commit，
  // 外部改写走 session.reset，不经过这些守卫。
  const internalChangeGen = useRef(0);
  const lastAppliedGen = useRef(0);
  // 挂载同步短路只在「PM doc 从未偏离过挂载文本」时成立。一旦 doc 因内部
  // 编辑或外部 setMarkdown 偏离过，之后即使外部内容回落到挂载快照，
  // doc 也可能与挂载文本不同——此时不能再跳过整篇替换。
  const mountContentGuardRef = useRef(true);
  // 编辑器用 createEditor(initialContent: content) 建好时那份 content。
  // 首次内容同步若仍是同一份内容，说明编辑器已经解析过它（roundtrip 不恒等
  // 会让 getMarkdown() !== content 误判），再 setMarkdown 只会重复整篇替换——
  // 且 replaceContent 整篇替换在部分内容上会抛异常触发昂贵的 rebuild。
  // 这里跳过这份冗余同步。
  const mountContentRef = useRef(content);
  /** 当前挂载的源码视图命令式 API（光标保存需要读它）。 */
  const svApiRef = useRef<SourceViewApi | null>(null);
  // 源码编辑器延迟挂载：首帧只渲染 IR，窗口空闲后再拉约 1MB 的 CodeMirror。
  const [svMounted, setSvMounted] = useState(() => editorMode === 'sv');
  /** 上一次的 editorMode：首次挂载（null）不算"切换"，不能写光标 store。 */
  const prevEditorModeRef = useRef<typeof editorMode | null>(null);
  /** 上一次的视觉模式：用来区分「真正的模式切换」与「首次挂载」。 */
  const prevVisualModeRef = useRef<typeof visualMode | null>(null);
  const [slashState, setSlashState] = useState<{
    active: boolean;
    triggerPos: number;
  }>({ active: false, triggerPos: 0 });
  const { t } = useTranslation();

  /** Agent 逐字插入进行中：用于右下角的输入指示器 */
  const [agentStreaming, setAgentStreaming] = useState(false);
  const agentStreamRef = useRef<{ cancel: () => void } | null>(null);
  /** 逐字插入期间自绘的光标：原生光标在 WKWebView 下跟不上高频选区更新 */
  const agentCaretRef = useRef<HTMLDivElement | null>(null);

  // 双模式（IR/SV）转场状态；纯 IR 时恒定 'ir' 且不产生相位。
  const { visualMode, phase } = usePaneTransition(editorMode ?? 'ir', {
    containerRef: rootRef,
    // SV 组件已挂载且 chunk 就绪才播转场，避免「动画开始但目标 pane 为空」
    canAnimate: () => svMounted && isSourceCodeEditorReady(),
  });
  // 阶段 2 的 session/undo 需要读取当前视觉模式
  const visualModeRef = useRef(visualMode);
  visualModeRef.current = visualMode;
  // IR 是否可见/激活：双模式看转场后的视觉模式，纯 IR 恒为激活。
  const isIrActive = dualMode ? visualMode === 'ir' : true;
  const isIrActiveRef = useRef(isIrActive);
  isIrActiveRef.current = isIrActive;

  // 提取大纲（标题 + 摘要）。保真模式复用 editor 已产出的 preserved 源 + 行号，
  // 避免在 canonical 上再做一次序列化。
  const extractOutline = (view: EditorView) => {
    const headingLines = editorRef.current?.headingLines() ?? null;
    return extractHeadings(
      view,
      headingLines,
      headingLines ? editorRef.current?.getMarkdown() : undefined,
    );
  };

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    onOutlineChangeRef.current = onOutlineChange;
  }, [onOutlineChange]);

  useEffect(() => {
    openableExtensionsRef.current = openableExtensions;
  }, [openableExtensions]);

  useEffect(() => {
    onOpenFileLinkRef.current = onOpenFileLink;
  }, [onOpenFileLink]);

  useEffect(() => {
    if (!irContainerRef.current) return;
    // 仅激活（可见）时向外输出大纲，避免隐藏编辑器覆盖侧边栏大纲
    const emitOutline = (view: EditorView): void => {
      const onChange = onOutlineChangeRef.current;
      if (!onChange) return;
      const extracted = extractOutline(view);
      onChange(extracted.map((h) => ({
        level: h.level,
        text: h.text,
        line: h.line ?? 0,
        pos: h.pos,
        excerpt: h.excerpt,
      })));
    };
    // 大纲只在「标题可能变化」时重算：正文里打字不碰标题时整篇重提取（全文
    // 序列化 + 摘要切片）在大文档下就是可见卡顿。dirty 标记由插件 apply 维护，
    // update 里消费；IR 隐藏期间的分变更也标记，回到 IR 时补一次。
    let outlineDirty = true;
    const outlinePlugin = new Plugin({
      state: {
        init: () => null,
        apply(tr) {
          if (!outlineDirty && transactionTouchesHeading(tr)) outlineDirty = true;
          return null;
        },
      },
      view(editorView) {
        if (isIrActiveRef.current) {
          outlineDirty = false;
          emitOutline(editorView);
        }
        return {
          update(view, prevState) {
            if (view.state.doc === prevState.doc) return;
            if (!isIrActiveRef.current) {
              outlineDirty = true;
              return;
            }
            if (!outlineDirty) return;
            outlineDirty = false;
            emitOutline(view);
          },
          destroy() {},
        };
      },
    });
    const editor = createEditor(irContainerRef.current, {
      initialContent: content,
      documentPath,
      isSingleFileMode,
      openableExtensions: openableExtensionsRef.current,
      onOpenFileLink: (path: string) => onOpenFileLinkRef.current?.(path),
      nativeHistory: !dualMode,
      // beforeSelection 只有双模式的外部历史会话消费；单 IR 用原生 history 时
      // 关掉，避免每次按键做整篇行列换算（大文档下是最贵的一步）。
      reportBeforeSelection: () => sessionRef.current != null,
      historyCommands: dualMode
        ? {
            undo: () => sessionRef.current?.undo(visualModeRef.current) ?? false,
            redo: () => sessionRef.current?.redo(visualModeRef.current) ?? false,
          }
        : undefined,
      onChange: (md, meta) => {
        if (!dualMode) {
          internalChangeGen.current++;
          // 单 IR：doc 已发生内部编辑，偏离挂载文本，挂载短路不再适用
          mountContentGuardRef.current = false;
          onChangeRef.current(md);
          return;
        }
        const session = sessionRef.current;
        const current = editorRef.current;
        // 双模式下会话是唯一真值来源；实例缺失时宁可丢弃本次上报，也不能绕过
        // 会话直接抛给宿主（否则会话 md 会落后于视图，下一次撤销会覆盖新内容）。
        if (!session || !current) return;
        const selection = toCursorRange(current, current.view.state.selection);
        // 撤销目标光标由 editor-api 在事务**开始前**（用事务前的 doc/保真上下文）
        // 换算好行/列：这里若再用当前 doc 二次换算，删除类事务会让旧位置越界
        // （删掉代码块末尾字符 ⇒ 撤销跳进下一段）。
        const selectionBefore = meta?.beforeSelection;
        session.commit({
          md,
          selection,
          selectionBefore,
          source: "ir",
        });
        // IR 可能是隐藏的（SV 可见时全局快捷键、图片插入等仍会打到 IR）：
        // 提交后立刻把会话文档同步到可见的 SV，避免 SV 下一次输入反向覆盖。
        if (visualModeRef.current === "sv") {
          session.syncView("sv", null, false);
        }
      },
      extraPlugins: [...(extraPlugins ?? []), outlinePlugin],
    });
    editorRef.current = editor;
    // 语法管线（插件贡献的解析规则 / NodeView）变化后重建：经宿主契约登记，
    // 骨架侧（`@/editor/syntaxReload` 的登记表）不需要拿到编辑器实例。
    // 逐字插入进行中直接跳过——重建会换掉 view，打断逐字节奏。
    const unregisterSyntaxReloader = getEditorHost().registerSyntaxReloader?.(() => {
      if (agentStreamRef.current !== null) return false;
      return editor.reloadSyntax();
    });
    if (dualMode && sessionRef.current) {
      sessionRef.current.registerView("ir", createIrAdapter(editor), false);
      // lazy 已缓存时 SV 可能在同一次 commit 挂载（子 effect 先于父 effect）并已注册；
      // 这里用已存在的 API 补注册一次，保证注册不依赖子/父 effect 顺序（幂等）。
      if (svApiRef.current) {
        sessionRef.current.registerView("sv", createSvAdapter(svApiRef.current), true);
      }
    }
    // 打字机初值来自宿主配置（AppConfig 为单一数据源），插件不再读 localStorage
    if (typewriterEnabled) {
      editor.view.dispatch(
        editor.view.state.tr.setMeta(typewriterPluginKey, { enabled: true }),
      );
    }
    onEditorReady?.(editor.view, editor.view.state);


    requestAnimationFrame(() => {
      editor.view.dom.classList.add('padding-ready');
    });

    onInsertImage?.((imageUrl, fileName, _title, slashPos) => {
      if (!editor.editable) return;
      // 插入总是打到隐藏的 IR；先按会话真值同步，避免在陈旧文档上插入后回滚 SV 的编辑。
      const session = sessionRef.current;
      if (dualMode && visualModeRef.current === "sv") {
        session?.closeGroup();
        session?.syncView("ir", null, false);
      }
      const text = `![${fileName}](${imageUrl})`;
      const view = editor.view;
      if (typeof slashPos === "number") {
        view.dispatch(view.state.tr.insertText(text, slashPos, view.state.selection.from));
      } else {
        view.dispatch(view.state.tr.insertText(text));
      }
      view.focus();
    });

    setSlashStateListener((st) => {
      setSlashState(st);
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        onSaveRef.current?.();
      }
    };
    irContainerRef.current.addEventListener('keydown', handleKeyDown);

    // 浏览器原生撤销（系统快捷键 / 旧菜单）会绕过统一历史直接改 DOM。
    // 拦掉 beforeinput 的 historyUndo/historyRedo，撤销统一由上层按焦点路由。
    const onBeforeInput = (event: Event) => {
      const input = event as InputEvent;
      if (input.inputType === 'historyUndo' || input.inputType === 'historyRedo') {
        event.preventDefault();
      }
    };
    editor.view.dom.addEventListener('beforeinput', onBeforeInput);

    return () => {
      irContainerRef.current?.removeEventListener('keydown', handleKeyDown);
      editor.view.dom.removeEventListener('beforeinput', onBeforeInput);
      setSlashStateListener(null);
      sessionRef.current?.unregisterView("ir");
      // 先注销重载登记再销毁：否则语法重载可能打到已 destroy 的视图。
      unregisterSyntaxReloader?.();
      // 会话由 useState 持有，重挂（StrictMode）时 mount effect 要用同一个实例
      // 重新注册 IR 视图，因此这里不清空 sessionRef。
      svApiRef.current = null;
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  // 首帧后空闲挂载 SV。用户提前切到 SV 时立即标记已挂载，后续切换可正常播转场。
  useEffect(() => {
    if (!dualMode || svMounted) return;
    if (visualMode === 'sv') {
      setSvMounted(true);
      return;
    }

    let cancelled = false;
    let cancelIdle: (() => void) | undefined;

    const mount = () => {
      if (!cancelled) setSvMounted(true);
    };
    const timer = setTimeout(() => {
      const idle = (globalThis as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      }).requestIdleCallback;
      if (typeof idle === 'function') {
        const id = idle(mount, { timeout: 2500 });
        const cancel = (globalThis as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
        cancelIdle = () => cancel?.(id);
      } else {
        mount();
      }
    }, SV_MOUNT_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      cancelIdle?.();
    };
  }, [dualMode, svMounted, visualMode]);

  useEffect(() => {
    editorRef.current?.setEditable(editable);
    if (!editable) cancelAgentStream();
  }, [editable]);

  // 卸载（切换文档 / 编辑器重建）时终止逐字插入，避免定时器打到已销毁的视图
  useEffect(() => () => {
    agentStreamRef.current?.cancel();
    agentStreamRef.current = null;
    // 这里刻意不 flush：视图随即销毁，重建没有意义；被推迟的重载由下一次
    // 编辑器登记（`registerSyntaxReloader` 后的 flush）补上。
  }, []);

  // 打字机状态跟随宿主配置变化（含配置异步加载完成后由 false 变 true）
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const current = typewriterPluginKey.getState(editor.view.state)?.enabled ?? false;
    if (current === typewriterEnabled) return;
    editor.view.dispatch(
      editor.view.state.tr.setMeta(typewriterPluginKey, { enabled: typewriterEnabled }),
    );
  }, [typewriterEnabled]);

  // 内容同步（纯 IR）：仅 IR 激活时应用外部 content（避免隐藏时被反复 setMarkdown）。
  // 双模式由下面的 session.reset 统一驱动，这里直接跳过，避免双写。
  useEffect(() => {
    if (dualMode) return;
    const editor = editorRef.current;
    if (!editor || !isIrActive) return;

    if (internalChangeGen.current !== lastAppliedGen.current) {
      lastAppliedGen.current = internalChangeGen.current;
      return;
    }

    // 编辑器刚用这份 content 作为 initialContent 建好，无需再同步（见上注释）。
    // 仅当 doc 尚未偏离过挂载文本时才适用；否则即使内容回落到挂载快照也须整篇替换。
    if (mountContentGuardRef.current && content === mountContentRef.current) return;

    const current = editor.getMarkdown();
    if (current !== content) {
      mountContentGuardRef.current = false;
      editor.setMarkdown(content);
    }
  }, [content, isIrActive, dualMode]);

  // 内容同步（双模式）：content 由宿主改写（切文档、外部写入）时重置会话与当前视图。
  // 会话自身产生的编辑会回写成同一份 content，不会触发这里。
  useEffect(() => {
    if (!dualMode) return;
    const session = sessionRef.current;
    if (!session) return;
    if (content === session.md) return;
    session.reset(content, visualModeRef.current);
  }, [content, dualMode]);

  // 模式切换：先把当前（尚未换位的）视图光标写入位置 store，供目标视图恢复。
  useEffect(() => {
    if (!dualMode) return;
    sessionRef.current?.closeGroup();
    const prev = prevEditorModeRef.current;
    prevEditorModeRef.current = editorMode;
    // 首次挂载（prev === null）不是"切换"：此处的视图光标只是初始位置，
    // 写 store 会覆盖上次保存的光标，使随后的 visualMode effect 恢复不出来。
    if (prev === null || prev === editorMode) return;
    if (positionKey === undefined) return;
    const active = visualModeRef.current;
    if (active === 'ir') {
      const editor = editorRef.current;
      if (!editor) return;
      const sel = editor.view.state.selection;
      const point = editor.posToLineCol(sel.head);
      setEditorPosition(positionKey, point.line, point.col);
    } else {
      const sel = svApiRef.current?.getSelection();
      if (sel) setEditorPosition(positionKey, sel.head.line, sel.head.col);
    }
  }, [editorMode, dualMode, positionKey]);

  // 视觉模式切换：把会话文档与光标同步到新视图（IR 激活时顺带重发大纲）。
  useEffect(() => {
    if (!dualMode) return;
    // 逐字插入是 IR 专属效果，切到源码视图时立即收尾，避免看不见的持续写入
    cancelAgentStream();
    const session = sessionRef.current;
    if (!session) return;
    const saved = positionKey !== undefined ? getEditorPosition(positionKey) : null;
    const fallback = saved
      ? { anchor: { line: saved.line, col: saved.col }, head: { line: saved.line, col: saved.col } }
      : null;
    // 首次挂载不是切换，保持原有（最小滚动）恢复；真正的切换把光标行居中，
    // 否则目标视图会把行贴在视口顶/底边（源码视图尤其明显）。
    const prev = prevVisualModeRef.current;
    prevVisualModeRef.current = visualMode;
    const align = prev !== null && prev !== visualMode ? "center" : "nearest";
    session.syncView(visualMode, fallback, true, align);
    if (visualMode === "ir" && onOutlineChangeRef.current) {
      const editor = editorRef.current;
      if (!editor) return;
      const onChangeOutline = onOutlineChangeRef.current;
      const extracted = extractOutline(editor.view);
      onChangeOutline(extracted.map((h) => ({
        level: h.level,
        text: h.text,
        line: h.line ?? 0,
        pos: h.pos,
        excerpt: h.excerpt,
      })));
    }
  }, [visualMode, positionKey]);

  /**
   * 全局命令（快捷键/工具栏）不判断模式，可能直接改到隐藏的 IR。此时会话已更新，
   * 但可见的 SV 不会自己刷新，用户继续在 SV 输入会把修改覆盖掉——命令执行后
   * 把会话内容补同步到当前可见视图。
   */
  const syncInactiveView = () => {
    const session = sessionRef.current;
    if (!session || !dualMode || visualModeRef.current !== "sv") return;
    session.syncView("sv", null, false);
  };

  /** 终止正在进行的 Agent 逐字插入（人工输入、切换模式、卸载时调用）。 */
  const cancelAgentStream = () => {
    const handle = agentStreamRef.current;
    if (!handle) return;
    agentStreamRef.current = null;
    handle.cancel();
    // 取消同样意味着「逐字插入不再阻塞重建」：把期间被推迟的语法重载补一次。
    getEditorHost().flushPendingSyntaxReload?.();
  };

  /**
   * 把自绘光标贴到某个文档位置。
   *
   * 逐字插入每帧都会改选区，WebKit 的原生光标重绘会落后于文字，看起来像「光标追不上字」；
   * 因此逐字期间把原生光标设为透明，用这个绝对定位的小竖条代替，位置取 `coordsAtPos`
   * （载荷在相对于 overlay 容器的坐标系里，容器由 panes / 单栏外壳提供 position:relative）。
   */
  const positionAgentCaret = (pos: number) => {
    const el = agentCaretRef.current;
    const view = editorRef.current?.view;
    if (!el || !view) return;
    const parent = el.offsetParent as HTMLElement | null;
    if (!parent) return;
    try {
      const clamped = Math.max(0, Math.min(pos, view.state.doc.content.size));
      const coords = view.coordsAtPos(clamped);
      const rect = parent.getBoundingClientRect();
      const height = Math.max(8, coords.bottom - coords.top);
      el.style.height = `${Math.round(height)}px`;
      el.style.transform = `translate(${Math.round(coords.left - rect.left)}px, ${Math.round(coords.top - rect.top)}px)`;
      el.style.opacity = "1";
    } catch {
      el.style.opacity = "0";
    }
  };

  function withView(fn: (view: EditorView) => void): void {
    const editor = editorRef.current;
    if (!editor) return;
    const session = sessionRef.current;
    // 全局命令总能打到隐藏的 IR，而 IR 的 doc 可能落后于会话（SV 编辑/撤销后）。
    // 先在旧文档上执行命令、再由 onChange 提交，会把「旧文本 + 命令效果」写回会话，
    // 反而回滚刚在 SV 做的编辑。执行前把会话真值同步进 IR。
    session?.closeGroup();
    if (session && dualMode && visualModeRef.current === "sv") {
      session.syncView("ir", null, false);
    }
    fn(editor.view);
    syncInactiveView();
  }

  const handleContextMenu = async (e: React.MouseEvent) => {
    const view = editorRef.current?.view;
    if (!view) return;

    const context = resolveContextMenuContext({
      view,
      coords: { left: e.clientX, top: e.clientY },
    });
    const ctx: EditorContextMenuCtx = {
      view,
      hasSelection: !view.state.selection.empty,
      block: context.block,
    };
    const model = buildContextMenuModel({
      ctx,
      t,
      builtins: CORE_CONTEXT_MENU_ITEMS,
      contributions: editorContextMenuItems(),
    });
    // 防御：内置项恒在，正常不会为空
    if (model.length === 0) return;

    e.preventDefault();
    e.stopPropagation();
    await openContextMenu(model, e.clientX, e.clientY);
  };

  useImperativeHandle(ref, () => {
    const schema = getSchema();
    return {
    setMarkdown(md: string) {
      cancelAgentStream();
      const session = sessionRef.current;
      if (session) {
        // 会话是双模式的唯一真值来源：reset 不触发 onChange（与原接口语义一致），
        // 直接写 IR 会让 session.md 落后，随后一次撤销就会把内容覆盖回去。
        // 注意 reset 会清空撤销栈：整篇替换后，旧的文本补丁已无法在新文档上应用。
        session.reset(md, visualModeRef.current);
        return;
      }
      editorRef.current?.setMarkdown(md);
    },
    scrollToHeadingText(text: string) {
      const view = editorRef.current?.view;
      if (!view) return;
      const pos = findHeadingPosition(view.state.doc, text);
      if (pos == null) return;
      const dom = view.domAtPos(pos + 1);
      const el = dom.node instanceof Element ? dom.node : dom.node.parentElement;
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    get editorView(): EditorView | null {
      return editorRef.current?.view ?? null;
    },

    undo() {
      const session = sessionRef.current;
      if (session) {
        session.undo(visualModeRef.current);
        return;
      }
      withView((view) => { undoCommand(view.state, view.dispatch); });
    },

    redo() {
      const session = sessionRef.current;
      if (session) {
        session.redo(visualModeRef.current);
        return;
      }
      withView((view) => { redoCommand(view.state, view.dispatch); });
    },

    isFocused() {
      const active = document.activeElement;
      // 双模式的根节点包含 IR/SV 两个 pane；纯 IR 只有容器本身。
      const root = dualMode ? rootRef.current : irContainerRef.current;
      if (!root || !active || !root.contains(active)) return false;
      // 编辑器内的普通输入框（SV 查找面板、代码块语言输入）不属于编辑器焦点，
      // 否则这些控件里的 Cmd+Z 会被路由到文档撤销。CM 的隐藏 textarea 例外。
      const tag = active.tagName;
      if (
        (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") &&
        !active.closest(".cm-editor")
      ) {
        return false;
      }
      return true;
    },

    beginSavePoint() {
      const point = sessionRef.current?.beginSavePoint() ?? null;
      if (!point) {
        const editor = editorRef.current;
        if (!editor) return null;
        // 纯 IR 没有会话：0 是占位代次，confirmSavePoint 在无会话时为空操作。
        return { stateId: 0, content: editor.getMarkdown(), sessionId: 0, saveSeq: 0 };
      }
      return point;
    },

    confirmSavePoint(stateId: number, sessionId?: number, saveSeq?: number) {
      sessionRef.current?.confirmSavePoint(stateId, sessionId, saveSeq);
    },

    markSaved() {
      sessionRef.current?.markSaved();
    },

    isDirty() {
      return sessionRef.current?.isDirty ?? false;
    },

    toggleHeading(level: number) {
      if (editorRef.current?.editable === false) return;
      withView((view) => {
        setBlockType(schema.nodes.heading, { level })(view.state, view.dispatch, view);
        view.focus();
      });
    },

    toggleBulletList() {
      if (editorRef.current?.editable === false) return;
      withView((view) => {
        wrapIn(schema.nodes.bullet_list)(view.state, view.dispatch, view);
        view.focus();
      });
    },

    toggleOrderedList() {
      if (editorRef.current?.editable === false) return;
      withView((view) => {
        wrapIn(schema.nodes.ordered_list)(view.state, view.dispatch, view);
        view.focus();
      });
    },

    toggleTaskList() {
      if (editorRef.current?.editable === false) return;
      withView((view) => {
        toggleTaskListCmd()(view.state, view.dispatch, view);
        view.focus();
      });
    },

    insertCodeBlock() {
      if (editorRef.current?.editable === false) return;
      withView((view) => {
        setBlockType(schema.nodes.code_block)(view.state, view.dispatch, view);
        view.focus();
      });
    },

    insertBlockquote() {
      if (editorRef.current?.editable === false) return;
      withView((view) => {
        wrapIn(schema.nodes.blockquote)(view.state, view.dispatch, view);
        view.focus();
      });
    },

    insertHorizontalRule() {
      if (editorRef.current?.editable === false) return;
      withView((view) => {
        if (!canInsertBlockAt(view.state)) return;
        const { $from } = view.state.selection;
        const tr = view.state.tr.replaceWith($from.before(), $from.after(), schema.nodes.horizontal_rule.create());
        view.dispatch(tr);
        view.focus();
      });
    },

    runEditorInsert(id: string) {
      if (editorRef.current?.editable === false) return;
      withView((view) => {
        const cmd = editorInsertCommands().find((c) => c.id === id);
        if (!cmd) return;
        if (cmd.isDisabled ? cmd.isDisabled(view.state) : !canInsertBlockAt(view.state)) return;
        cmd.insert(view);
        view.focus();
      });
    },

    insertTextStreamed(text: string, at?: EditorTextPoint, options?: { stream?: boolean }) {
      if (!text) return;
      const api = editorRef.current;
      if (!api || api.editable === false) return;
      cancelAgentStream();

      // 源码视图看不到逐字效果，逐帧同步源码视图也过重：退化为整段插入
      if (options?.stream === false || visualModeRef.current === "sv") {
        withView((view) => {
          let { from, to } = view.state.selection;
          if (at) from = to = lineColToPos(api, at);
          view.dispatch(view.state.tr.insertText(text, from, to).scrollIntoView());
        });
        return;
      }

      const session = sessionRef.current;
      const view = api.view;
      session?.closeGroup();

      let from = Math.max(1, view.state.selection.from);
      let to = view.state.selection.to;
      if (at) from = to = lineColToPos(api, at);
      if (to > from) view.dispatch(view.state.tr.delete(from, to));
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, Math.min(from, view.state.doc.content.size))),
      );

      // 逐字期间锁住人工输入：用户不能键入 / 粘贴 / 拖放，避免与插入互相踩；Esc 终止
      const release = lockEditorInput(view.dom, () => cancelAgentStream());
      // 原生光标在 WKWebView 下跟不上这种高频选区更新（看起来始终落后于文字），
      // 逐字期间把它涂成透明，改用 positionAgentCaret 画的自绘光标。
      const dom = view.dom;
      dom.style.caretColor = "transparent";
      let caretPos = from;
      const onScroll = () => positionAgentCaret(caretPos);
      // 滚动事件不冒泡，用捕获阶段拿到编辑器内部滚动容器的滚动
      window.addEventListener("scroll", onScroll, { passive: true, capture: true });
      let visualReleased = false;
      const releaseVisual = () => {
        if (visualReleased) return;
        visualReleased = true;
        dom.style.caretColor = "";
        window.removeEventListener("scroll", onScroll, { capture: true });
        if (agentCaretRef.current) agentCaretRef.current.style.opacity = "0";
      };
      positionAgentCaret(caretPos);

      const runner = runAgentStream(text, (chunk) => {
        const start = Math.min(caretPos, view.state.doc.content.size);
        const tr = view.state.tr.insertText(chunk, start, start);
        const end = Math.min(start + chunk.length, tr.doc.content.size);
        tr.setSelection(TextSelection.near(tr.doc.resolve(end), 1)).scrollIntoView();
        view.dispatch(tr);
        caretPos = end;
        positionAgentCaret(end);
      });

      const handle = {
        cancel: () => {
          runner.cancel();
          release();
          releaseVisual();
          setAgentStreaming(false);
        },
      };
      agentStreamRef.current = handle;
      setAgentStreaming(true);

      void runner.done.then(() => {
        release();
        releaseVisual();
        if (agentStreamRef.current !== handle) return;
        agentStreamRef.current = null;
        // 逐字期间的语法重载被 reloader 拒绝了（不能换 view 打断节奏），这里补一次，
        // 否则流式插入期间改的插件开关要等下一次无关的重载请求才生效。
        getEditorHost().flushPendingSyntaxReload?.();
        // 收尾：合并历史组（整段插入算一步撤销），并把会话同步到隐藏视图
        session?.closeGroup();
        syncInactiveView();
        setAgentStreaming(false);
      });
    },

    cancelStreamedInsert() {
      cancelAgentStream();
    },

    isStreamingInsert() {
      return agentStreamRef.current !== null;
    },

    insertText(text: string, at?: EditorTextPoint) {
      if (!text) return;
      const api = editorRef.current;
      if (api?.editable === false) return;
      cancelAgentStream();
      withView((view) => {
        let { from, to } = view.state.selection;
        if (at && api) {
          from = to = lineColToPos(api, at);
        }
        view.dispatch(view.state.tr.insertText(text, from, to).scrollIntoView());
      });
    },

    getSelection() {
      const api = editorRef.current;
      if (!api) return null;
      return describeSelection(api, api.view);
    },

    setSelection(start: EditorTextPoint, end?: EditorTextPoint) {
      const api = editorRef.current;
      if (!api) return null;
      cancelAgentStream();
      let info: EditorSelectionInfo | null = null;
      withView((view) => {
        const anchor = lineColToPos(api, start);
        const head = end ? lineColToPos(api, end) : anchor;
        const from = Math.min(anchor, head);
        const to = Math.max(anchor, head);
        const selection = from === to
          ? TextSelection.near(view.state.doc.resolve(from))
          : TextSelection.create(view.state.doc, from, to);
        view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
        info = describeSelection(api, view);
      });
      return info;
    },

    replaceDocument(markdown: string) {
      const api = editorRef.current;
      if (!api || api.editable === false) return;
      cancelAgentStream();
      withView(() => api.replaceDocument(markdown));
    },

    toggleBold() {
      if (editorRef.current?.editable === false) return;
      withView((view) => {
        toggleMark(schema.marks.strong)(view.state, view.dispatch, view);
        view.focus();
      });
    },

    toggleItalic() {
      if (editorRef.current?.editable === false) return;
      withView((view) => {
        toggleMark(schema.marks.em)(view.state, view.dispatch, view);
        view.focus();
      });
    },

    toggleStrikethrough() {
      if (editorRef.current?.editable === false) return;
      withView((view) => {
        toggleMark(schema.marks.strike)(view.state, view.dispatch, view);
        view.focus();
      });
    },

    toggleInlineCode() {
      if (editorRef.current?.editable === false) return;
      withView((view) => {
        toggleMark(schema.marks.code)(view.state, view.dispatch, view);
        view.focus();
      });
    },

    insertInlineMath() {
    },

    insertLink() {
      if (editorRef.current?.editable === false) return;
      withView((view) => {
        const tr = insertLinkTransaction(view.state);
        if (!tr) return;
        view.dispatch(tr);
        view.focus();
      });
    },

    insertImage() {
      if (editorRef.current?.editable === false) return;
      onInsertImageRequest?.();
    },

    insertImageRef(src: string, alt: string) {
      if (editorRef.current?.editable === false) return;
      withView((view) => applyInsertImageRef(view, src, alt));
    },

    replaceImageSrc(oldSrc: string, newSrc: string) {
      withView((view) => {
        const tr = view.state.tr;
        let changed = false;
        view.state.doc.descendants((node, pos) => {
          if (!node.isText) return;
          const text = node.text;
          if (!text) return;
          const idx = text.indexOf(`](${oldSrc}`);
          if (idx === -1) return;
          const closeParen = text.indexOf(")", idx);
          if (closeParen === -1) return;
          const from = pos + idx + 2;
          const to = pos + closeParen;
          try {
            tr.replaceWith(from, to, view.state.schema.text(newSrc));
            changed = true;
          } catch (e) {
            console.warn("[replaceImageSrc] replace failed:", e);
          }
        });
        if (changed) view.dispatch(tr);
      });
    },

    setImageUploading(src: string) {
      withView((view) => setUploadState(src, view));
    },

    clearImageUploading(src: string) {
      withView((view) => clearUploadState(src, view));
    },

    setEditable(editable: boolean) {
      editorRef.current?.setEditable(editable);
    },

    toggleTypewriterMode() {
      withView((view) => {
        const next = !typewriterPluginKey.getState(view.state)?.enabled;
        view.dispatch(view.state.tr.setMeta(typewriterPluginKey, { enabled: next }));
        try {
          window.dispatchEvent(new CustomEvent("typewriter-changed", { detail: { enabled: next } }));
        } catch {}
        view.focus();
      });
    },

    setTypewriterMode(enabled: boolean) {
      withView((view) => {
        const current = typewriterPluginKey.getState(view.state)?.enabled ?? false;
        if (current === enabled) return;
        view.dispatch(view.state.tr.setMeta(typewriterPluginKey, { enabled }));
        try {
          window.dispatchEvent(new CustomEvent("typewriter-changed", { detail: { enabled } }));
        } catch {}
      });
    },
    };
  }, [onInsertImageRequest]);



  useEffect(() => {
    const editorEl = editorRef.current?.view.dom;
    if (autoCapitalize) {
      // 只放开自动大写：spellcheck / autocomplete 与自动大写无关，必须保持关闭。
      // 浏览器拼写检查在大文档下会随每次按键重扫全文（Chromium 76+ / macOS
      // AppleSpell），此前这里把 spellcheck 一并移除，导致开启自动大写后
      // 拼写检查被静默打开。autocorrect 仍不设置（避免干扰 Windows IME）。
      irContainerRef.current?.removeAttribute('autocapitalize');
      irContainerRef.current?.removeAttribute('autocorrect');
      irContainerRef.current?.setAttribute('autocomplete', 'off');
      irContainerRef.current?.setAttribute('spellcheck', 'false');
      editorEl?.removeAttribute('autocapitalize');
      editorEl?.removeAttribute('autocorrect');
      editorEl?.setAttribute('autocomplete', 'off');
      editorEl?.setAttribute('spellcheck', 'false');
    } else {
      irContainerRef.current?.setAttribute('autocapitalize', 'off');
      irContainerRef.current?.setAttribute('autocorrect', 'off');
      irContainerRef.current?.setAttribute('autocomplete', 'off');
      irContainerRef.current?.setAttribute('spellcheck', 'false');
      editorEl?.setAttribute('autocapitalize', 'off');
      // 不在编辑器 contenteditable 元素上设置 autocorrect，避免干扰 Windows IME
      editorEl?.setAttribute('autocomplete', 'off');
      editorEl?.setAttribute('spellcheck', 'false');
    }
  }, [autoCapitalize]);

  useEffect(() => {
    // 仅 IR 激活（可见）时输出大纲，避免隐藏编辑器覆盖侧边栏大纲。
    // 注意：不依赖 content —— 内容变化已由编辑器内的 outline 插件（按标题是否
    // 被触及）统一触发，再挂一个 content 依赖会让每次按键多算一遍全文大纲。
    if (!isIrActive || !onOutlineChange) return;
    const editor = editorRef.current;
    if (!editor) return;
    const extracted = extractOutline(editor.view);
    const outline = extracted.map((h) => ({
      level: h.level,
      text: h.text,
      line: h.line ?? 0,
      pos: h.pos,
      excerpt: h.excerpt,
    }));
    onOutlineChange(outline);
  }, [onOutlineChange, isIrActive]);

  const irPane = (
    <div
      ref={irContainerRef}
      className={`prosemirror-editor-container texto-editor${codeBlockWordWrap ? ' code-block-word-wrap' : ''}${readableLineLength === false ? ' full-width' : ''}`}
      onContextMenu={handleContextMenu}
    />
  );

  const svPane = dualMode && (svMounted || visualMode === 'sv') ? (
    <Suspense fallback={null}>
      <SourceCodeView
        content={content}
        onChange={(md, selection, selectionBefore) => {
          sessionRef.current?.commit({ md, selection, selectionBefore, source: "sv" });
        }}
        onSave={() => onSaveRef.current?.()}
        appearance={appearance}
        showLineNumbers={showLineNumbers}
        codeBlockWordWrap={codeBlockWordWrap}
        scrollToLine={scrollToLine}
        scrollTrigger={scrollTrigger}
        scrollToHeading={scrollToHeading}
        onOutlineChange={onOutlineChange}
        autoCapitalize={autoCapitalize}
        editable={editable}
        active={visualMode === 'sv'}
        onUndo={() => sessionRef.current?.undo("sv") ?? false}
        onRedo={() => sessionRef.current?.redo("sv") ?? false}
        // 内容由会话经 applyMarkdown 驱动，不走 prop 受控同步
        syncContent={false}
        onViewReady={(api) => {
          svApiRef.current = api;
          if (api && sessionRef.current) {
            sessionRef.current.registerView("sv", createSvAdapter(api), true);
            // 视图在 SV 模式下才挂载：把会话光标一并落到当前视图并聚焦
            if (visualModeRef.current === "sv") {
              sessionRef.current.syncView("sv", null, true);
            }
          }
          if (!api) sessionRef.current?.unregisterView("sv");
        }}
      />
    </Suspense>
  ) : null;

  // Agent 逐字插入时叠在 panes 上的图层：自绘光标 + 右下角指示器。
  // 不进编辑器 DOM（PM 独占容器），所以放 panes / 单栏外壳的 relative 容器里。
  const agentOverlay = (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" data-agent-overlay="">
      <div
        ref={agentCaretRef}
        className="absolute left-0 top-0 w-[2px] rounded-full bg-violet-500 opacity-0 shadow-[0_0_6px_rgba(139,92,246,0.85)] transition-opacity duration-150 ease-out"
        data-agent-caret=""
      />
      {agentStreaming ? (
        <div
          className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur"
          data-agent-streaming=""
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-500 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet-500" />
          </span>
          <span>{t("editor.agentTyping")}</span>
        </div>
      ) : null}
    </div>
  );

  const slashMenu = slashState.active && editorRef.current ? (    <SlashMenu
      view={editorRef.current.view}
      triggerPos={slashState.triggerPos}
      onClose={() => setSlashState({ active: false, triggerPos: 0 })}
      onInsertImageRequest={onInsertImageRequest}
      onInsertEmbedRequest={onInsertEmbedRequest}
      isSingleFileMode={isSingleFileMode}
    />
  ) : null;

  if (dualMode) {
    return (
      <>
        <EditorPanes
          visualMode={visualMode}
          phase={phase}
          rtl={rtl ?? false}
          ir={irPane}
          sv={svPane}
          irHeader={irHeader}
          containerRef={rootRef}
          className={rootClassName}
          overlay={agentOverlay}
        />
        {slashMenu}
      </>
    );
  }

  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {irPane}
        {agentOverlay}
      </div>
      {slashMenu}
    </>
  );
});
