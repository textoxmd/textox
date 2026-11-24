// Inline locator: map markdown-it inline tokens back to source char ranges.
//
// markdown-it owns inline *semantics*; this module owns *positions*. It walks
// the raw token list and threads a cursor over the source text, emitting
// `InlineSpan`s the normalize / parse layers consume.
//
// Tokens owned by features still advance the cursor (their source shapes are
// known via `tokenAdvance` / markup) but emit no span; features receive the
// positioned tokens and claim the ranges they own in `derive`.

import type { Attrs, Node as PMNode } from "prosemirror-model";
import type Token from "markdown-it/lib/token.mjs";

import type {
  InlineDeriveFeature,
  PositionedToken,
  TokenAdvance,
} from "@texto/markdown-editor-runtime";

import { markConsumed, type InlineSpan } from "../inline-parse.ts";
import { parseInlineTokens } from "../parser.ts";
import { ESCAPABLE_PUNCTUATION } from "./escapable.ts";
import { decorateImageSpan } from "./image-load-status.ts";
import { decodeNonAscii } from "./url.ts";

export type InlineAtom = { at: number; node: "hard_break" };

export type InlineDerivation = {
  spans: InlineSpan[];
  atoms: InlineAtom[];
  /** md-it 派生结果写入的占用位图，供扩展扫描器避让。 */
  consumed: Uint8Array;
  /**
   * 每个 token 的源文区间，按 `(pos, end)` 升序。
   * 容器的子 token 落在容器区间内部（如图片 alt），因此不是互不重叠的序列；
   * 同 `pos` 时按 `end` 升序。
   *
   * `exact` 只表示游标在该 token 上推进过，不保证区间经过严格核对；
   * `verified` 表示位置未走猜测兜底（见 `PositionedToken`）。
   */
  positioned: PositionedToken[];
};

type OpenMark = { name: string; attrs: Attrs | null; openFrom: number; openTo: number };

type CoreMarkPair = { open: string; close: string; mark: string };

/** 核心 mark 的 token 对。 */
const CORE_MARK_PAIRS: readonly CoreMarkPair[] = [
  { open: "em_open", close: "em_close", mark: "em" },
  { open: "strong_open", close: "strong_close", mark: "strong" },
  { open: "s_open", close: "s_close", mark: "strike" },
];

/** 从 `from` 起找第一个长度恰为 `len` 的反引号 run（code span 的闭合围栏）。 */
export function findFence(text: string, from: number, len: number): number {
  let i = from;
  while (i < text.length) {
    if (text[i] !== "`") { i++; continue; }
    let j = i;
    while (j < text.length && text[j] === "`") j++;
    if (j - i === len) return i;
    i = j;
  }
  return -1;
}

/** `at` 指向 `]`：跳过 `]`，若紧跟 `[...]` 则跳到其 `]` 之后（参考式/折叠式）。 */
export function skipBracketTail(text: string, at: number): number {
  let i = at;
  if (text[i] !== "]") return i + 1;
  i++;
  if (text[i] === "[") {
    const end = text.indexOf("]", i + 1);
    return end < 0 ? i : end + 1;
  }
  return i;
}

/**
 * 未登记 token 的源文推进量（0 表示形状无法核对）。定位层不持有这些构造的
 * 标识，只按 token 自述的源文形状跳过源码，且不占用任何字符，语义归登记它们
 * 的一方。四种形状：
 *
 * - 成对开放/关闭：`nesting ≠ 0`、markup 非空、content 为空 —— md-it 的惯例是
 *   成对 token（`nesting ±1`）只带分隔符 markup，内容由后续兄弟 token 承载，
 *   故这里只跳过 markup 本身；
 * - 成对围栏：`markup + content + markup`（如 `$…$` / `$$…$$`）；
 * - 纯文本：markup 为空，content 即源码原文；
 * - 引用型：markup / content 皆空，源码为 `[^…]`。当前 parser 为空 env，
 *   该形状不可达，保留它纯属防御性（后续注入 env 时可复用）。
 */
