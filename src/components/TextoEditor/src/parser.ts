import MarkdownIt from "markdown-it";
import type { RuleInline } from "markdown-it/lib/parser_inline.mjs";
import type Token from "markdown-it/lib/token.mjs";
import {
  Mark,
  type Attrs,
  type MarkType,
  type Node as PMNode,
  type NodeType,
} from "prosemirror-model";
import type { ParserState as ParserStateApi } from "@texto/markdown-editor-runtime";

import {
  collectMdItPluginsNamed,
  collectParserPostProcessorsNamed,
  collectParserTokens,
  runFeatureStep,
} from "./features/index.ts";
import { hardBreakRange, type InlineDerivation } from "./features/inline-derive.ts";
import { assembleLoad } from "./features/load-assemble.ts";
import {
  rememberLoadDerivation,
  sameInlineTokens,
  type LoadDerivation,
} from "./features/load-derivation.ts";
import { parseInlineWith } from "./inline-parse.ts";
import { getSchema } from "./schema.ts";

// Parser construction is deferred to the first parse call. The markdown-it
// instance and the parser-token map both read from the feature registry,
// which merges plugin contributions lazily during startup; building them at
// module scope would freeze that cache before plugins register.
let _md: MarkdownIt | undefined;
let _featureTokens: ReturnType<typeof collectParserTokens> | undefined;

// markdown-it's default `escape` rule drops the backslash (`\*` → text `*`).
// Under method-B the textblock text *is* the source, so dropping it makes the
// escape invisible to both the inline scanners and the serializer: `\*x\*`
// would be re-read as emphasis. This replacement keeps `\X` verbatim in the
// text, while still consuming the pair so markdown-it's own emphasis/link
// rules never treat the escaped char as a delimiter. Hard-break-by-backslash
// behaves as before.
const isInlineSpace = (code: number): boolean => code === 0x20 || code === 0x09;

const escapePreserveBackslash: RuleInline = (state, silent) => {
  let pos = state.pos;
  const max = state.posMax;

  if (state.src.charCodeAt(pos) !== 0x5c /* \ */) return false;
  pos++;
  if (pos >= max) return false;

  let ch1 = state.src.charCodeAt(pos);

  // `\` + newline → hard break (unchanged).
  if (ch1 === 0x0a) {
    if (!silent) state.push("hardbreak", "br", 0);
    pos++;
    while (pos < max) {
      ch1 = state.src.charCodeAt(pos);
      if (!isInlineSpace(ch1)) break;
      pos++;
    }
    state.pos = pos;
    return true;
  }

  let escapedStr = state.src[pos];
  // Keep surrogate pairs together.
  if (ch1 >= 0xd800 && ch1 <= 0xdbff && pos + 1 < max) {
    const ch2 = state.src.charCodeAt(pos + 1);
    if (ch2 >= 0xdc00 && ch2 <= 0xdfff) {
      escapedStr += state.src[pos + 1];
      pos++;
    }
  }

  if (!silent) state.pending += "\\" + escapedStr;
  state.pos = pos + 1;
  return true;
};

