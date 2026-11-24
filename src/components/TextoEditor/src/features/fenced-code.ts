import type { Node as PMNode, ResolvedPos, Schema } from "prosemirror-model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
} from "prosemirror-state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
  type NodeView,
} from "prosemirror-view";
import type { HighlightLanguage, PreviewContext, PreviewRegion } from "@texto/markdown-editor-api";

import { leaveLineDraft } from "@texto/markdown-editor-runtime";
import type { FeatureSpec } from "./_types.ts";
import { editorExtensionLanguages, editorHighlightLanguages } from "../extension/registry.ts";
import { editablePluginKey } from "../editable-key.ts";
import { getDocumentDir } from "../doc-info.ts";
import { createZoomTrigger, openMediaContainer } from "./image-viewer.ts";
import { focusBlockStart, isSelectionInsideBlock } from "./render-container.ts";
import { getScrollParent } from "../scroll-parent.ts";

import hljs from "highlight.js/lib/core";

// ─────────────────────────────────────────────────────────────────────────────
// Syntax-highlight plugin: walks code_block nodes and emits inline decorations
// for each highlight.js token.  PM owns the contentDOM so there is no DOM
// conflict — decorations are pure CSS class annotations.
// ─────────────────────────────────────────────────────────────────────────────

const hlKey = new PluginKey<HljsState>("codeHighlight");
const HLJS_META = "hljsRecompute";

// 单块高亮结果：相对代码块内容起点的 token 区间。缓存起来避免滚动往返时
// 对同一块重复运行 highlight.js。
type BlockDecos = { from: number; to: number; cls: string }[];
type HljsState = {
  decos: DecorationSet;
  // 已高亮过的代码块位置：滚动经过后保持，不因滚出视口而回退，避免反复高亮
  highlighted: Set<number>;
  cache: Map<number, BlockDecos>;
};

// 可高亮代码类节点：schema spec 声明了 `lang` 属性的节点（如 code_block）。
// 语言取 node.attrs.lang；无 lang 的块（如 YAML 前言块）自然被排除。
function isCodeLike(node: PMNode): boolean {
  return node.type.spec.attrs?.lang !== undefined;
}

// 语言由插件经 markdown-editor:syntaxHighlight 贡献。语法定义可以同步给出
// （`grammar`），也可以惰性加载（`loadGrammar`）——后者让语法包留在独立 chunk，
// 只有文档里真的出现该语言时才加载，避免全部语法包进入启动包。
type LangEntry = {
  id: string;
  aliases: string[];
  grammar?: NonNullable<HighlightLanguage["grammar"]>;
  loadGrammar?: HighlightLanguage["loadGrammar"];
};

type LangStatus = "loading" | "ready" | "failed";

const langStatus = new Map<string, LangStatus>();
const langLoadListeners = new Set<() => void>();
let langIndex: Map<string, LangEntry> | null = null;
let langIndexSignature = "";
let pendingLoads = 0;

function registerGrammar(entry: LangEntry): void {
  const grammar = entry.grammar;
  if (!grammar) return;
  try {
    if (!hljs.getLanguage(entry.id)) hljs.registerLanguage(entry.id, grammar);
    if (entry.aliases.length) hljs.registerAliases(entry.aliases, { languageName: entry.id });
    langStatus.set(entry.id, "ready");
  } catch (err) {
    langStatus.set(entry.id, "failed");
    if (import.meta.env.DEV) console.error("[editor] 注册语法高亮失败:", entry.id, err);
  }
}

/**
 * 语言索引（id + 别名 → 条目）。首次使用时构建；贡献集合变化（测试重置注册表、
 * 热更新）时按签名重建，生产期贡献在启动后不变，因此基本总是命中缓存。
 * 构建时把同步贡献的 `grammar` 直接注册掉（兼容旧插件）。
 */
function languageIndex(): Map<string, LangEntry> {
  const languages = editorHighlightLanguages();
  const signature = languages.map((l) => `${l.id}:${l.grammar ? "g" : "l"}`).join(",");
  if (langIndex && signature === langIndexSignature) return langIndex;
  langIndexSignature = signature;
  const map = new Map<string, LangEntry>();
  for (const lang of languages) {
    const entry: LangEntry = {
      id: lang.id,
      aliases: lang.aliases ?? [],
      grammar: lang.grammar,
      loadGrammar: lang.loadGrammar,
    };
    if (!map.has(lang.id)) map.set(lang.id, entry);
    for (const alias of entry.aliases) if (!map.has(alias)) map.set(alias, entry);
    if (entry.grammar) registerGrammar(entry);
  }
  langIndex = map;
  return map;
}

function notifyLanguagesLoaded(): void {
  for (const listener of langLoadListeners) {
    try {
      listener();
    } catch (err) {
      if (import.meta.env.DEV) console.error("[editor] 语法高亮重算失败:", err);
    }
  }
}

/**
 * 请求某个语言的语法是否可用：`ready` 可立即高亮，`pending` 正在加载（先保持纯文本），
 * `unknown` 未贡献该语言（回退 highlightAuto）。
 */
function requestLanguage(lang: string): "ready" | "pending" | "unknown" {
  const entry = languageIndex().get(lang.toLowerCase());
  if (!entry) return "unknown";
  const status = langStatus.get(entry.id);
  if (status === "ready") return "ready";
  if (status === "loading") return "pending";
  if (status === "failed") return "unknown";
  if (!entry.loadGrammar) {
    langStatus.set(entry.id, "failed");
    return "unknown";
  }
  langStatus.set(entry.id, "loading");
  pendingLoads += 1;
  void entry
    .loadGrammar()
    .then((grammar) => {
      if (langStatus.get(entry.id) !== "loading") return;
      entry.grammar = grammar;
      registerGrammar(entry);
      if (langStatus.get(entry.id) !== "ready") langStatus.set(entry.id, "failed");
    })
    .catch((err) => {
      langStatus.set(entry.id, "failed");
      if (import.meta.env.DEV) console.error("[editor] 加载语法高亮失败:", entry.id, err);
    })
    .finally(() => {
      pendingLoads -= 1;
      // 一批加载全部落地后再重算一次：避免 N 个语言各自触发一次可见块重高亮。
      if (pendingLoads === 0) notifyLanguagesLoaded();
    });
  return "pending";
}

/** 无语言标记的代码块走 highlightAuto，需要这组语言才能识别出有意义的结果。 */
const AUTO_PRELOAD_LANGUAGES = [
  "javascript",
  "typescript",
  "python",
  "bash",
  "json",
  "xml",
  "css",
  "markdown",
];

/**
 * 文档打开时扫一遍代码块，只加载「实际用到的语言」的语法包。
 * 只在新视图创建时执行一次（不随每次按键）。
 */