export function unownedAdvance(text: string, pos: number, tok: Token): number {
  const { markup, content } = tok;
  // 成对 token（nesting ±1）在 md-it 里 markup 与内容是分开的 token：
  // 未登记时只跳过 markup 本身，内容由后续 token 继续推进。content 非空说明
  // 并非该惯例形状，留给下方围栏路径整段核对（避免游标静默偏移）。
  if (tok.nesting !== 0 && markup && !content) {
    return text.startsWith(markup, pos) ? markup.length : 0;
  }
  if (markup) {
    const contentFrom = pos + markup.length;
    if (
      !content ||
      !text.startsWith(markup, pos) ||
      !text.startsWith(content, contentFrom)
    ) {
      return 0;
    }
    const closeFrom = contentFrom + content.length;
    return text.startsWith(markup, closeFrom) ? closeFrom + markup.length - pos : 0;
  }
  // 自述「content 即原文」的未登记 token：只认前缀。已反转义内容的 token
  // 归 textAdvance 管（见其注释），这里返回 0 表示形状无法核对。
  if (content) return text.startsWith(content, pos) ? content.length : 0;
  if (text[pos] === "[" && text[pos + 1] === "^") {
    const end = text.indexOf("]", pos + 2);
    return end < 0 ? 0 : end + 1 - pos;
  }
  return 0;
}

/**
 * 单个 token 的源码宽度：先问插件声明（首个有效值生效），再按 token 形状推断。
 *
 * 声明返回 `null`、`<= 0`、非整数、非有限值或推进后越过源文末端 ⇒ 视为无效并
 * 继续下一个声明；声明抛错 ⇒ 忽略该声明并 DEV 告警一次（与其它插件调用点的隔离
 * 策略一致）。返回 0 表示无法核对形状（调用方应放弃或告警，不得猜长度）。
 */
export function advanceForToken(
  text: string,
  pos: number,
  tok: Token,
  declarations: readonly TokenAdvance[] = [],
): number {
  for (const fn of declarations) {
    let advance: number | null;
    try {
      advance = fn(text, pos, tok);
    } catch (err) {
      warnSpanOnce(
        `tokenAdvance:${tok.type}`,
        `[inline-derive] tokenAdvance 抛错（token "${tok.type}"），已忽略`,
        err,
      );
      continue;
    }
    // Number.isSafeInteger 同时排除 NaN / ±Infinity / 小数 / 超出安全整数的值
    // （`1e21` 这类值一旦相加会让游标越过源文末端）；null 由前一项判空拦下。
    // 上界校验：推进后越过源文末端同样视为无效（否则游标会漂到 text 之外）。
    if (
      advance !== null &&
      Number.isSafeInteger(advance) &&
      advance > 0 &&
      pos + advance <= text.length
    ) {
      return advance;
    }
  }
  return unownedAdvance(text, pos, tok);
}

// 反转义集合 = CommonMark 标点 + 空格（md-it 的 sub/sup 规则会把内容里的 `\X`
// 反转义，其 UNESCAPE_RE 比 CommonMark 多一个空格）。与 `escape.ts` 共用标点集合。
const MD_UNESCAPE_SET = new Set(ESCAPABLE_PUNCTUATION + " ");

/**
 * 按 `\X` 逐步比对源码与反转义后的内容；对不上返回 -1。
 */
function escapeAwareAdvance(text: string, pos: number, content: string): number {
  let i = pos;
  let j = 0;
  while (j < content.length) {
    const ch = text[i];
    if (ch === undefined) return -1;
    if (ch === "\\" && i + 1 < text.length && MD_UNESCAPE_SET.has(text[i + 1]!)) {
      if (text[i + 1] !== content[j]) return -1;
      i += 2;
      j += 1;
      continue;
    }
    if (ch !== content[j]) return -1;
    i += 1;
    j += 1;
  }
  return i - pos;
}