// markdown-it's `autolink` rule rewrites the inner text through
// `normalizeLinkText` (decoding `%20`, expanding punycode). Under method-B the
// textblock text *is* the source, so that rewrite would drop characters on save
// (`<http://x.com/a%20b>` → `<http://x.com/a b>`) and desync the locator's
// cursor. This override mirrors the rule but keeps the text token as the raw
// source slice; `href` still uses markdown-it's normalized value (link.ts
// decodes the non-ASCII part back).
const AUTOLINK_URI_RE = /^([a-zA-Z][a-zA-Z0-9+.-]{1,31}):([^<>\x00-\x20]*)$/;
const AUTOLINK_EMAIL_RE =
  /^([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/;

const autolinkPreserveSource: RuleInline = (state, silent) => {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x3c /* < */) return false;

  const max = state.posMax;
  let pos = start;
  for (;;) {
    if (++pos >= max) return false;
    const ch = state.src.charCodeAt(pos);
    if (ch === 0x3c /* < */) return false;
    if (ch === 0x3e /* > */) break;
  }

  const inner = state.src.slice(start + 1, pos);
  const isUri = AUTOLINK_URI_RE.test(inner);
  if (!isUri && !AUTOLINK_EMAIL_RE.test(inner)) return false;

  const href = state.md.normalizeLink(isUri ? inner : `mailto:${inner}`);
  if (!state.md.validateLink(href)) return false;

  if (!silent) {
    const open = state.push("link_open", "a", 1);
    open.attrs = [["href", href]];
    open.markup = "autolink";
    open.info = "auto";

    const text = state.push("text", "", 0);
    text.content = inner; // 源文原文，不做 normalizeLinkText

    const close = state.push("link_close", "a", -1);
    close.markup = "autolink";
    close.info = "auto";
  }

  state.pos += inner.length + 2;
  return true;
};

function getParser(): { md: MarkdownIt; tokens: ReturnType<typeof collectParserTokens> } {
  if (!_md) {
    // 基线关闭 HTML：markdown-it 的 "commonmark" 预设默认 html:true，这里显式
    // 关掉，HTML 支持改由插件经 `mdItPlugins`（`md.set({ html: true })`）开启。
    // 插件未注册时裸 HTML 回落为普通段落文本。
    const md: MarkdownIt = new MarkdownIt("commonmark", { html: false });
    // 保留实体原文：解码会丢位置信息，也会让 `&#42;` 变成真语法（定位层依赖 content === 原文）。
    md.disable("entity");
    // 插件来源的 md-it 插件逐个隔离：某个插件初始化抛错时只跳过它，
    // 不影响其它插件与核心规则。
    for (const { feature, item: plugin } of collectMdItPluginsNamed()) {
      runFeatureStep(`mdItPlugin from "${feature}"`, () => md.use(plugin));
    }

    // Preserve trailing whitespace inside paragraphs.
    //
    // The default paragraph rule does `state.getLines(...).trim()` on the
    // final content, which discards trailing spaces. That breaks lossless
    // round-trip — md text `"[a](url) "` would parse to a doc whose text is
    // `"[a](url)"`, dropping a real source char. We replace the rule with
    // the same logic minus the trim, since the only whitespace we'd want to
    // strip (leading indent, trailing newline) is already handled by
    // `blkIndent` and getLines' `keepLastLF=false`.
    md.block.ruler.at("paragraph", function paragraphPreserveTrailing(state, startLine, endLine) {
      const terminatorRules = state.md.block.ruler.getRules("paragraph");
      const oldParentType = state.parentType;
      let nextLine = startLine + 1;
      state.parentType = "paragraph";

      for (; nextLine < endLine && !state.isEmpty(nextLine); nextLine++) {
        if (state.sCount[nextLine] - state.blkIndent > 3) continue;
        if (state.sCount[nextLine] < 0) continue;
        let terminate = false;
        for (let i = 0; i < terminatorRules.length; i++) {
          if (terminatorRules[i]!(state, nextLine, endLine, true)) {
            terminate = true;
            break;
          }
        }
        if (terminate) break;
      }

      const content = state.getLines(startLine, nextLine, state.blkIndent, false);
      state.line = nextLine;

      state.push("paragraph_open", "p", 1).map = [startLine, state.line];
      const token_i = state.push("inline", "", 0);
      token_i.content = content;
      token_i.map = [startLine, state.line];
      token_i.children = [];
      state.push("paragraph_close", "p", -1);

      state.parentType = oldParentType;
      return true;
    });

    // Keep backslash escapes verbatim in the textblock (see the rule above).
    md.inline.ruler.at("escape", escapePreserveBackslash);

    // md-it 的 `autolink` 规则保留（边界由 CommonMark 规范决定，如 `<foo@bar>`），
    // 但内层文本改为保持源文原文（见上面的覆写）。
    // `commonmark` 预设本就启用该规则；这里显式 enable 只作「核心独占」声明，
    // 防止后续 preset/插件配置变更静默改掉核心行为。
    md.enable("autolink");
    md.inline.ruler.at("autolink", autolinkPreserveSource);

    _md = md;
    _featureTokens = collectParserTokens();
  }
  return { md: _md, tokens: _featureTokens! };
}

type Frame = {
  type: NodeType;
  attrs: Attrs | null;
  content: PMNode[];
  /** 加载期：本文本块的派生结果；closeNode 时按节点登记到 WeakMap。 */
  loadDerivation?: LoadDerivation;
};

export class ParserState implements ParserStateApi {
  private stack: Frame[] = [{ type: getSchema().nodes.doc, attrs: null, content: [] }];
  private marks: readonly Mark[] = Mark.none;

  private top(): Frame {
    return this.stack[this.stack.length - 1]!;
  }

  push(node: PMNode): void {
    this.top().content.push(node);
  }

  addText(text: string): void {
    if (!text) return;
    this.top().content.push(getSchema().text(text, this.marks));
  }

  openMark(mark: Mark): void {
    this.marks = mark.addToSet(this.marks);
  }

  closeMarkType(type: MarkType): void {
    this.marks = this.marks.filter((m) => m.type !== type);
  }

  // Peek the currently-open mark of a given type (so a close-handler can
  // read attrs before closing — link needs href for its close delim).
  topMark(type: MarkType): Mark | undefined {
    return this.marks.find((m) => m.type === type);
  }

  openNode(type: NodeType, attrs: Attrs | null = null): void {
    this.stack.push({ type, attrs, content: [] });
  }

  closeNode(): void {
    const frame = this.stack.pop();
    if (!frame) throw new Error("closeNode: stack underflow");
    const node = frame.type.createAndFill(frame.attrs, frame.content);
    if (!node) throw new Error(`parser: cannot fill <${frame.type.name}>`);
    if (frame.loadDerivation && node.isTextblock) {
      rememberLoadDerivation(node, frame.loadDerivation);
    }
    this.top().content.push(node);
  }

  /** @internal 加载期专用：登记本文本块的派生结果（closeNode 时按节点存入 WeakMap）。 */
  setLoadDerivation(entry: LoadDerivation): void {
    this.top().loadDerivation = entry;
  }

  finish(): PMNode {
    while (this.stack.length > 1) this.closeNode();
    const root = this.stack[0]!;
    const doc = root.type.createAndFill(null, root.content);
    if (!doc) throw new Error("parser: cannot build doc");
    return doc;
  }
}

/**
 * 把加载期组装好的源码文本铺成文本节点（带定位器派生的 mark）与行内原子节点。
 *
 * mark 来源与 normalize 同一条链路（`parseInlineWith`），因此加载后立即带 mark，
 * 不必等首帧 normalize 补齐；扩展语法的 mark 也随之生效。没有 schema mark 的
 * span（例如只做保护/软隐藏的 escape）只影响定位，不落 mark。
 *
 * 加载期已算过同一文本的派生时由调用方直接传入，避免重复 derive。
 */
function pushAssembledInline(
  state: ParserState,
  text: string,
  derivation: InlineDerivation | null = null,
): Pick<InlineDerivation, "spans" | "atoms"> {
  const schema = getSchema();
  const { nodes, marks } = schema;
  const { spans, atoms } = derivation ?? parseInlineWith(text, null);

  const clamp = (n: number): number => Math.max(0, Math.min(n, text.length));
  const cuts = new Set<number>([0, text.length]);
  for (const s of spans) {
    if (!marks[s.type]) continue;
    cuts.add(clamp(s.from));
    cuts.add(clamp(s.to));
  }
  // 原子节点（硬换行）按源文覆盖区间切一刀，便于跳过被它占用的字符。
  const breaks = atoms.map((a) => hardBreakRange(text, a.at));
  for (const r of breaks) {
    cuts.add(clamp(r.from));
    cuts.add(clamp(r.to));
  }
  const points = [...cuts].sort((a, b) => a - b);

  let brk = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i]!;
    const to = points[i + 1]!;
    while (brk < breaks.length && breaks[brk]!.to <= from) brk++;
    const range = breaks[brk];
    // 硬换行的源字符（`  \n` / `\` + 换行）由节点表示，不进文本。
    if (range && range.from <= from && from < range.to) {
      if (from === range.from) state.push(nodes.hard_break.create());
      continue;
    }
    if (to <= from) continue;
    let markSet: readonly Mark[] = Mark.none;
    for (const s of spans) {
      const type = marks[s.type];
      if (!type) continue;
      if (s.from > from || s.to < to) continue;
      markSet = type.create(s.attrs).addToSet(markSet);
    }
    const slice = text.slice(from, to);
    if (slice) state.push(schema.text(slice, markSet));
  }
  return { spans, atoms };
}