function preloadDocumentLanguages(doc: PMNode): void {
  const seen = new Set<string>();
  let hasUnlabeled = false;
  doc.descendants((node) => {
    if (!isCodeLike(node) || !node.textContent) return true;
    const lang = ((node.attrs.lang as string) || "").toLowerCase();
    if (!lang) {
      hasUnlabeled = true;
      return true;
    }
    if (seen.has(lang)) return true;
    seen.add(lang);
    requestLanguage(lang);
    return true;
  });
  if (hasUnlabeled) {
    for (const lang of AUTO_PRELOAD_LANGUAGES) requestLanguage(lang);
  }
}

/**
 * 仅测试用：等所有贡献语言的语法包加载完成。
 * 生产路径按需加载（见 `preloadDocumentLanguages`），不需要这个入口。
 */
export async function preloadAllHighlightLanguages(): Promise<void> {
  const ids = new Set<string>();
  for (const entry of languageIndex().values()) ids.add(entry.id);
  for (const id of ids) requestLanguage(id);
  while (pendingLoads > 0) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function highlightBlock(node: PMNode): BlockDecos {
  const lang = (node.attrs.lang as string) || undefined;
  // 语法包还在加载：先保持纯文本，加载完成后由视图监听触发重算。
  if (lang && requestLanguage(lang) === "pending") return [];
  // 无任何可用语法（如插件被禁用）时保持纯文本，避免 highlightAuto 在零语言下告警。
  if (hljs.listLanguages().length === 0) return [];
  const text = node.textContent;

  const result = lang
    ? (() => {
        try {
          if (!hljs.getLanguage(lang)) {
            return hljs.highlightAuto(text);
          }
          return hljs.highlight(text, { language: lang, ignoreIllegals: true });
        } catch {
          return hljs.highlightAuto(text);
        }
      })()
    : hljs.highlightAuto(text);

  const out: BlockDecos = [];
  const wrapper = document.createElement("div");
  wrapper.innerHTML = result.value;
  let offset = 0;
  function walk(el: HTMLElement): void {
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
        offset += (child as Text).data.length;
      } else if (child.nodeType === 1) {
        const childEl = child as HTMLElement;
        const cls = childEl.getAttribute("class") ?? "";
        const start = offset;
        walk(childEl);
        if (cls.startsWith("hljs-")) out.push({ from: start, to: offset, cls });
      }
    }
  }
  walk(wrapper as HTMLElement);
  return out;
}

/** 把单块的相对 token 区间转成文档绝对装饰。 */
function blockDecosAt(pos: number, rel: BlockDecos): Decoration[] {
  const out: Decoration[] = [];
  for (const d of rel) {
    out.push(Decoration.inline(pos + 1 + d.from, pos + 1 + d.to, { class: d.cls }));
  }
  return out;
}

// 返回"接近视口"且尚未高亮的代码块位置（含 ±buffer 预取，避免刚好在边缘时闪烁）。
// 直接比对代码块 DOM 的 getBoundingClientRect 与滚动容器可见区，
// 不依赖 posAtCoords/elementFromPoint（在真实 WebView 中对代码块 chrome、
// 滚动后的负坐标等场景会失效）。
function visibleCodeBlocks(
  view: EditorView,
  doc: PMNode,
  highlighted: Set<number>,
  bufferPx = 200,
): number[] {
  const container = getScrollParent(view);
  const containerRect = container.getBoundingClientRect();
  if (containerRect.height <= 0) return [];
  const top = containerRect.top - bufferPx;
  const bottom = containerRect.bottom + bufferPx;

  const out: number[] = [];
  doc.descendants((node, pos) => {
    if (
      !isCodeLike(node) ||
      !node.textContent
    ) return true;
    if (highlighted.has(pos)) return true;
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (!dom) return true;
    const r = dom.getBoundingClientRect();
    if (r.bottom < top || r.top > bottom) return true;
    out.push(pos);
    return true;
  });
  return out;
}

const hljsHighlightPlugin = new Plugin<HljsState>({
  key: hlKey,
  state: {
    // 初始不预高亮：视口内代码块由 view() 的首次 pass 高亮，其余随滚动懒高亮，
    // 避免打开文档时对所有代码块一次性跑 highlight.js。
    init() {
      return { decos: DecorationSet.empty, highlighted: new Set(), cache: new Map() };
    },
    apply(tr, old, _oldState, newState) {
      const meta = tr.getMeta(HLJS_META) as
        | { invalidate?: boolean; positions?: number[] }
        | undefined;
      if (meta) {
        let highlighted = old.highlighted;
        let cache = old.cache;
        let decos = old.decos;
        // 文档变化后位置可能漂移，需清掉按位置索引的缓存，重新高亮可见块
        if (meta.invalidate) {
          highlighted = new Set();
          cache = new Map();
          decos = DecorationSet.empty;
        }
        const positions = meta.positions;
        if (positions && positions.length > 0) {
          for (const pos of positions) {
            if (highlighted.has(pos)) continue;
            const node = newState.doc.nodeAt(pos);
            if (
              !node ||
              !isCodeLike(node) ||
              !node.textContent
            ) continue;
            const rel = highlightBlock(node);
            cache.set(pos, rel);
            highlighted.add(pos);
            // 只把这一块的装饰加进已有集合：不再遍历全篇重建 DecorationSet
            decos = decos.add(newState.doc, blockDecosAt(pos, rel));
          }
        }
        if (decos === old.decos && highlighted === old.highlighted) return old;
        return { decos, highlighted, cache };
      }
      if (!tr.docChanged) return old;

      // 普通文档变化：按事务把已高亮代码块的位置映射到新文档，只有内容或语言
      // 实际变化的块才丢弃缓存（由后续 recompute 对可见块重新高亮）。未受影响的
      // 块立即在正确位置保留高亮，避免每次编辑其他内容都清空全部高亮造成闪烁。
      // 装饰集同样用 map 平移，只对失效块做一次定点移除：不再每键遍历全篇节点
      // 重建所有 Decoration（那样每次按键都是 O(整篇节点 + 全部 token)）。
      let decos = old.decos.map(tr.mapping, newState.doc);
      const cache = new Map<number, BlockDecos>();
      const highlighted = new Set<number>();
      for (const [pos, tokens] of old.cache) {
        const mapped = tr.mapping.mapResult(pos, 1);
        if (mapped.deleted) continue;
        const prevNode = _oldState.doc.nodeAt(pos);
        const newNode = newState.doc.nodeAt(mapped.pos);
        if (
          !prevNode ||
          !newNode ||
          newNode.type.name !== prevNode.type.name ||
          newNode.attrs.lang !== prevNode.attrs.lang ||
          newNode.textContent !== prevNode.textContent
        ) {
          // 该块内容/语言变了：旧装饰已被 map 到新位置但不再有效，定点移除
          if (newNode) {
            const from = mapped.pos + 1;
            const to = mapped.pos + newNode.nodeSize - 1;
            if (to > from) decos = decos.remove(decos.find(from, to));
          }
          continue;
        }
        cache.set(mapped.pos, tokens);
        highlighted.add(mapped.pos);
      }
      return { decos, highlighted, cache };
    },
  },
  props: {
    decorations(state) {
      return hlKey.getState(state)?.decos ?? DecorationSet.empty;
    },
  },
  view: (view) => {
    const scrollParent = getScrollParent(view);
    let rafId: number | null = null;

    const recompute = (invalidate: boolean): void => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const st = hlKey.getState(view.state);
        const positions = visibleCodeBlocks(view, view.state.doc, st?.highlighted ?? new Set<number>());
        // 滚动时无新高亮需求就不派发；文档变化（invalidate）时即使无可见块也要
        // 派发以清掉位置漂移后的旧高亮。
        if (positions.length === 0 && !invalidate) return;
        view.dispatch(view.state.tr.setMeta(HLJS_META, { invalidate, positions }));
      });
    };

    const onScroll = (): void => recompute(false);
    scrollParent.addEventListener("scroll", onScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => recompute(false));
      resizeObserver.observe(scrollParent);
    }

    // 语法包惰性加载：打开文档时只请求实际用到的语言；任一语言落地后重算
    // 一次可见块（此时之前返回空装饰的块会补上高亮）。
    const onLanguagesLoaded = (): void => recompute(true);
    langLoadListeners.add(onLanguagesLoaded);
    preloadDocumentLanguages(view.state.doc);

    // 首次：高亮初始视口内的代码块
    recompute(true);

    return {
      update: (view, prevState) => {
        if (view.state.doc === prevState.doc) return;
        // 文档变化：位置漂移已由 apply 映射处理，这里只补齐新增/内容变化的
        // 可见代码块，不清空未受影响的已有高亮（避免编辑其他内容时闪烁）。
        recompute(false);
      },
      destroy: () => {
        langLoadListeners.delete(onLanguagesLoaded);
        scrollParent.removeEventListener("scroll", onScroll);
        resizeObserver?.disconnect();
        if (rafId !== null) cancelAnimationFrame(rafId);
      },
    };
  },
});

