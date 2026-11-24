import type { Mark, Node as PMNode } from "prosemirror-model";
import type {
  SerializerMarkSpec as MarkSpec,
  SerializerState as SerializerStateApi,
} from "@texto/markdown-editor-runtime";

import {
  collectBlockHandlers,
  collectInlineFeatures,
  collectInlineNodeHandlers,
  collectMarkDelims,
  runFeatureStep,
} from "./features/index.ts";
import { getSchema } from "./schema.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Configurable surface: mark delimiters and character escaping. md and pretty
// share the block-level walk and only diverge at these two points.
// ─────────────────────────────────────────────────────────────────────────────

export type { BlockHandler } from "@texto/markdown-editor-runtime";
export type { SerializerMarkSpec as MarkSpec } from "@texto/markdown-editor-runtime";

export type SerializerConfig = {
  marks: Record<string, MarkSpec>;
  escapeInline: (ch: string) => string;
  escapeBlockStart: (ch: string) => string;
  // Whether the code mark emits via a dynamic backtick fence (md behaviour).
  // When false, the code mark goes through the regular open/close channel.
  codeMarkAsBacktickFence: boolean;
};

// md configuration
// The textblock already holds its source form (escapes included), so canonical
// serialization must not re-escape — doing so would break
// `parse(serialize(doc)) === doc` now that escapes survive the parse.
const mdEscapeInline = (ch: string): string => ch;
const mdEscapeBlockStart = (ch: string): string => ch;

const coreMdMarks: Record<string, MarkSpec> = {};

// Built on first use rather than at module scope: collectMarkDelims() reads the
// feature registry, which merges plugin contributions lazily during startup.
// Building it eagerly would freeze that cache before plugins register.
let _mdConfig: SerializerConfig | undefined;