function handleBlock(state: ParserState, token: Token): void {
  const schema = getSchema();
  const { nodes } = schema;
  const { tokens } = getParser();
  const fnHandler = tokens[token.type];
  if (fnHandler) { fnHandler(state, token, schema); return; }
  switch (token.type) {
    case "paragraph_open":
      state.openNode(nodes.paragraph);
      return;
    case "paragraph_close":
      state.closeNode();
      return;
    case "heading_open": {
      // markdown-it sets token.markup to "#"/"##"/... for ATX and "="/"-"
      // for setext (lheading). We capture it as a `style` attr so the
      // serializer can emit the same shape on round-trip.
      const markup = token.markup;
      const style = markup === "=" || markup === "-" ? "setext" : "atx";
      state.openNode(nodes.heading, {
        level: Number(token.tag.slice(1)),
        style,
      });
      return;
    }
    case "heading_close":
      state.closeNode();
      return;
    case "blockquote_open":
      state.openNode(nodes.blockquote);
      return;
    case "blockquote_close":
      state.closeNode();
      return;
    case "bullet_list_open":
      state.openNode(nodes.bullet_list, {
        marker: token.markup === "*" || token.markup === "+" ? token.markup : "-",
      });
      return;
    case "bullet_list_close":
      state.closeNode();
      return;
    case "ordered_list_open": {
      const raw = token.attrGet("start");
      state.openNode(nodes.ordered_list, {
        start: raw ? Number(raw) : 1,
        delimiter: token.markup === ")" ? ")" : ".",
      });
      return;
    }
    case "ordered_list_close":
      state.closeNode();
      return;
    case "list_item_open":
      state.openNode(nodes.list_item);
      return;
    case "list_item_close":
      state.closeNode();
      return;
    case "fence": {
      const content = token.content.replace(/\n$/, "");
      const textNodes = content ? [schema.text(content)] : [];
      const markup = String(token.markup ?? "```");
      state.push(
        nodes.code_block.createChecked(
          {
            lang: token.info.trim(),
            fence: markup[0] === "~" ? "~" : "`",
            fenceLen: markup.length || 3,
          },
          textNodes,
        ),
      );
      return;
    }
    case "code_block": {
      const content = token.content.replace(/\n$/, "");
      const textNodes = content ? [schema.text(content)] : [];
      state.push(nodes.code_block.createChecked({ lang: "" }, textNodes));
      return;
    }
    case "hr": {
      const markup = String(token.markup ?? "---");
      state.push(
        nodes.horizontal_rule.create({
          variant: markup[0] === "-" || markup[0] === "*" || markup[0] === "_" ? markup[0] : "-",
        }),
      );
      return;
    }
    case "inline": {
      // 加载路径以**源码**为准：先按原始源码组装文本，再由定位器派生 mark。
      // 旧路径逐 token 走 `parserTokens`，会用 md-it 归一后的 href/title 重拼
      // 闭合段（并把 code span 的填充空格折掉），等于在打开文件时改写用户写法。
      const children = token.children ?? [];
      const load = children.length > 0 ? assembleLoad(children, token.content) : null;
      if (load) {
        // token 派生的分词必须与空 env 重新分词一致，才能拿来铺 mark（否则首帧与
        // normalize 的文本派生不一致）；参考式 canonical 化后文本也变了。两者任一
        // 成立就回退到文本派生。
        const derivation =
          load.reusable && sameInlineTokens(children, parseInlineTokens(load.text))
            ? load.derivation
            : null;

        const used = pushAssembledInline(state, load.text, derivation);
        // 无行内原子时 textContent === load.text，spans 可直接交给 normalize 消费；
        // 有硬换行时源码偏移与 textContent 不一致，故不登记。
        if (used.atoms.length === 0) {
          state.setLoadDerivation({ text: load.text, spans: used.spans });
        }
        return;
      }
      if (import.meta.env.DEV && children.length > 0) {
        console.warn(
          "[parser] inline 源码组装失败，回退逐 token 解析（保留内容但可能规范化写法）",
        );
      }
      for (const child of children) handleInline(state, child);
      return;
    }
    default: {
      const handler = tokens[token.type];
      if (handler) handler(state, token, schema);
      return;
    }
  }
}