/**
 * 一个 text token 覆盖的源码跨度；无法对齐返回 -1。
 *
 * 先按转义重走：`markdown-it-sub` / `markdown-it-sup` 的 content 已反转义，
 * 且 `\\` 会让 content 成为源文的短前缀（`~a\\~` 的 content 是 `a\`），不能
 * 先做前缀比较。走不通再退回「content 即源码原文」——含字面 `\ ` 的 raw
 * token 只能靠这条（慢路径会把它当成转义）。
 */
export function textAdvance(text: string, pos: number, content: string): number {
  const escaped = escapeAwareAdvance(text, pos, content);
  if (escaped >= 0) return escaped;
  return text.startsWith(content, pos) ? content.length : -1;
}

/**
 * `pos` 指向软换行前的行尾：跨过行尾空格 + 换行 + 下一行行首空白，返回推进量。
 *
 * md-it 的 newline 规则把行尾单个空格从 text token 里剥掉（2+ 空格才是
 * hardbreak），随后跳过下一行行首的空格/制表符，定位层与加载期组装都必须跟进。
 */
export function softbreakAdvance(text: string, pos: number): number {
  let i = pos;
  while (i < text.length && text[i] === " ") i++;
  i += 1; // 换行
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
  return i - pos;
}

/**
 * `pos` 指向硬换行起点：返回源文覆盖区间（`\\`+换行，或行尾空白+换行，
 * 再含下一行行首空白）。调用方据此跳过源字符并插入 `hard_break` 节点。
 */
export function hardBreakRange(text: string, pos: number): { from: number; to: number } {
  let i = pos;
  if (text[i] === "\\") {
    i += 2; // `\` + 换行
  } else {
    while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
    i += 1; // 换行
  }
  // 下一行行首空白归硬换行所有
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
  return { from: pos, to: Math.min(i, text.length) };
}

/** `at` 指向 `(`，消费 `(目标[ 标题])`；返回 `)` 之后的位置，失败返回 -1。 */
export function findDestEnd(text: string, at: number): number {
  let i = at + 1;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  if (text[i] === "<") {
    // 与 md-it 的 parse_link_destination 一致：`\X` 跳过两字符，`<`/换行非法。
    i++;
    let end = -1;
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === "\n" || ch === "<") return -1;
      if (ch === ">") { end = i; break; }
      if (ch === "\\" && i + 1 < text.length) { i += 2; continue; }
      i++;
    }
    if (end < 0) return -1;
    i = end + 1;
  } else {
    // 目标内允许配平圆括号；反斜杠转义整体跳过。
    let depth = 0;
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === "\\") { i += 2; continue; }
      if (ch === "(") { depth++; i++; continue; }
      if (ch === ")") {
        if (depth === 0) break;
        depth--;
        i++;
        continue;
      }
      if (depth === 0 && /\s/.test(ch)) break;
      i++;
    }
  }
  while (i < text.length && /\s/.test(text[i]!)) i++;
  // 标题：`"..."` / `'...'` / `(...)`。
  const q = text[i];
  if (q === '"' || q === "'") {
    i++;
    while (i < text.length && text[i] !== q) {
      if (text[i] === "\\") i++;
      i++;
    }
    i++;
    while (i < text.length && /\s/.test(text[i]!)) i++;
  } else if (q === "(") {
    let depth = 0;
    while (i < text.length) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") {
        if (depth === 0) break;
        depth--;
      }
      i++;
    }
    while (i < text.length && /\s/.test(text[i]!)) i++;
  }
  return text[i] === ")" ? i + 1 : -1;
}

/**
 * 插件产出的元素是否是「看起来像 span」的对象：只做最小的形状检查，
 * 让排序（特性内读 `openFrom` / `closeTo` / `type`；归并时读 `closeFrom`，
 * 已由 `isWellFormedSpan` 保证是整数）不会在垃圾元素上抛错。
 */