const FENCE_RE = /^```(\w*)$/;
const MATH_BLOCK_RE = /^\$\$$/;

// ─────────────────────────────────────────────────────────────────────────────
// lang-focus plugin state: which code_block (by pos) currently owns the
// virtual cursor inside its lang input. Empty = cursor lives in PM doc.
// ─────────────────────────────────────────────────────────────────────────────

type LangFocus = { pos: number } | null;

const langFocusKey = new PluginKey<LangFocus>("fencedCodeLangFocus");

/**
 * 在下拉里按 Enter 选定语言会重建 NodeView（输入框会换新）。
 * 新输入框聚焦时不应再自动弹出下拉：此时已经是最终语言，没有可选项。
 */
let suppressLangDropdownForPos: number | null = null;

export function getLangFocus(state: EditorState): LangFocus {
  return langFocusKey.getState(state) ?? null;
}

function codeBlockPosAt(state: EditorState, pos: number): number | null {
  const $ = state.doc.resolve(pos);
  for (let d = $.depth; d >= 0; d--) {
    const node = $.node(d);
    if (node.type.name === "code_block") return $.before(d);
  }
  return null;
}

/**
 * 自 `start` 起按文档顺序找到第一个可放光标的文本块（段落/标题/代码块等），
 * 返回其内容起点。列表、引用、表格等容器会继续向内查找。
 */
function firstTextblockPosFrom(doc: PMNode, start: number): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (pos < start) return true;
    if (node.isTextblock) {
      found = pos + 1;
      return false;
    }
    return true;
  });
  return found;
}

/** 在文档末尾追加空段落并选中。 */
function appendParagraph(tr: EditorState["tr"]): boolean {
  const paraType = tr.doc.type.schema.nodes.paragraph;
  const newPara = paraType?.createAndFill();
  if (!newPara) return false;
  const at = tr.doc.content.size;
  tr.insert(at, newPara);
  tr.setSelection(TextSelection.create(tr.doc, at + 1));
  return true;
}

/**
 * 光标是否位于所在顶层块的“顶边”：
 * - 顶层文本块（段落/标题）：沿用既有语义，任意位置均可；
 * - 列表、引用、表格等容器：必须在容器内第一个文本块的第一行，
 *   避免从列表中间按 ArrowUp 时被直接劫持到上方代码块。
 */
function isAtTopEdgeOfBlock(
  doc: PMNode,
  $from: ResolvedPos,
): boolean {
  if ($from.depth <= 1) return true;
  const containerPos = $from.before(1);
  const firstText = firstTextblockPosFrom(doc, containerPos);
  if (firstText === null || $from.before() + 1 !== firstText) return false;
  const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
  return !textBefore.includes("\n");
}

/** 让光标先进入 blockPos 上方相邻代码块的语言选择器；不适用时返回 false。 */
function enterPrevCodeBlockLang(
  view: EditorView,
  state: EditorState,
  blockPos: number,
): boolean {
  if (blockPos <= 0) return false;
  const $before = state.doc.resolve(blockPos);
  const index = $before.index();
  if (index <= 0) return false;
  const prev = $before.parent.child(index - 1);
  if (prev.type.name !== "code_block") return false;
  const prevPos = blockPos - prev.nodeSize;
  // 把 PM 选区停到上方代码体末尾（lang-focus 期间由 CSS 隐藏），
  // 下方块不再残留可见光标。
  const endInside = prevPos + prev.nodeSize - 1;
  const tr = state.tr
    .setSelection(TextSelection.create(state.doc, endInside))
    .setMeta(langFocusKey, { pos: prevPos });
  view.dispatch(tr);
  const focusEl = view.dom?.querySelector(
    ".cb-lang-focus .cb-lang-input",
  ) as HTMLInputElement | null;
  focusEl?.focus();
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Language dropdown: registry-driven (plugin-contributed hljs grammars +
// custom code-block view languages).
// ─────────────────────────────────────────────────────────────────────────────

type LangOption = { value: string; label: string; aliases?: string[] };

const TEXT_LANG_LABEL = "text";

/**
 * 语言下拉数据源：text + 插件贡献的 hljs 语法 + 自定义代码块视图语言（mermaid/math/latex 等）。
 * 按 value 去重；高亮语言在前，自定义视图语言在后。
 */
export function languageOptions(): LangOption[] {
  const seen = new Set<string>([""]);
  const out: LangOption[] = [{ value: "", label: TEXT_LANG_LABEL }];
  for (const lang of editorHighlightLanguages()) {
    if (seen.has(lang.id)) continue;
    seen.add(lang.id);
    out.push({ value: lang.id, label: lang.label ?? lang.id, aliases: lang.aliases });
  }
  for (const lang of editorExtensionLanguages()) {
    if (seen.has(lang)) continue;
    seen.add(lang);
    out.push({ value: lang, label: lang });
  }
  return out;
}

function displayLang(lang: string): string {
  return lang || TEXT_LANG_LABEL;
}

function normalizeLang(display: string): string {
  return display.trim().toLowerCase() === TEXT_LANG_LABEL ? "" : display;
}

// ─────────────────────────────────────────────────────────────────────────────
// NodeView: outer <pre data-lang><code/></pre> plus a chrome overlay with
// a searchable language dropdown. The input mutates code_block.attrs.lang
// via setNodeAttribute.
// ─────────────────────────────────────────────────────────────────────────────

const activeCodeBlockViews = new Set<CodeBlockView>();

function downloadNameForLanguage(lang: string | undefined): string {
  const value = (lang ?? "").toLowerCase().trim();
  if (value === "mermaid") return "mermaid.svg";
  if (value === "math" || value === "latex" || value === "katex") {
    return "formula.svg";
  }
  const safe = value.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe ? `${safe}.svg` : "diagram.svg";
}

export class CodeBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  protected node: PMNode;
  protected chromeEl: HTMLElement;
  protected inputEl: HTMLInputElement;
  protected dropdownEl: HTMLElement | null = null;
  protected filteredLanguages: LangOption[] = [];
  protected selectedIndex = -1;
  protected view: EditorView;
  protected getPos: () => number | undefined;
  protected preview: PreviewRegion | null = null;
  protected mode: "code" | "render" | "error" = "code";
  protected renderContainer: HTMLElement | null = null;
  protected errorEl: HTMLElement | null = null;
  protected debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** 右键（button 2）之后抑制「光标进入 ⇒ 源码态」，直到下一次左键点击或光标离开该块。 */
  private suppressCodeModeUntilPrimaryClick = false;

  static notifySelectionChange(): void {
    for (const view of activeCodeBlockViews) {
      view.onSelectionChange();
    }
  }

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

    const pre = document.createElement("pre");
    const lang = (node.attrs.lang as string) ?? "";
    if (lang) pre.setAttribute("data-lang", lang);

    const chrome = document.createElement("div");
    chrome.className = "cb-chrome";
    chrome.setAttribute("contenteditable", "false");
    const input = document.createElement("input");
    input.className = "cb-lang-input";
    input.placeholder = TEXT_LANG_LABEL;
    input.value = displayLang(lang);
    input.spellcheck = false;
    chrome.appendChild(input);

    const code = document.createElement("code");
    pre.appendChild(chrome);
    pre.appendChild(code);

    this.dom = pre;
    this.contentDOM = code;
    this.chromeEl = chrome;
    this.inputEl = input;

    // 右键不得切源码态：某些引擎会把插入点移进块内（命中目标不同则行为不同），
    // 这里在块级别做确定性抑制——只有左键点击/键盘交互才允许进入源码态。
    // 用捕获阶段：块的子节点（渲染容器 / chrome / 输入框）自己的 mousedown 处理器
    // 会在事件冒泡到 pre 之前就派发选区事务，故抑制状态必须先行落定。
    this.dom.addEventListener(
      "mousedown",
      (e) => {
        if (e.button === 2) {
          this.suppressCodeModeUntilPrimaryClick = true;
          return;
        }
        if (e.button === 0) this.suppressCodeModeUntilPrimaryClick = false;
      },
      true,
    );

    activeCodeBlockViews.add(this);

    input.addEventListener("input", this.onInput);
    input.addEventListener("keydown", this.onInputKeyDown);
    input.addEventListener("mousedown", (e) => {
      if (e.button === 2) e.preventDefault();
      e.stopPropagation();
    });
    input.addEventListener("focus", this.onFocus);
    input.addEventListener("blur", this.onBlur);

    window.addEventListener("appearancechange", this.onAppearanceChange);

    this.initPreview();
    if (
      this.preview &&
      this.node.textContent.trim() &&
      (!this.isCursorInside() || !this.view.editable)
    ) {
      this.enterRenderMode();
    }
    this.updateChrome();
  }

  protected updateChrome(): void {
    // cb-active and cb-lang-focus classes are applied via decorations
    // from fencedCodeChromePlugin. The input naturally keeps focus during
    // its own transactions, so no explicit focus() call is needed.
  }

  private onFocus = (): void => {
    const pos = this.getPos();
    if (pos != null && suppressLangDropdownForPos === pos) {
      // 下拉选中项 Enter 后的重新聚焦：语言已是最终值，不再弹下拉。
      suppressLangDropdownForPos = null;
    } else {
      this.showDropdown();
    }
    if (this.currentLang() === "" && this.inputEl.value === TEXT_LANG_LABEL) {
      setTimeout(() => {
        if (document.activeElement === this.inputEl) this.inputEl.select();
      }, 0);
    }
  };

  private onBlur = (_e: FocusEvent): void => {
    // Delay hiding to allow click events on dropdown items
    setTimeout(() => {
      if (this.dropdownEl?.contains(document.activeElement)) return;
      const pos = this.getPos();
      const typed = normalizeLang(this.inputEl.value);
      this.hideDropdown();
      // Clear langFocus state when input loses focus
      if (pos != null) {
        const lf = langFocusKey.getState(this.view.state);
        if (lf && lf.pos === pos) {
          this.view.dispatch(this.view.state.tr.setMeta(langFocusKey, null));
        }
      }
      // 提交语言变化（可能触发 PM 重建），放最后避免后续访问已销毁的视图
      if (pos != null) {
        const current = (this.view.state.doc.nodeAt(pos)?.attrs.lang as string) ?? "";
        if (typed !== current) {
          this.view.dispatch(this.view.state.tr.setNodeAttribute(pos, "lang", typed));
        }
      }
    }, 150);
  };

  private currentLang(): string {
    const pos = this.getPos();
    if (pos == null) return "";
    return (this.view.state.doc.nodeAt(pos)?.attrs.lang as string) ?? "";
  }

  private queryForFiltering(): string {
    const raw = this.inputEl.value;
    // 空语言块显示占位 "text"：聚焦时按空查询展示完整列表，方便挑选语言。
    if (this.currentLang() === "" && raw.trim().toLowerCase() === TEXT_LANG_LABEL) {
      return "";
    }
    // 其余情况按输入值过滤；精确匹配时 filterLanguages 会隐藏下拉。
    return raw;
  }

  private showDropdown(): void {
    if (this.dropdownEl) return;

    const dropdown = document.createElement("div");
    dropdown.className = "cb-lang-dropdown";
    this.chromeEl.appendChild(dropdown);
    this.dropdownEl = dropdown;

    this.filterLanguages(this.queryForFiltering());
  }

  private hideDropdown(): void {
    if (!this.dropdownEl) return;
    this.dropdownEl.remove();
    this.dropdownEl = null;
    this.selectedIndex = -1;
  }

  private filterLanguages(query: string): void {
    const lowerQuery = query.toLowerCase().trim();
    this.filteredLanguages = languageOptions().filter(
      (lang) =>
        lang.value.toLowerCase().includes(lowerQuery) ||
        lang.label.toLowerCase().includes(lowerQuery) ||
        (lang.aliases?.some((alias) => alias.toLowerCase().includes(lowerQuery)) ?? false),
    );
    this.selectedIndex = -1;

    // 已精确匹配到唯一语言（含别名）：没有其它可选项，不展示下拉。
    if (this.filteredLanguages.length === 1) {
      const exactMatch = this.filteredLanguages[0];
      if (
        exactMatch.value.toLowerCase() === lowerQuery ||
        exactMatch.label.toLowerCase() === lowerQuery ||
        (exactMatch.aliases?.some(
          (alias) => alias.toLowerCase() === lowerQuery,
        ) ??
          false)
      ) {
        this.hideDropdown();
        return;
      }
    }

    if (this.dropdownEl) {
      this.renderDropdown();
    } else {
      this.showDropdown();
    }
  }

  private renderDropdown(): void {
    if (!this.dropdownEl) return;

    this.dropdownEl.innerHTML = "";

    if (this.filteredLanguages.length === 0) {
      const noResult = document.createElement("div");
      noResult.className = "cb-lang-item cb-lang-no-result";
      noResult.textContent = "No languages found";
      this.dropdownEl.appendChild(noResult);
      return;
    }

    this.filteredLanguages.forEach((lang, index) => {
      const item = document.createElement("div");
      item.className = "cb-lang-item";
      if (index === this.selectedIndex) {
        item.classList.add("selected");
      }
      item.textContent = lang.label;
      item.addEventListener("mousedown", (e) => {
        // 只处理左键；右键不应直接选中语言
        if (e.button !== 0) return;
        e.preventDefault();
        this.selectLanguage(lang.value);
      });
      this.dropdownEl!.appendChild(item);
    });
  }

  protected selectLanguage(
    value: string,
    exitTo: "body" | "below" | "stay" = "body",
  ): void {
    const lang = normalizeLang(value);
    this.inputEl.value = displayLang(lang);
    // 无论哪种退出方式，提交后都关闭下拉；"stay" 只保留输入框焦点。
    this.hideDropdown();

    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    const current = (node?.attrs.lang as string) ?? "";
    const changed = lang !== current;
    const tr = this.view.state.tr.setNodeAttribute(pos, "lang", lang);

    if (exitTo === "stay") {
      tr.setMeta(langFocusKey, { pos });
    } else if (exitTo === "below") {
      // Enter 提交：语言选择器浮在代码块下方，确认后落到块下方的段落。
      // 下方不是普通段落（如另一个代码块/表格/标题）时不能把光标送进去，
      // 而是在两者之间新建空段落。
      tr.setMeta(langFocusKey, null);
      this.setSelectionInParagraphBelow(tr, pos);
    } else if (changed) {
      // 语言变化将触发重建，输入框会被替换：清掉 langFocus，并把光标放回
      // 代码块正文末尾。重建会销毁当前持有焦点的输入框，若不手动恢复，
      // 焦点会落到 body，后续 Enter 无法在代码块中换行。
      tr.setMeta(langFocusKey, null);
      if (node) {
        const endInside = pos + node.nodeSize - 1;
        tr.setSelection(TextSelection.create(tr.doc, endInside));
      }
    } else {
      // 语言未变：保留输入焦点语义
      tr.setMeta(langFocusKey, { pos });
    }
    this.view.dispatch(tr);

    if (exitTo === "stay") {
      // 语言变化会重建 NodeView：按位置重新取新输入框并聚焦，让用户留在
      // 语言选择器里；但此时已是最终语言，聚焦时不再自动弹下拉。
      const nodeDom = this.view.nodeDOM(pos) as HTMLElement | null;
      const nextInput = nodeDom?.querySelector(
        ".cb-lang-input",
      ) as HTMLInputElement | null;
      if (nextInput) {
        suppressLangDropdownForPos = pos;
        nextInput.focus();
        // 输入框原本已聚焦时不会触发 focus 事件，兜底清掉抑制标记。
        if (suppressLangDropdownForPos === pos) {
          suppressLangDropdownForPos = null;
        }
      } else {
        // 目标语言由不带语言输入框的视图认领：回落到下方段落。
        suppressLangDropdownForPos = null;
        const st = this.view.state;
        const next = st.doc.nodeAt(pos);
        const fallback = st.tr.setMeta(langFocusKey, null);
        if (next) {
          const textPos = firstTextblockPosFrom(
            st.doc,
            pos + next.nodeSize,
          );
          if (textPos !== null) {
            fallback.setSelection(TextSelection.create(fallback.doc, textPos));
          } else {
            appendParagraph(fallback);
          }
        }
        this.view.dispatch(fallback);
        this.view.focus();
      }
      return;
    }

    // 语言变化重建或退出到下方都会丢失输入框焦点，需要显式交还编辑器；
    // 仅“语言未变且留在输入框”时保留输入框焦点。
    if (exitTo === "below" || changed) this.view.focus();
  }

  private onInput = (): void => {
    this.filterLanguages(this.inputEl.value);
    const pos = this.getPos();
    if (pos == null) return;
    // 输入过程中只更新下拉与焦点装饰；lang 的实际提交来自 Enter/blur（见 onBlur 的提交与 selectLanguage）
    this.view.dispatch(this.view.state.tr.setMeta(langFocusKey, { pos }));
  };

  private onInputKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (this.dropdownEl && this.selectedIndex < this.filteredLanguages.length - 1) {
        this.selectedIndex++;
        this.renderDropdown();
        this.scrollSelectedIntoView();
        return;
      }
      // No dropdown or at last item → exit to the block below
      this.exitToBelowBlock();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (this.dropdownEl && this.selectedIndex > -1) {
        this.selectedIndex--;
        this.renderDropdown();
        this.scrollSelectedIntoView();
      } else {
        this.exitToCodeBody();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (this.dropdownEl && this.selectedIndex >= 0) {
        const lang = this.filteredLanguages[this.selectedIndex];
        if (lang) {
          // 高亮项 Enter = 选定这门语言，留在选择器里继续挑选
          this.selectLanguage(lang.value, "stay");
        }
      } else {
        // 无高亮项：确认输入框里的语言，并落到下方段落
        this.selectLanguage(this.inputEl.value, "below");
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.hideDropdown();
      this.exitToCodeBody();
    }
  };

  private exitToBelowBlock(): void {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;
    const tr = this.view.state.tr.setMeta(langFocusKey, null);
    this.setSelectionBelowBlock(tr, pos);
    this.view.dispatch(tr);
    this.view.focus();
  }

  /** 把光标放到代码块下方：优先进入下方第一个文本块（容器向内查找），否则追加段落。 */
  private setSelectionBelowBlock(
    tr: EditorState["tr"],
    pos: number,
  ): void {
    const node = tr.doc.nodeAt(pos);
    if (!node) return;
    const afterBlock = pos + node.nodeSize;
    const textPos = firstTextblockPosFrom(tr.doc, afterBlock);
    if (textPos !== null) {
      tr.setSelection(TextSelection.create(tr.doc, textPos));
    } else {
      this.insertParagraphBelow(tr, tr.doc.content.size);
    }
  }

  /**
   * Enter 提交语言后的落点：正下方是普通段落则进入其起始位置；
   * 否则（代码块、表格、标题等）在代码块与下一块之间新建空段落，
   * 避免光标被送进另一个块里。
   */
  private setSelectionInParagraphBelow(
    tr: EditorState["tr"],
    pos: number,
  ): void {
    const node = tr.doc.nodeAt(pos);
    if (!node) return;
    const afterBlock = pos + node.nodeSize;
    const next = tr.doc.nodeAt(afterBlock);
    if (next?.type.name === "paragraph") {
      tr.setSelection(TextSelection.create(tr.doc, afterBlock + 1));
      return;
    }
    this.insertParagraphBelow(tr, afterBlock);
  }

  /** 在 afterBlock 处插入空段落并把光标放进去。 */
  private insertParagraphBelow(tr: EditorState["tr"], afterBlock: number): void {
    const paraType = tr.doc.type.schema.nodes.paragraph;
    const newPara = paraType?.createAndFill();
    if (!newPara) return;
    tr.insert(afterBlock, newPara);
    tr.setSelection(TextSelection.create(tr.doc, afterBlock + 1));
  }

  private exitToCodeBody(): void {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node) return;
    const endInside = pos + node.nodeSize - 1;
    const tr = this.view.state.tr.setSelection(
      TextSelection.create(this.view.state.doc, endInside),
    );
    tr.setMeta(langFocusKey, null);
    this.view.dispatch(tr);
    this.view.focus();
  }

  private scrollSelectedIntoView(): void {
    if (!this.dropdownEl || this.selectedIndex < 0) return;
    const items = this.dropdownEl.querySelectorAll(".cb-lang-item");
    const selected = items[this.selectedIndex] as HTMLElement;
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }

  update(node: PMNode): boolean {
    if (node.type.name !== "code_block") return false;
    const lang = (node.attrs.lang as string) ?? "";
    if (lang !== ((this.node.attrs.lang as string) ?? "")) {
      // 语言变化：让 PM 重建 NodeView，由分发器按新语言重新认领/回退内置视图
      return false;
    }
    this.node = node;
    if (lang) this.dom.setAttribute("data-lang", lang);
    else this.dom.removeAttribute("data-lang");
    const display = displayLang(lang);
    const focused = document.activeElement === this.inputEl;
    if (!focused && this.inputEl.value !== display) {
      this.inputEl.value = display;
    }
    this.updateChrome();

    if (this.preview) {
      if (this.mode === "render") this.runPreview();
      if (!this.view.editable) {
        this.enterRenderMode();
      } else if (this.handleRightClickSuppression()) {
        // 保持现态（右键不改源码态）
      } else if (this.isCursorInside()) {
        this.enterCodeMode();
      } else if (this.node.textContent.trim()) {
        this.enterRenderMode();
      } else {
        this.enterCodeMode();
      }
    }
    return true;
  }

  private runPreview(): void {
    try {
      this.preview?.update?.(this.node, this.previewCtx());
    } catch (e) {
      this.showRenderError((e as Error)?.message ?? String(e));
    }
  }

  private initPreview(): void {
    if (!this.preview || this.renderContainer) return;
    this.renderContainer = document.createElement("div");
    this.renderContainer.className = "cb-render-container";
    this.renderContainer.style.display = "none";
    this.renderContainer.appendChild(this.preview.dom);
    this.renderContainer.addEventListener("mousedown", (e) => {
      // 只处理左键；右键必须放行，交给编辑器的右键菜单流程
      if (e.button !== 0) {
        // 兜底：右键不移动光标（编辑器根 mousedown 守卫已统一处理）。
        if (e.button === 2) e.preventDefault();
        return;
      }
      // 左键必须在任何 mode 下都阻止浏览器默认的插入点落点：错误态
      // （cb-error-mode）渲染容器仍然可见（保留上一张图 + 错误面板），
      // NodeView 的 stopEvent 只能让 PM 跳过事件，拦不住浏览器把 DOM 选区
      // 放进 SVG / 编辑器开头；一旦被浏览器落点，PM 的 DOM 观察器会把选区
      // 同步成文档开头 ⇒ 光标丢失 + 视口回顶。
      e.preventDefault();
      if (this.mode === "code" || !this.view.editable) return;
      // 先让源码区可见再派发选区：错误态下 contentDOM 仍是 display:none，
      // 直接派发会让 DOM 选区落在隐藏内容里被浏览器丢弃，同样退回文档开头。
      this.enterCodeMode();
      // getPos() 失效/越界时由 NodeView 根 DOM 重新绑定块内位置。
      focusBlockStart(this.view, this.getPos(), this.dom, e.clientY);
    });
    this.renderContainer.addEventListener("click", (e) => {
      if (this.mode !== "render" || this.view.editable) return;
      if (!this.renderContainer) return;
      e.preventDefault();
      e.stopPropagation();
      openMediaContainer(this.renderContainer, {
        suggestedName: downloadNameForLanguage(
          this.node.attrs.lang as string | undefined,
        ),
      });
    });
    if (this.contentDOM?.parentNode) {
      this.contentDOM.parentNode.insertBefore(this.renderContainer, this.contentDOM.nextSibling);
    }
  }

  private previewCtx(): PreviewContext {
    return {
      documentDir: getDocumentDir(this.view.state),
      theme: "base",
      onError: (msg) => this.showRenderError(msg),
      onSuccess: () => this.clearRenderError(),
    };
  }

  /**
   * 渲染容器右上角的放大按钮。渲染是异步的（每次 innerHTML 重写都会清空
   * 子节点），因此每次出图后重新挂载。
   */
  protected mountZoomTrigger(): void {
    if (!this.renderContainer || this.mode !== "render") return;
    this.renderContainer.querySelector(".media-zoom-trigger")?.remove();
    this.renderContainer.appendChild(
      createZoomTrigger(this.renderContainer, {
        suggestedName: downloadNameForLanguage(
          this.node.attrs.lang as string | undefined,
        ),
      }),
    );
  }

  protected isCursorInside(): boolean {
    return isSelectionInsideBlock(this.view, this.getPos(), this.node.nodeSize);
  }

  /**
   * 右键之后抑制「光标进入 ⇒ 源码态」：光标离开该块即自动解除。
   * 返回 true 表示本次已由抑制逻辑处理（调用方不应再进入源码态）。
   */
  private handleRightClickSuppression(): boolean {
    if (!this.suppressCodeModeUntilPrimaryClick) return false;
    if (!this.isCursorInside()) {
      this.suppressCodeModeUntilPrimaryClick = false;
      return false;
    }
    if (this.mode !== "code") this.enterRenderMode();
    return true;
  }

  protected enterCodeMode(): void {
    if (this.mode === "code" || !this.renderContainer) return;
    this.mode = "code";
    if (this.contentDOM) this.contentDOM.style.display = "";
    this.renderContainer.style.display = "none";
    if (this.errorEl) {
      this.errorEl.remove();
      this.errorEl = null;
    }
    this.dom.classList.remove("cb-render-mode", "cb-error-mode");
    this.dom.classList.add("cb-code-mode");
  }

  protected enterRenderMode(): void {
    if (!this.renderContainer || !this.preview) return;
    if (this.mode === "render") return;
    this.mode = "render";
    if (this.contentDOM) this.contentDOM.style.display = "none";
    this.renderContainer.style.display = "";
    this.dom.classList.remove("cb-code-mode", "cb-error-mode");
    this.dom.classList.add("cb-render-mode");
    this.hideDropdown();
    this.clearLangFocus();
    this.runPreview();
    this.mountZoomTrigger();
  }

  /** 预览成功写入后退出错误态（如切换渲染器后重新出图）。 */
  private clearRenderError(): void {
    this.errorEl?.remove();
    this.errorEl = null;
    if (this.mode !== "error") return;
    this.mode = "render";
    this.dom.classList.remove("cb-error-mode");
    this.dom.classList.add("cb-render-mode");
    // 首次渲染同步失败时 enterRenderMode() 已跳过 mountZoomTrigger()；
    // 恢复 render 态后补挂（mountZoomTrigger 内部幂等移除旧节点）。
    this.mountZoomTrigger();
  }

  private showRenderError(msg: string): void {
    if (!this.renderContainer) return;
    // 用户已左键进入源码态：此前那次预览的异步失败不得抢走编辑态。否则
    // 渲染区与可见的源码区会同时点亮（布局跳变），DOM 选区也被挤出正在编辑
    // 的代码块。错误提示会在下次离开块、重新进入渲染态时随重新渲染正常出现。
    if (this.mode === "code") return;
    this.mode = "error";
    this.renderContainer.style.display = "";
    this.dom.classList.remove("cb-render-mode", "cb-code-mode");
    this.dom.classList.add("cb-error-mode");

    // 不要清空 renderContainer：其中是持久化的 preview.dom，清空会将其从
    // DOM 摘除，重试时 preview.update 会写入已脱离文档的节点，导致预览空白。
    // 错误提示挂在块级 errorEl 上，与 preview.dom 互不干扰。
    if (!this.errorEl) {
      this.errorEl = document.createElement("div");
      this.errorEl.className = "cb-render-error";
      this.dom.appendChild(this.errorEl);
    }
    this.errorEl.innerHTML = `
      <div class="cb-error-icon">!</div>
      <div class="cb-error-msg">${this.escapeHtml(msg)}</div>
      <button class="cb-retry-btn">Retry</button>
    `;
    const btn = this.errorEl.querySelector(".cb-retry-btn") as HTMLButtonElement;
    if (btn) {
      btn.addEventListener("click", () => {
        // 锁定模式下重试不经过源码态，直接重新渲染
        if (this.view.editable) this.enterCodeMode();
        this.scheduleRender();
      });
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  private onSelectionChange(): void {
    if (!this.preview) return;
    // 锁定模式：预览是纯渲染输出，不因光标位置切回源码态
    if (!this.view.editable) {
      this.enterRenderMode();
    } else if (this.handleRightClickSuppression()) {
      // 保持现态（右键不改源码态）
    } else if (this.isCursorInside()) {
      this.clearRenderTimer();
      this.enterCodeMode();
    } else if (this.node.textContent.trim()) {
      this.enterRenderMode();
    }
  }

  private onAppearanceChange = (): void => {
    if (this.mode === "render" && this.preview) {
      this.runPreview();
    }
  };

  protected scheduleRender(): void {
    this.clearRenderTimer();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.isCursorInside() && this.view.editable) return;
      this.enterRenderMode();
    }, 300);
  }

  private clearLangFocus(): void {
    const pos = this.getPos();
    if (pos == null) return;
    const lf = langFocusKey.getState(this.view.state);
    if (lf && lf.pos === pos) {
      this.view.dispatch(this.view.state.tr.setMeta(langFocusKey, null));
    }
  }

  protected clearRenderTimer(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  // The input is non-PM DOM; PM should not process clicks/keys inside it.
  stopEvent(e: Event): boolean {
    if (this.chromeEl.contains(e.target as Node)) return true;
    if (this.renderContainer?.contains(e.target as Node)) return true;
    if (this.errorEl?.contains(e.target as Node)) return true;
    return false;
  }

  // 语言下拉 / 渲染容器 / 错误提示都由本 NodeView 自管，不属于正文内容。
  // 必须忽略所有落在源码编辑区（contentDOM）之外的变更：PM 对「有 contentDOM
  // 的 NodeView」默认不忽略任何变更，会把这里异步回写的渲染结果（模式 class、
  // 挂载错误提示）当成 DOM 编辑 → markDirty → 重建 NodeView → 新视图再次
  // 异步报错 → 再重建，形成无界循环跑满主线程、卡死编辑器。
  // 同源先例见 features/image-ref.ts 的异步预览（白板）。
  ignoreMutation(m: { target: Node }): boolean {
    if (!this.contentDOM) return true;
    return !this.contentDOM.contains(m.target);
  }

  destroy(): void {
    activeCodeBlockViews.delete(this);
    this.inputEl.removeEventListener("input", this.onInput);
    this.inputEl.removeEventListener("keydown", this.onInputKeyDown);
    this.inputEl.removeEventListener("focus", this.onFocus);
    this.inputEl.removeEventListener("blur", this.onBlur);
    this.clearRenderTimer();
    this.hideDropdown();
    this.preview?.destroy?.();
    window.removeEventListener("appearancechange", this.onAppearanceChange);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin: chrome-visibility decorations, lang-focus state, and ArrowUp/Down
// handlers for crossing main ↔ lang-input.
// ─────────────────────────────────────────────────────────────────────────────

function fencedCodeChromePlugin(): Plugin<LangFocus> {
  return new Plugin<LangFocus>({
    key: langFocusKey,
    state: {
      init: () => null,
      apply: (tr, old) => {
        const m = tr.getMeta(langFocusKey);
        if (m === null) return null;
        if (m !== undefined) return m as LangFocus;
        // Map old pos through tr.mapping; if code_block no longer exists, drop.
        if (!old) return null;
        const mapped = tr.mapping.map(old.pos);
        const node = tr.doc.nodeAt(mapped);
        if (!node || node.type.name !== "code_block") return null;
        return { pos: mapped };
      },
    },
    props: {
      decorations(state) {
        const decos: Decoration[] = [];
        const sel = state.selection;
        const editable = editablePluginKey.getState(state) ?? true;

        // Active = cursor sits inside a code_block.
        if (sel.empty && editable) {
          const cbPos = codeBlockPosAt(state, sel.from);
          if (cbPos !== null) {
            const node = state.doc.nodeAt(cbPos);
            if (node) {
              decos.push(
                Decoration.node(
                  cbPos,
                  cbPos + node.nodeSize,
                  { class: "cb-active" },
                  { cbActive: true },
                ),
              );
            }
          }
        }
        const lf = langFocusKey.getState(state);
        if (lf) {
          const node = state.doc.nodeAt(lf.pos);
          if (node && node.type.name === "code_block") {
            decos.push(
              Decoration.node(
                lf.pos,
                lf.pos + node.nodeSize,
                { class: "cb-active cb-lang-focus" },
                { cbActive: true, cbLangFocus: true },
              ),
            );
          }
        }
        return decos.length > 0 ? DecorationSet.create(state.doc, decos) : null;
      },
      handleKeyDown(view, e) {
        if (!view.editable) return false;
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return false;
        if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return false;
        const state = view.state;
        const lf = langFocusKey.getState(state);

        // Case A: already in lang-focus → ArrowUp exits back to code body,
        // ArrowDown exits to the block below (or spawns one).
        if (lf) {
          const node = state.doc.nodeAt(lf.pos);
          if (!node || node.type.name !== "code_block") {
            view.dispatch(state.tr.setMeta(langFocusKey, null));
            return true;
          }
          if (e.key === "ArrowUp") {
            const endInside = lf.pos + node.nodeSize - 1;
            const tr = state.tr
              .setSelection(TextSelection.create(state.doc, endInside))
              .setMeta(langFocusKey, null);
            view.dispatch(tr);
            return true;
          }
          // ArrowDown：落到下方第一个文本块；列表/引用/表格向内取首个文本块，
          // 分割线等叶子节点则跳过；都没有时在文档末尾补一个空段落。
          const afterBlock = lf.pos + node.nodeSize;
          const textPos = firstTextblockPosFrom(state.doc, afterBlock);
          const tr = state.tr.setMeta(langFocusKey, null);
          if (textPos !== null) {
            tr.setSelection(TextSelection.create(tr.doc, textPos));
          } else {
            appendParagraph(tr);
          }
          view.dispatch(tr);
          return true;
        }

        const sel = state.selection;
        if (!sel.empty) return false;
        const $from = sel.$from;

        // Case B: cursor on the last line of a code_block → ArrowDown
        // enters the lang input (any column on the last line).
        if (
          e.key === "ArrowDown" &&
          $from.parent.type.name === "code_block"
        ) {
          const textAfter = $from.parent.textContent.slice($from.parentOffset);
          // No newline after cursor → we are on the last line
          if (!textAfter.includes("\n")) {
            const cbPos = $from.before();
            view.dispatch(state.tr.setMeta(langFocusKey, { pos: cbPos }));
            const focusEl = view.dom?.querySelector(
              ".cb-lang-focus .cb-lang-input",
            ) as HTMLInputElement | null;
            focusEl?.focus();
            return true;
          }
          // Earlier lines → let PM handle normal line navigation
        }

        // Case B2: cursor on the first line of a code_block whose previous
        // sibling is another code_block → ArrowUp enters the upper block's
        // lang input first (its selector visually sits between the blocks).
        if (e.key === "ArrowUp" && $from.parent.type.name === "code_block") {
          const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
          // No newline before cursor → we are on the first line
          if (
            !textBefore.includes("\n") &&
            enterPrevCodeBlockLang(view, state, $from.before())
          ) {
            return true;
          }
        }

        // Case C: cursor at the top edge of a block immediately below a
        // code_block → ArrowUp enters that code_block's lang input.
        // 容器（列表/引用/表格）只在首个文本块第一行触发，避免从容器中间被劫持。
        if (
          e.key === "ArrowUp" &&
          $from.depth >= 1 &&
          $from.parent.type.name !== "code_block"
        ) {
          const blockPos = $from.before(1);
          if (
            isAtTopEdgeOfBlock(state.doc, $from) &&
            enterPrevCodeBlockLang(view, state, blockPos)
          ) {
            return true;
          }
        }
        return false;
      },
    },
  });
}

function makeFencedPlugin(schema: Schema) {
  return leaveLineDraft<{ lang: string }>({
    match: (text) => {
      const m = FENCE_RE.exec(text);
      if (m) return { data: { lang: m[1] ?? "" }, prefixLen: 3 };
      const mathM = MATH_BLOCK_RE.exec(text);
      if (mathM) return { data: { lang: "latex" }, prefixLen: 2 };
      return null;
    },
    draftClass: () => "fenced-code-draft",
    commit: (tr, pos, paragraph, data) => {
      const codeBlock = schema.nodes.code_block.create({ lang: data.lang }, null);
      tr.replaceWith(pos, pos + paragraph.nodeSize, codeBlock);
    },
  });
}

function selectionWatcherPlugin(): Plugin {
  const selKey = new PluginKey("codeBlockSelectionWatcher");
  return new Plugin({
    key: selKey,
    view: () => ({
      update: (view, prevState) => {
        const prevSel = prevState.selection;
        const curSel = view.state.selection;
        if (prevSel.from !== curSel.from || prevSel.to !== curSel.to) {
          CodeBlockView.notifySelectionChange();
        }
      },
    }),
  });
}

export const fencedCode: FeatureSpec = {
  name: "code_block",

  plugins: (schema) => [
    makeFencedPlugin(schema).plugin,
    hljsHighlightPlugin,
    fencedCodeChromePlugin(),
    selectionWatcherPlugin(),
  ],

  keymap: (schema) => ({
    Enter: (state, dispatch) => {
      const sel = state.selection;
      if (!sel.empty) return false;
      const $from = sel.$from;
      const para = $from.parent;
      if (para.type.name !== "paragraph") return false;
      const text = para.textContent;
      const m = FENCE_RE.exec(text);
      const mathM = MATH_BLOCK_RE.exec(text);
      if (!m && !mathM) return false;
      if (dispatch) {
        const lang = m ? (m[1] ?? "") : "latex";
        const pos = $from.before();
        const codeBlock = schema.nodes.code_block.create({ lang }, null);
        const tr = state.tr.replaceWith(pos, pos + para.nodeSize, codeBlock);
        tr.setSelection(TextSelection.create(tr.doc, pos + 1));
        dispatch(tr);
      }
      return true;
    },

    Backspace: (state, dispatch) => {
      const sel = state.selection;
      if (!sel.empty) return false;
      const $from = sel.$from;
      if ($from.parent.type.name !== "code_block") return false;
      if ($from.parent.content.size > 0) return false;
      if (dispatch) {
        const pos = $from.before();
        const size = $from.parent.nodeSize;
        const tr = state.tr.delete(pos, pos + size);
        if (tr.doc.content.size === 0) {
          const p = schema.nodes.paragraph.createAndFill();
          if (p) tr.insert(0, p);
        }
        dispatch(tr);
      }
      return true;
    },
  }),

};