function handleInline(state: ParserState, token: Token): void {
  const schema = getSchema();
  const { nodes } = schema;
  const { tokens } = getParser();
  switch (token.type) {
    case "text":
      state.addText(token.content);
      return;
    case "softbreak":
      // Preserve md soft-wrap newlines as "\n" so the serializer round-trips them
      state.addText("\n");
      return;
    case "hardbreak":
      state.push(nodes.hard_break.create());
      return;
    default: {
      const handler = tokens[token.type];
      if (handler) handler(state, token, schema);
      return;
    }
  }
}

export function parse(src: string): PMNode {
  const { md } = getParser();
  const tokens = md.parse(src, {});
  return tokensToPMDoc(tokens);
}

export function parseTokens(src: string): Token[] {
  return getParser().md.parse(src, {});
}

/**
 * 解析一个文本块的内联 token。
 *
 * 走 `md.parseInline`（core 链：normalize → block → inline → text_join），让注册在 core
 * ruler 上的插件规则也能生效（例如后续把 emoji 迁到 markdown-it-emoji 的 core
 * 规则）。注意本实例是 `commonmark` 预设：`linkify` / typographer 等未启用。
 * `env` 原样透传给 md-it；引用式定义等预置上下文由调用方负责。
 */
export function parseInlineTokens(text: string, env: Record<string, unknown> = {}): Token[] {
  const { md } = getParser();
  const tokens = md.parseInline(text, env);
  return tokens.find((token) => token.type === "inline")?.children ?? [];
}

export function tokensToPMDoc(tokens: Token[]): PMNode {
  getParser();
  const state = new ParserState();
  for (const token of tokens) handleBlock(state, token);
  let doc = state.finish();
  // 插件后处理器逐个隔离：某个抛错时保留上一步 doc，继续执行其余后处理器。
  for (const { feature, item: f } of collectParserPostProcessorsNamed()) {
    const next = runFeatureStep(`parserPostProcess from "${feature}"`, () => f(doc));
    if (next) doc = next;
  }
  return doc;
}

export function tokensToPMNodes(tokens: Token[]): PMNode[] {
  getParser();
  const state = new ParserState();
  for (const token of tokens) handleBlock(state, token);
  const finished = state.finish();
  const nodes: PMNode[] = [];
  finished.forEach((child) => nodes.push(child));
  return nodes;
}

/** 仅供测试：清空惰性构建的 markdown-it 实例与 parser token 表。 */
export function resetParserForTests(): void {
  _md = undefined;
  _featureTokens = undefined;
}