function isSpanLike(value: unknown): value is InlineSpan {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/**
 * v2 span 的形态校验：只要求有序不变式，不要求 `openFrom` 落在某个 token 上
 * （derive 自己定位，可能不从一个游标起点开始）。
 */
function isWellFormedSpan(span: InlineSpan, textLength: number): boolean {
  const nums = [span.openFrom, span.openTo, span.from, span.to, span.closeFrom, span.closeTo];
  if (!nums.every((n) => Number.isInteger(n))) return false;
  return (
    span.openFrom >= 0 &&
    span.openFrom <= span.openTo &&
    span.openTo <= span.from &&
    span.from <= span.to &&
    span.to <= span.closeFrom &&
    span.closeFrom <= span.closeTo &&
    span.closeTo <= textLength
  );
}

/**
 * 冲突检查（guard）用的区间：span 只在这些区间内与已认领字符比对。
 *
 * - `opaque`：内容不透明，已认领的内容也算冲突（不允许包住已有 span）；
 * - `wrap` 与普通 mark：只看分隔符，允许内容里已有嵌套 span（`<u>**b**</u>`）；
 * - 其余（原子 / 容器）：整段检查。
 *
 * 零宽分隔符的 mark（既无 open 也无 close，如 `span(2, 5)` 这类纯内容标记）
 * 没有可检查的标记，语义上等同原子 span：整段检查，否则同一区间可被任意多个
 * 特性重复认领。
 *
 * 完全零宽的 span（openFrom === closeTo）不占任何字符，故不与已认领区间
 * 冲突；若两个特性在同一位置各产一个零宽 widget，二者都会保留。
 */
function guardRanges(span: InlineSpan, markNames: readonly string[]): Array<[number, number]> {
  if (span.opaque) return [[span.openFrom, span.closeTo]];
  if (span.wrap || markNames.includes(span.type)) {
    const delimiters = (
      [
        [span.openFrom, span.openTo],
        [span.closeFrom, span.closeTo],
      ] as Array<[number, number]>
    ).filter(([from, to]) => to > from);
    if (delimiters.length) return delimiters;
  }
  return [[span.openFrom, span.closeTo]];
}

/**
 * 记账（consume）用的区间：span 实际占住哪些字符，后续特性不得再认领。
 *
 * - `opaque` / `wrap`：整段占用（内容整体不再解析；`wrap` 的差别只在 guard）；
 * - 普通 mark：只占分隔符；
 * - 原子 / 容器：整段占用。
 *
 * 与 guard 一样：零宽分隔符的 mark 没有可记账的标记 ⇒ 整段占用（否则同一区间
 * 可被任意多个特性重复认领）。
 */
function consumeRanges(span: InlineSpan, markNames: readonly string[]): Array<[number, number]> {
  if (span.opaque || span.wrap) return [[span.openFrom, span.closeTo]];
  if (markNames.includes(span.type)) {
    const delimiters = (
      [
        [span.openFrom, span.openTo],
        [span.closeFrom, span.closeTo],
      ] as Array<[number, number]>
    ).filter(([from, to]) => to > from);
    if (delimiters.length) return delimiters;
  }
  return [[span.openFrom, span.closeTo]];
}

function isRangeConsumed(consumed: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (consumed[i]) return true;
  return false;
}

const warnedSpanIssues = new Set<string>();

function warnSpanOnce(key: string, message: string, detail?: unknown): void {
  if (!import.meta.env.DEV || warnedSpanIssues.has(key)) return;
  warnedSpanIssues.add(key);
  if (detail === undefined) console.warn(message);
  else console.warn(message, detail);
}

/** 仅测试：清空 span 构建告警的去重记录。 */
export function resetInlineDeriveWarningsForTests(): void {
  warnedSpanIssues.clear();
}

export type DeriveInput = {
  tokenAdvances?: readonly TokenAdvance[];
  features?: readonly InlineDeriveFeature[];
  parentBlock?: PMNode | null;
  /**
   * 已有的 inline children token（通常来自 `md.parse`，自带 env）。
   * 给了就不再重新解析：token 对象与 env 与调用方保持一致。
   */
  tokens?: readonly Token[];
};

let deriveCalls = 0;

/** 仅测试：重置 derive 调用计数。 */
export function resetDeriveCallCountForTests(): void {
  deriveCalls = 0;
}

/** 仅测试：derive 被调用的次数（用于验证加载期只派生一次）。 */
export function deriveCallCountForTests(): number {
  return deriveCalls;
}

export function deriveInline(text: string, input: DeriveInput = {}): InlineDerivation {
  if (import.meta.env.DEV) deriveCalls += 1;
  const {
    tokenAdvances = [],
    features = [],
    parentBlock = null,
    tokens,
  } = input;
  const spans: InlineSpan[] = [];
  // v2 派生阶段的 span 先单独收集，最后与核心 span 按闭合序归并
  // （核心 span 在 walk 里按 close 顺序产出）。
  const derivedSpans: InlineSpan[] = [];
  const atoms: InlineAtom[] = [];
  const consumed = new Uint8Array(text.length);
  const stack: OpenMark[] = [];
  let pos = 0;
  const positioned: PositionedToken[] = [];

  const openPairs = new Map<string, CoreMarkPair>();
  const closePairs = new Map<string, CoreMarkPair>();
  for (const pair of CORE_MARK_PAIRS) {
    openPairs.set(pair.open, pair);
    closePairs.set(pair.close, pair);
  }

  const closeMark = (closeFrom: number, closeTo: number, expected?: string): void => {
    const open = stack.pop();
    if (!open) return;
    if (expected && open.name !== expected && import.meta.env.DEV) {
      console.warn(
        `[inline-derive] mark 栈顶 "${open.name}" 与关闭 token 的 "${expected}" 不匹配`,
      );
    }
    const span: InlineSpan = {
      type: open.name,
      from: open.openTo,
      to: closeFrom,
      openFrom: open.openFrom,
      openTo: open.openTo,
      closeFrom,
      closeTo,
      ...(open.attrs ? { attrs: open.attrs } : {}),
    };
    // 空文本链接若按常规隐藏分隔符会整体消失（无法再次插入/编辑），
    // 故覆盖分隔符布局：目标以可见链接样式呈现。
    if (open.name === "link" && span.from === span.to) {
      const href = String(open.attrs?.href ?? "");
      const title = (open.attrs?.title ?? null) as string | null;
      if (href === "" || title !== null) {
        // `[]()` / `[](u "t")`：两侧分隔符全可见。
        span.delimRanges = [
          { from: open.openFrom, to: open.openTo, forceVisible: true },
          { from: closeFrom, to: closeTo, forceVisible: true },
        ];
      } else {
        // `[](url)`：闭合段围绕目标拆开，目标自身作为可见链接文本。
        const hrefStart = closeFrom + 2; // after `](`
        const hrefEnd = closeTo - 1; // before `)`
        span.delimRanges = [
          { from: open.openFrom, to: open.openTo, forceVisible: true },
          { from: closeFrom, to: hrefStart, forceVisible: true },
          { from: hrefEnd, to: closeTo, forceVisible: true },
        ];
        span.extraDecorations = [
          { from: hrefStart, to: hrefEnd, nodeName: "a", attrs: { "data-href": href } },
        ];
      }
    }
    spans.push(span);
  };

  const walk = (list: readonly Token[]): void => {
    for (const tok of list) {
      const start = pos;
      // 位置是否经过严格核对：走「核对失败」的猜测兜底分支时置 false。
      let verified = true;
      try {
        const openPair = openPairs.get(tok.type);
        if (openPair) {
          const openFrom = pos;
          const openTo = pos + tok.markup.length;
          markConsumed(consumed, openFrom, openTo);
          stack.push({ name: openPair.mark, attrs: null, openFrom, openTo });
          pos = openTo;
          continue;
        }
        const closePair = closePairs.get(tok.type);
        if (closePair) {
          const closeFrom = pos;
          const closeTo = pos + tok.markup.length;
          markConsumed(consumed, closeFrom, closeTo);
          closeMark(closeFrom, closeTo, closePair.mark);
          pos = closeTo;
          continue;
        }
        switch (tok.type) {
          case "text": {
            const advance = textAdvance(text, pos, tok.content);
            if (advance < 0) {
              warnSpanOnce(
                "desync:text",
                `[inline-derive] text token 与源码对不齐（pos=${pos}, content=${JSON.stringify(tok.content)}），按内容长度推进`,
              );
              verified = false;
              pos += tok.content.length;
            } else {
              pos += advance;
            }
            break;
          }
          case "softbreak": {
            pos += softbreakAdvance(text, pos);
            break;
          }
          case "hardbreak": {
            const range = hardBreakRange(text, pos);
            pos = range.to;
            atoms.push({ at: range.from, node: "hard_break" });
            break;
          }
          case "code_inline": {
            const fence = tok.markup || "`";
            const openFrom = pos;
            const openTo = pos + fence.length;
            const closeFrom = findFence(text, openTo, fence.length);
            if (closeFrom < 0) {
              // 不应发生：md-it 已配对。兜底不推进游标（位置未核对）。
              verified = false;
              break;
            }
            const closeTo = closeFrom + fence.length;
            // md-it 已决定裁剪：raw 内宽与 content 的差值即两侧各裁掉的空格数（0 或 1）。
            const rawLen = closeFrom - openTo;
            const pad = Math.max(0, Math.floor((rawLen - tok.content.length) / 2));
            const from = openTo + pad;
            const to = closeFrom - pad;
            markConsumed(consumed, openFrom, closeTo);
            const codeSpan: InlineSpan = {
              type: "code",
              from,
              to,
              openFrom,
              openTo,
              closeFrom,
              closeTo,
            };
            if (pad > 0) {
              codeSpan.delimRanges = [
                { from: openFrom, to: openTo },
                ...(from > openTo ? [{ from: openTo, to: from, softInside: true }] : []),
                ...(to < closeFrom ? [{ from: to, to: closeFrom, softInside: true }] : []),
                { from: closeFrom, to: closeTo },
              ];
            }
            spans.push(codeSpan);
            pos = closeTo;
            break;
          }
          case "link_open": {
            const isAuto = tok.markup === "autolink";
            const openFrom = pos;
            const openTo = pos + 1; // `[` 或 `<`
            markConsumed(consumed, openFrom, openTo);
            stack.push({
              name: isAuto ? "autolink" : "link",
              attrs: isAuto
                ? { href: decodeNonAscii(tok.attrGet("href") ?? "") }
                : {
                    href: decodeNonAscii(tok.attrGet("href") ?? ""),
                    title: tok.attrGet("title") || null,
                  },
              openFrom,
              openTo,
            });
            pos = openTo;
            break;
          }
          case "link_close": {
            if (tok.markup === "autolink") {
              const closeFrom = pos;
              const closeTo = pos + 1; // `>`
              // 整段 `<…>` 归 autolink 所有：只占 `<`/`>` 会让扩展扫描器钻进
              // URL 内部（`~x~` / `$x$` / `==x==` 在 URL 里长出 mark）。
              const openFrom = stack[stack.length - 1]?.openFrom ?? closeFrom;
              markConsumed(consumed, openFrom, closeTo);
              closeMark(closeFrom, closeTo);
              pos = closeTo;
              break;
            }
            // 行内链接：`]` + `(目标[ 标题])`。参考式/折叠式链接在加载期已规范化
            // 成行内形式，正常路径不会走到失败分支；失败时仍推进游标（跳过闭合段），
            // 避免同一段内后续 token 的位置整体漂移。
            if (text[pos] !== "]") {
              if (import.meta.env.DEV) {
                console.warn("[inline-derive] link_close: 期望 `]`");
              }
              verified = false;
              stack.pop();
              pos = skipBracketTail(text, pos);
              break;
            }
            // 参考式 / 折叠式 / 捷径式：闭合段是 `][id]` / `[]` / 裸 `]`，目标在
            // 段落之外，跳过即可（正常路径，不是定位失败）。
            if (text[pos + 1] !== "(") {
              stack.pop();
              pos = skipBracketTail(text, pos);
              break;
            }
            const closeTo = findDestEnd(text, pos + 1);
            if (closeTo < 0) {
              if (import.meta.env.DEV) {
                console.warn("[inline-derive] link_close: 目标定位失败");
              }
              verified = false;
              stack.pop();
              pos = skipBracketTail(text, pos);
              break;
            }
            markConsumed(consumed, pos, closeTo);
            closeMark(pos, closeTo);
            pos = closeTo;
            break;
          }
          case "image": {
            const openFrom = pos; // `!`
            const openTo = pos + 2; // `![`
            markConsumed(consumed, openFrom, openTo);
            const altFrom = openTo;
            if (tok.children?.length) {
              // alt 内的子 token 以 alt 起点为基准，先把游标推到 `![` 之后。
              pos = altFrom;
              walk(tok.children);
            }
            // alt 内的行内 token 可能因实体/转义与原文长度不同，按原文 alt 长度归位。
            pos = altFrom + tok.content.length;
            if (text[pos] !== "]") {
              if (import.meta.env.DEV) {
                console.warn("[inline-derive] image: 期望 `]`");
              }
              verified = false;
              pos = skipBracketTail(text, pos);
              break;
            }
            // 参考式 / 折叠式图片：闭合段是 `][id]` / `[]` / 裸 `]`，正常路径。
            if (text[pos + 1] !== "(") {
              pos = skipBracketTail(text, pos);
              break;
            }
            const closeTo = findDestEnd(text, pos + 1);
            if (closeTo < 0) {
              if (import.meta.env.DEV) {
                console.warn("[inline-derive] image: 目标定位失败");
              }
              verified = false;
              pos = skipBracketTail(text, pos);
              break;
            }
            markConsumed(consumed, pos, closeTo);
            const imageSpan: InlineSpan = {
              type: "image",
              from: altFrom,
              to: pos,
              openFrom,
              openTo,
              closeFrom: pos,
              closeTo,
              attrs: {
                src: decodeNonAscii(tok.attrGet("src") ?? ""),
                title: tok.attrGet("title") || null,
              },
            };
            decorateImageSpan(imageSpan, {
              src: imageSpan.attrs!.src as string,
              alt: tok.content,
              title: (imageSpan.attrs!.title as string | null) ?? null,
              closeFrom: pos,
              closeTo,
            });
            spans.push(imageSpan);
            pos = closeTo;
            break;
          }
          default: {
            // 形状可核对的未登记 token：只推进游标、不产出 span，也不占用字符，
            // 让真正拥有它的 derive 仍在原位置认领。形状核对不上（或同形状但并非
            // 任何扩展构造）时游标保持不动并告警，不臆测跳过。
            const advance = advanceForToken(text, pos, tok, tokenAdvances);
            if (advance > 0) {
              pos += advance;
              break;
            }
            // 形状核对失败：游标不推进，位置未经过核对。
            verified = false;
            if (import.meta.env.DEV) {
              console.warn(
                `[inline-derive] 未登记的 token 类型 "${tok.type}"（形状核对失败），游标不推进`,
              );
            }
            break;
          }
        }
      } finally {
        positioned.push({
          token: tok,
          pos: start,
          end: pos,
          exact: pos > start,
          verified,
        });
      }
    }
  };

  walk(tokens ?? parseInlineTokens(text));
  // 图片的 alt 子 token 会先于图片 token 入列；按源文位置稳定排序。
  positioned.sort((a, b) => a.pos - b.pos || a.end - b.end);

  // v2：按 order 依次派生。每个特性隔离；span 先排序再校验，保证确定性。
  // 引擎是模块入口：不依赖调用方已按 order 排序（collectDeriveFeatures 已排，
  // 但直接调用 / 测试可能传无序）。
  const ordered = [...features].sort(
    (a, b) => (a.inline?.order ?? 0) - (b.inline?.order ?? 0),
  );
  for (const feature of ordered) {
    const inline = feature.inline;
    const derive = inline?.derive;
    if (!inline || !derive) continue;
    const markNames = inline.markNames ?? [];

    try {
      const produced: unknown = derive({
        text,
        tokens: positioned,
        consumed: consumed.slice(),
        parentBlock,
        isConsumed: (from, to = from + 1) => {
          for (let i = from; i < to; i++) if (consumed[i]) return true;
          return false;
        },
        warn: (message) =>
          warnSpanOnce(
            `feature:${feature.name}:${message}`,
            `[inline-derive] ${feature.name}: ${message}`,
          ),
      });
      if (!Array.isArray(produced)) {
        // 契约允许 derive 不返回值（`undefined` / `null`）⇒ 静默跳过；
        // 返回类数组 / 不可迭代值则属违约，必须留下痕迹，不能静默吞掉。
        if (produced != null) {
          warnSpanOnce(
            `derive-not-array:${feature.name}`,
            `[inline-derive] 特性 "${feature.name}" 的 derive 未返回数组，已跳过`,
          );
        }
        continue;
      }
      if (produced.length === 0) continue;

      const list = produced.filter(isSpanLike);
      if (list.length !== produced.length) {
        warnSpanOnce(
          `derive-junk:${feature.name}`,
          `[inline-derive] 特性 "${feature.name}" 的 derive 产出含 ${produced.length - list.length} 个非法元素，已丢弃`,
        );
      }

      const sorted = list.sort(
        (a, b) =>
          a.openFrom - b.openFrom ||
          a.closeTo - b.closeTo ||
          (a.type < b.type ? -1 : a.type > b.type ? 1 : 0),
      );

      for (const span of sorted) {
        if (!isWellFormedSpan(span, text.length)) {
          warnSpanOnce(
            `derive-shape:${feature.name}:${span.type}`,
            `[inline-derive] 特性 "${feature.name}" 产出的 "${span.type}" 跨度违约（openFrom=${span.openFrom}, closeFrom=${span.closeFrom}, closeTo=${span.closeTo}），已丢弃`,
          );
          continue;
        }
        const guard = guardRanges(span, markNames);
        if (guard.some(([from, to]) => from < to && isRangeConsumed(consumed, from, to))) {
          warnSpanOnce(
            `derive-conflict:${feature.name}:${span.type}`,
            `[inline-derive] 特性 "${feature.name}" 的 "${span.type}" 与已认领区间重叠，已丢弃`,
          );
          continue;
        }
        for (const [from, to] of consumeRanges(span, markNames)) markConsumed(consumed, from, to);
        derivedSpans.push(span);
      }
    } catch (err) {
      // 插件是运行时边界：derive 抛错、sort/校验过程中的异常都只跳过本特性，
      // 不允许把整块（乃至整篇）解析带崩。非数组 / 非法元素在上面已显式告警。
      warnSpanOnce(
        `derive-throw:${feature.name}`,
        `[inline-derive] 特性 "${feature.name}" 的 derive 或其产出无法处理，已跳过`,
        err,
      );
    }
  }

  if (derivedSpans.length > 0) {
    if (import.meta.env.DEV && spans.length > 1) {
      for (let i = 1; i < spans.length; i++) {
        if (spans[i - 1]!.closeFrom > spans[i]!.closeFrom) {
          warnSpanOnce(
            "core-order",
            "[inline-derive] 核心 span 未按闭合序产出（归并排序会掩盖该 bug）",
          );
          break;
        }
      }
    }
    // 与旧 locator 的闭合序一致：内层先、外层后；全部 derive span 一起按闭合序归并。
    spans.push(...derivedSpans);
    spans.sort((a, b) => a.closeFrom - b.closeFrom || a.openFrom - b.openFrom);
  }

  return { spans, atoms, consumed, positioned };
}

