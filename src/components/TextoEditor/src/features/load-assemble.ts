// Load-time source assembler: rebuild a textblock's text from md-it tokens.
//
// The paragraph rule keeps the raw source (`inline.content`), but the parser
// used to rebuild the textblock from each token's *normalized* payload
// (`link_close` → `](href "title")`, `code_inline` → folded content, …), which
// rewrote the user's source on load. This module assembles the textblock from
// the raw text instead, so every token is honoured in its original spelling;
// only the constructs markdown-it has genuinely resolved elsewhere —
// reference-style link / image tails — are rewritten to their canonical inline
// form (the resolved target has no source of its own inside the paragraph).
//
// Nothing is located here: `deriveInline` already walks the same token list and
// reports one `positioned` unit per token (pos / end / verified) alongside the
// full derivation (spans / atoms / consumed). This module slices the source at
// those units and applies the reference-style canonicalisation, so the load
// path and the span locator can never disagree about where a token lives.
//
// The derivation returned alongside the text is computed on `raw`; it can be
// applied to `text` verbatim only when `reusable` is true (no reference-style
// tail was canonicalised). Callers must check that flag before reusing spans.
//
// The assembly is strict: a token without a trustworthy position (missing, or
// `verified === false` because the locator had to guess) aborts it (returns
// `null`) and the caller falls back to the old per-token path, so a surprise
// token never silently drops source text. Reference-style link / image are the
// one deliberate exception — they have no inline target to verify, and their
// position is the exact bracket tail — so those two branches re-check the
// source shape themselves.
//
// Paired tokens (em / strong / strike, plugin-declared marks) are not
// enumerated here either: the locator already advances by `markup` for them, so
// the generic slice path covers every paired family without changes.

import type Token from "markdown-it/lib/token.mjs";

import { collectDeriveFeatures, collectTokenAdvances } from "./index.ts";
import { deriveInline, type InlineDerivation } from "./inline-derive.ts";
import { decodeNonAscii } from "./url.ts";

type LinkTarget = { href: string; title: string | null };

/** 组装结果：textblock 文本 + 同一遍定位得到的完整派生。 */
export type LoadAssembly = {
  readonly text: string;
  /**
   * 位置基于 `raw`（组装可能改写参考式闭合段，见 `reusable`）。
   */
  readonly derivation: InlineDerivation;
  /**
   * `text === raw`：参考式 link/image 未被 canonical 化，派生偏移可以直接用于
   * `text`。为 false 时 `derivation` 仍对应 `raw`，不能拿来铺 `text` 的 mark。
   */
  readonly reusable: boolean;
};

/** canonical 闭合段：`](href)` / `](href "title")`（与 features 的 closeDelimText 同形）。 */
function canonicalClose(target: string, title: string | null): string {
  return title ? `](${target} "${title.replace(/"/g, '\\"')}")` : `](${target})`;
}

/**
 * 用原始源码组装 textblock 文本，并返回同一遍定位得到的完整派生。
 *
 * 位置由 `deriveInline` 统一给出（`tokens` 来自调用方的 `md.parse`，自带 env），
 * 不需要改写的 token 直接按其源码切片追加；参考式 `link_close` / `image` 的
 * 闭合段改写为 canonical 行内形式。无法与源码逐字对齐时返回 `null`。
 *
 * 派生始终对应 `raw`，而 `text` 可能因 canonical 化与 `raw` 不同：能否直接
 * 复用派生由 `reusable` 说明。
 */
export function assembleLoad(children: Token[], raw: string): LoadAssembly | null {
  const derivation = deriveInline(raw, {
    tokens: children,
    tokenAdvances: collectTokenAdvances(),
    // 组装同时产出完整派生（供后续复用）；派生始终对应 `raw`，见 LoadAssembly。
    features: collectDeriveFeatures(),
  });
  const { positioned } = derivation;
  const positions = new Map(positioned.map((p) => [p.token, p]));

  let pos = 0;
  let out = "";
  const links: LinkTarget[] = [];

  const copy = (len: number): void => {
    out += raw.slice(pos, pos + len);
    pos += len;
  };

  for (const tok of children) {
    const p = positions.get(tok);
    if (!p) return null;
    // verified 是逐 token 的：更早的猜测可能让后续 token 偏移，前缀连续性
    // 由这条 p.pos !== pos 兜住（参考式的 p.end 已含 `][label]` 尾巴）。
    if (p.pos !== pos) return null;
    // 走了猜测兜底的 token 不能照抄。参考式 link / image 例外：定位层没有
    // 行内目标可核对，只按括号尾（`][label]` / `[]` / `]`）精确推进，两个分支
    // 会在下面按源码形状再核对一次。
    const unverifiedReference = tok.type === "link_close" || tok.type === "image";
    if (!p.verified && !unverifiedReference) return null;

    switch (tok.type) {
      case "link_open": {
        // 其余无源码分隔符的形态（如 linkify）由回退路径处理。
        if (tok.markup && tok.markup !== "autolink") return null;
        if (tok.markup !== "autolink") {
          links.push({
            href: decodeNonAscii(tok.attrGet("href") ?? ""),
            title: tok.attrGet("title") || null,
          });
        }
        copy(p.end - p.pos);
        break;
      }
      case "link_close": {
        if (tok.markup === "autolink") {
          copy(p.end - p.pos);
          break;
        }
        if (tok.markup) return null;
        const open = links.pop();
        if (!open) return null;
        if (raw[p.pos] !== "]") return null;
        if (raw[p.pos + 1] === "(") {
          // 内联形态 `](…)`：整段照抄，但位置必须经过核对（未核对说明目标没解出来）。
          if (!p.verified) return null;
          copy(p.end - p.pos);
          break;
        }
        // 参考式/折叠式/捷径式：目标在段落之外，闭合段改写为 canonical 行内形式，
        // 游标跳过原始后缀 `][label]` / `[]` / 裸 `]`（`p.end` 已覆盖该后缀）。
        out += canonicalClose(open.href, open.title);
        pos = p.end;
        break;
      }
      case "image": {
        const altFrom = p.pos + 2;
        const alt = tok.content;
        if (raw[p.pos] !== "!" || raw[p.pos + 1] !== "[") return null;
        // image token 的 content 即 alt 原文（含未解析的标记源码）。
        if (raw.slice(altFrom, altFrom + alt.length) !== alt) return null;
        const closeBracket = altFrom + alt.length;
        if (raw[closeBracket] !== "]") return null;
        if (raw[closeBracket + 1] === "(") {
          if (!p.verified) return null;
          copy(p.end - p.pos);
          break;
        }
        // 参考式图片：`![` + alt + canonical 闭合段。
        out += raw.slice(p.pos, altFrom) + alt;
        out += canonicalClose(
          decodeNonAscii(tok.attrGet("src") ?? ""),
          tok.attrGet("title") || null,
        );
        pos = p.end;
        break;
      }
      default: {
        // text / softbreak / hardbreak / code_inline / mark / 插件 token：定位层
        // 已按源码宽度推进，直接照抄。
        copy(p.end - p.pos);
        break;
      }
    }
  }

  // 组装结果必须正好覆盖整段源码，否则视为对不齐。
  return pos === raw.length ? { text: out, derivation, reusable: out === raw } : null;
}

/** 测试/兼容入口：只要文本（`src/` 生产代码已改用 `assembleLoad`）。 */
export function assembleLoadText(children: Token[], raw: string): string | null {
  return assembleLoad(children, raw)?.text ?? null;
}