export function getMdConfig(): SerializerConfig {
  return (_mdConfig ??= {
    marks: { ...coreMdMarks, ...collectMarkDelims() },
    escapeInline: mdEscapeInline,
    escapeBlockStart: mdEscapeBlockStart,
    // Under method-B the `` ` `` delim chars live in the textblock text, so
    // the standard mark-open/close channel (with empty code markDelims) plus
    // the extRanges no-escape is enough. The backtick-fence path stays in
    // the code for potential non-md consumers that set it back to true.
    codeMarkAsBacktickFence: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Position markers: inject a character at a PM position. `side` picks which
// boundary of a mark we fire at:
//   inner → after mark open / before mark close / block edges / before each char
//           (used by the cursor — prefers to render just outside mark tags)
//   outer → before mark open / after mark close
//           (used by decoration gray-delim hints)
// ─────────────────────────────────────────────────────────────────────────────

export type PosMarker = { pos: number; char: string; side?: "inner" | "outer" };

type InternalMarker = PosMarker & { side: "inner" | "outer"; done: boolean };

// ─────────────────────────────────────────────────────────────────────────────

export class SerializerState implements SerializerStateApi {
  out = "";
  delim = "";
  closed: PMNode | null = null;

  pmPos = 0;
  markers: InternalMarker[];
  config: SerializerConfig;

  /** 最近一次内部追加后的 out 长度 / 尾字符。
   *
   *  `atBlankLine()` 在序列化每个文本块/内联节点时都会调用。直接对不断增长的
   *  `out` 做 `endsWith("\n")` 会让 V8 反复把 rope 字符串拍平：全文序列化
   *  从 O(n) 退化为 O(n²)（600KB 实测 1.3s）。内部追加都走 `append()` 维护
   *  尾字符缓存；插件仍可直接写 `out`，长度不一致时回退读取一次并重新同步。 */
  private appendedLength = 0;
  private lastChar = "";

  /** 可选：每个 block 序列化开始时回调（node, pmPos, 当前已输出 md 前缀）。
   *  供一次性遍历收集各块的行号/偏移（避免为每个块重复整篇序列化）。 */
  onBlock: ((node: PMNode, pmPos: number, out: string) => void) | null = null;
  /** 可选：列表项渲染完成回调（仅当前列表的直接 item；嵌套列表项不触发）。
   *  start = 该项内容开始输出前的 out 长度，便于按项切分 canonical 文本。 */
  onListItem: ((item: PMNode, out: string, start: number) => void) | null = null;
  /** 可选：引用块直接子块渲染完成回调（嵌套引用不触发）。 */
  onQuoteChild: ((child: PMNode, out: string, start: number) => void) | null = null;

  listDepth = 0;
  quoteDepth = 0;

  constructor(config: SerializerConfig, markers: readonly PosMarker[] = []) {
    this.config = config;
    this.markers = markers.map((m) => ({ ...m, side: m.side ?? "inner", done: false }));
  }

  tick(side: "inner" | "outer"): void {
    for (const m of this.markers) {
      if (!m.done && m.side === side && m.pos === this.pmPos) {
        this.append(m.char);
        m.done = true;
      }
    }
  }

  advance(n: number): void {
    this.pmPos += n;
  }

  /** 追加输出并维护 O(1) 的尾字符缓存（见 appendedLength 注释）。 */
  append(text: string): void {
    if (!text) return;
    this.out += text;
    this.appendedLength = this.out.length;
    this.lastChar = text[text.length - 1]!;
  }

  atBlankLine(): boolean {
    if (this.out.length !== this.appendedLength) {
      // 插件直接写了 out（state.out += ...）：重新同步一次尾字符。
      this.appendedLength = this.out.length;
      this.lastChar = this.out.length > 0 ? this.out[this.out.length - 1]! : "";
    }
    return this.lastChar === "" || this.lastChar === "\n";
  }

  flushClose(tight = false): void {
    if (!this.closed) return;
    if (!this.atBlankLine()) this.append("\n");
    if (!tight) {
      const trimmed = this.delim.replace(/\s+$/, "");
      this.append(trimmed + "\n");
    }
    this.closed = null;
  }

  write(content = ""): void {
    this.flushClose();
    if (this.delim && this.atBlankLine()) this.append(this.delim);
    if (content) this.append(content);
  }

  closeBlock(node: PMNode): void {
    this.closed = node;
  }

  wrapBlock(delim: string, firstDelim: string | null, node: PMNode, f: () => void): void {
    const old = this.delim;
    this.write(firstDelim ?? delim);
    this.delim += delim;
    f();
    this.delim = old;
    this.closeBlock(node);
  }

  renderDoc(doc: PMNode): void {
    doc.forEach((child) => this.renderBlock(child));
  }

  renderBlock(node: PMNode): void {
    this.advance(1);
    const handler = getBlockHandlers()[node.type.name];
    if (!handler) throw new Error(`serializer: no handler for <${node.type.name}>`);
    // 插件/功能块级 handler 抛错时只跳过该块，避免整篇序列化中断。
    runFeatureStep(`block handler for <${node.type.name}>`, () => handler(this, node));
    this.advance(1);
    this.onBlock?.(node, this.pmPos, this.out);
  }

  renderBlockChildren(parent: PMNode): void {
    this.tick("inner"); // A
    parent.forEach((child) => this.renderBlock(child));
    this.tick("inner"); // E
  }

  // list_item 内容要求 `paragraph block*`，而 markdown-it 对 `- <div>` 这类
  // 「块级内容直接跟列表项」会产出无段落的 item，createAndFill 会注入一个空首段。
  // 序列化时跳过它——否则空段关闭时产生多余空行，reparse 会终结列表。
  renderListItemChildren(item: PMNode): void {
    const first = item.firstChild;
    const second = item.childCount > 1 ? item.child(1) : null;
    const skipLeadingEmpty =
      first?.type.name === "paragraph" &&
      first.childCount === 0 &&
      second !== null &&
      second.type.name !== "paragraph";
    if (skipLeadingEmpty) {
      this.tick("inner"); // A
      item.forEach((child, _offset, index) => {
        if (index === 0) return;
        this.renderBlock(child);
      });
      this.tick("inner"); // E
    } else {
      this.renderBlockChildren(item);
    }
  }

  renderInline(parent: PMNode): void {
    const schema = getSchema();
    this.tick("inner"); // A
    let active: readonly Mark[] = [];
    const marks = this.config.marks;

    // Under method-B, each inline feature declares which char ranges are
    // its source delim + content (extRanges). Inside these ranges the text
    // already encodes md, so backslash escape must be suppressed.
    const extRanges = extRangesFor(parent);
    let blockOffset = 0;
    const insideEmStrong = (o: number): boolean => {
      for (const [a, b] of extRanges) if (o >= a && o < b) return true;
      return false;
    };

    // We deliberately do not fire "inner" ticks during mark transitions —
    // the cursor only fires at A/B/E (block edges or text chars). That keeps
    // a cursor exactly on a mark boundary on the visual outside of the mark,
    // matching Typora's behaviour.
    const closeMarks = (next: readonly Mark[]): void => {
      while (active.length > 0) {
        const innermost = active[active.length - 1]!;
        if (next.some((m) => m.eq(innermost))) break;
        const sp = marks[innermost.type.name];
        if (sp) this.append(typeof sp.close === "function" ? sp.close(innermost) : sp.close);
        active = active.slice(0, -1);
        this.tick("outer"); // D_post: after close delim — gray close fires here
      }
    };
    const openMarks = (next: readonly Mark[], forNode: PMNode): void => {
      for (const mark of next) {
        if (active.some((m) => m.eq(mark))) continue;
        this.tick("outer"); // C_pre: before open delim — gray open fires here
        const sp = marks[mark.type.name];
        if (sp) this.append(typeof sp.open === "function" ? sp.open(forNode) : sp.open);
        active = [...active, mark];
      }
    };

    parent.forEach((child) => {
      // In md, the code mark wraps the text with a dynamic backtick fence
      // rather than going through the standard mark open/close channel.
      const codeMark = child.marks.find((m) => m.type === schema.marks.code);
      if (codeMark && this.config.codeMarkAsBacktickFence) {
        closeMarks([]);
        this.write();
        const content = child.text ?? "";
        const runs: string[] = content.match(/`+/g) ?? [];
        const fenceLen = runs.reduce((max, r) => Math.max(max, r.length), 0) + 1;
        const fence = "`".repeat(fenceLen);
        const pad = content.startsWith("`") || content.endsWith("`") ? " " : "";
        this.append(fence + pad);
        this.tick("inner");
        for (const ch of content) {
          this.tick("inner");
          this.append(ch);
          this.advance(1);
          blockOffset++;
        }
        this.tick("inner");
        this.append(pad + fence);
        return;
      }

      // Feature-contributed inline atom nodes (e.g. task_marker) — they
      // serialize to a fixed text shape and don't carry marks.
      const inlineHandler = getInlineNodeHandlers()[child.type.name];
      if (inlineHandler) {
        closeMarks([]);
        this.write();
        runFeatureStep(`inline handler for <${child.type.name}>`, () =>
          inlineHandler(this, child),
        );
        // Atom nodes occupy 1 position in the textblock; track block offset.
        blockOffset += child.nodeSize;
        return;
      }

      if (child.type === schema.nodes.hard_break) {
        closeMarks([]);
        this.write();
        this.tick("inner");
        this.append("  \n");
        if (this.delim) this.append(this.delim);
        this.advance(1);
        return; // hard_break doesn't contribute to textContent offsets
      }

      if (!child.isText) return;

      closeMarks(child.marks);
      this.write();
      openMarks(child.marks, child);

      const raw = child.text ?? "";
      const atBlockStart = this.atBlankLine() && active.length === 0;
      let sawNonNewline = false;
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i]!;
        this.tick("inner");
        if (ch === "\n") {
          this.append("\n");
          if (this.delim) this.append(this.delim);
        } else if (insideEmStrong(blockOffset)) {
          this.append(ch); // raw — char already encodes md source
          sawNonNewline = true;
        } else {
          const needBlockEsc = atBlockStart && !sawNonNewline;
          const isIntraWordUnderscore =
            ch === "_" &&
            /[A-Za-z0-9]/.test(i > 0 ? raw[i - 1]! : " ") &&
            /[A-Za-z0-9]/.test(i < raw.length - 1 ? raw[i + 1]! : " ");
          this.append(isIntraWordUnderscore
            ? ch
            : needBlockEsc
              ? this.config.escapeBlockStart(ch)
              : this.config.escapeInline(ch));
          sawNonNewline = true;
        }
        blockOffset++;
        this.advance(1);
      }
    });

    closeMarks([]);
    this.tick("inner"); // E
  }
}

// extRanges 只依赖文本块节点本身（各特性的纯函数），而 ProseMirror 的结构
// 共享让「未改动的块」在连续两次序列化之间是同一个节点实例。按节点身份缓存
// 后，一次按键只为本轮真正改动的块重算 extRanges，其余块零成本命中——
// 大文档每键的整篇序列化是输入延迟的主要成分之一。
let extRangesCache = new WeakMap<PMNode, Array<[number, number]>>();

function extRangesFor(parent: PMNode): Array<[number, number]> {
  const cached = extRangesCache.get(parent);
  if (cached) return cached;
  const ranges = collectInlineFeatures().flatMap((f) => f.extRanges(parent));
  extRangesCache.set(parent, ranges);
  return ranges;
}

// ─────────────────────────────────────────────────────────────────────────────

// Core handlers drive the full SerializerState class (orchestration helpers
// like wrapBlock/renderBlock that are deliberately outside the plugin-facing
// `BlockHandler` contract). Feature/plugin handlers use the narrower type.
type CoreBlockHandler = (state: SerializerState, node: PMNode) => void;

const coreBlockHandlers: Record<string, CoreBlockHandler> = {
  paragraph: (state, node) => {
    state.renderInline(node);
    state.closeBlock(node);
  },

  heading: (state, node) => {
    const level = node.attrs.level as number;
    const style = node.attrs.style as string;
    if (style === "setext" && (level === 1 || level === 2)) {
      // setext: content on one line, underline of `=`/`-` (3 chars,
      // canonical) on the next. Only valid for h1/h2 — higher levels
      // fall through to ATX.
      state.renderInline(node);
      state.write(`\n${level === 1 ? "===" : "---"}`);
      state.closeBlock(node);
      return;
    }
    state.write(`${"#".repeat(level)} `);
    state.renderInline(node);
    state.closeBlock(node);
  },

  blockquote: (state, node) => {
    state.quoteDepth++;
    try {
      state.wrapBlock("> ", null, node, () => {
        // 与 renderBlockChildren 等价的手工遍历，逐子块提供回调起点。
        state.tick("inner"); // A
        node.forEach((child) => {
          const start = state.out.length;
          state.renderBlock(child);
          if (state.quoteDepth === 1) state.onQuoteChild?.(child, state.out, start);
        });
        state.tick("inner"); // E
      });
    } finally {
      state.quoteDepth--;
    }
  },

  code_block: (state, node) => {
    const lang = String(node.attrs.lang ?? "");
    // 如果语言是 latex，使用 math block 格式 $$...$$
    if (lang === "latex") {
      state.write("$$\n");
      for (const ch of node.textContent) {
        if (ch === "\n") {
          state.append("\n");
        } else {
          state.append(ch);
        }
      }
      state.append("\n$$");
      state.closeBlock(node);
      return;
    }
    const fenceChar = String(node.attrs.fence ?? "`") || "`";
    let fenceLen = Number(node.attrs.fenceLen) || 3;
    // 内容若含同字符 run，加长围栏避免提前闭合。
    const runs = (node.textContent.match(new RegExp(`${fenceChar === "`" ? "`" : "~"}+`, "g")) ?? []);
    const longest = runs.reduce((max, r) => Math.max(max, r.length), 0);
    if (longest >= fenceLen) fenceLen = longest + 1;
    const fence = fenceChar.repeat(fenceLen);
    state.write(fence + lang + "\n");
    state.tick("inner");
    // 嵌套（列表项/引用块等）时每行内容与闭合围栏都要带当前 delim 缩进，
    // 否则 markdown-it 会把顶格行当作块外内容，后续文本被未闭合围栏吞掉。
    let lineStart = true;
    for (const ch of node.textContent) {
      state.tick("inner");
      if (lineStart) {
        if (state.delim) state.append(state.delim);
        lineStart = false;
      }
      state.append(ch);
      if (ch === "\n") lineStart = true;
      state.advance(1);
    }
    state.tick("inner");
    // 解析端裁掉围栏间恰好一个行尾 \n：这里恒补一个换行再写闭合围栏，
    // 使内容以 \n 结尾时（末行为空）也能无损往返。
    state.append("\n");
    if (state.delim) state.append(state.delim);
    state.append(fence);
    state.closeBlock(node);
  },

  horizontal_rule: (state, node) => {
    const variant = String(node.attrs.variant ?? "-") || "-";
    state.write(variant.repeat(3));
    state.closeBlock(node);
  },

  bullet_list: (state, node) => {
    const marker = String((node.attrs.marker as string | undefined) ?? "-");
    state.tick("inner");
    // 如果有 closed 状态，先处理它（添加换行但不添加额外的 delim 行）
    // 然后清除 closed，避免嵌套列表前出现多余空行
    if (state.closed) {
      if (!state.atBlankLine()) {
        state.append("\n");
      }
      state.closed = null;
    }
    state.listDepth++;
    try {
      node.forEach((item, _, i) => {
        if (i > 0) state.flushClose(true);
        const itemStart = state.out.length;
        state.wrapBlock("  ", `${marker} `, item, () => state.renderListItemChildren(item));
        if (state.listDepth === 1) state.onListItem?.(item, state.out, itemStart);
      });
    } finally {
      state.listDepth--;
    }
    state.tick("inner");
  },

  ordered_list: (state, node) => {
    const start = (node.attrs.start as number) ?? 1;
    const maxNum = String(start + node.childCount - 1);
    const pad = maxNum.length;
    state.tick("inner");
    // 如果有 closed 状态，先处理它（添加换行但不添加额外的 delim 行）
    // 然后清除 closed，避免嵌套列表前出现多余空行
    if (state.closed) {
      if (!state.atBlankLine()) {
        state.append("\n");
      }
      state.closed = null;
    }
    state.listDepth++;
    try {
      node.forEach((item, _, i) => {
        if (i > 0) state.flushClose(true);
        const label = String(start + i);
        const delimiter = String(node.attrs.delimiter ?? ".") || ".";
        const padded = `${label}${delimiter} ${" ".repeat(Math.max(0, pad - label.length))}`;
        const delim = " ".repeat(pad + 2);
        const itemStart = state.out.length;
        state.wrapBlock(delim, padded, item, () => state.renderListItemChildren(item));
        if (state.listDepth === 1) state.onListItem?.(item, state.out, itemStart);
      });
    } finally {
      state.listDepth--;
    }
    state.tick("inner");
  },

  list_item: (state, node) => {
    state.renderListItemChildren(node);
  },

};

// Feature-contributed block handlers win over core when names collide (lets
// a feature migrate a core node type wholesale, not yet exercised). The tables
// are built on first serialization so plugin contributions registered during
// startup are included.
let _inlineNodeHandlers: NonNullable<ReturnType<typeof collectInlineNodeHandlers>> | undefined;

function getInlineNodeHandlers(): NonNullable<ReturnType<typeof collectInlineNodeHandlers>> {
  return (_inlineNodeHandlers ??= collectInlineNodeHandlers());
}

let _blockHandlers: Record<string, CoreBlockHandler> | undefined;

function getBlockHandlers(): Record<string, CoreBlockHandler> {
  return (_blockHandlers ??= {
    ...coreBlockHandlers,
    ...collectBlockHandlers(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function serialize(doc: PMNode): string {
  const state = new SerializerState(getMdConfig());
  state.renderDoc(doc);
  return state.out
    .replace(/\u200b/g, "")
    .replace(/\n+$/, "\n");
}

export function serializeWith(
  doc: PMNode,
  config: SerializerConfig,
  markers: readonly PosMarker[] = [],
): string {
  const state = new SerializerState(config, markers);
  state.renderDoc(doc);
  const leftover = state.markers
    .filter((m) => !m.done)
    .map((m) => m.char)
    .join("");
  return state.out.replace(/\u200b/g, "") + leftover;
}

// 单次序列化遍历中收集所有标题的行号（与 doc 中标题的先后顺序一致）。
// 行号语义与 posToLineCol(doc, pos+1).line 一致：标题内容在序列化 md 中
// 所在的行（1 起）。相比"对每个标题各自 posToLineCol"，避免每标题重复
// 整篇序列化导致的 O(n²)（大文档大纲提取可到数百毫秒）。
export function serializeHeadingLines(doc: PMNode): number[] {
  return serializeWithHeadingLines(doc).lines;
}

// 单次序列化同时返回 canonical markdown 与各标题行号，供大纲提取同时
// 计算行号与内容摘要，避免二次序列化。
export function serializeWithHeadingLines(doc: PMNode): { md: string; lines: number[] } {
  const state = new SerializerState(getMdConfig());
  const lines: number[] = [];
  // 行号用增量换行计数：原实现每遇标题就 `out.split("\n")` 一次，标题多时是
  // O(标题数 × 全文)，长文档大纲提取会白花几十毫秒。
  let scanned = 0;
  let lineCount = 1;
  state.onBlock = (node, _pmPos, out) => {
    if (node.type.name !== "heading") return;
    for (let i = scanned; i < out.length; i += 1) {
      if (out.charCodeAt(i) === 10) lineCount += 1;
    }
    scanned = out.length;
    // 当前已输出到标题块的末尾。ATX 标题 `## Foo` 内容与块在同一行；
    // setext 标题 `Foo\n===` 内容下还有一行 `===`/`---` 下划线，需回退一行。
    const isSetext = node.attrs.style === "setext";
    lines.push(lineCount - (isSetext ? 1 : 0));
  };
  state.renderDoc(doc);
  const md = state.out.replace(/\u200b/g, "").replace(/\n+$/, "\n");
  return { md, lines };
}

/** 仅供测试：清空惰性构建的序列化配置与 handler 表。 */
export function resetSerializerForTests(): void {
  _mdConfig = undefined;
  _inlineNodeHandlers = undefined;
  _blockHandlers = undefined;
  extRangesCache = new WeakMap();
}
