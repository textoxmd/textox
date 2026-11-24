import { markConsumed, type InlineSpan } from "../inline-parse.ts";
import type { Node as PMNode } from "prosemirror-model";
import type { FeatureSpec } from "./_types.ts";

function trimTrailing(raw: string): string {
  let end = raw.length;
  while (end > 0) {
    const ch = raw[end - 1]!;
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) { end--; continue; }
    if (ch === ")") {
      let open = 0, close = 0;
      for (let i = 0; i < end; i++) {
        if (raw[i] === "(") open++;
        else if (raw[i] === ")") close++;
      }
      if (open < close) { end--; continue; }
      break;
    }
    if (ch === "]" || ch === ">" || ch === '"' || ch === "'") { end--; continue; }
    if (/[.,;:!?]/.test(ch)) { end--; continue; }
    break;
  }
  return raw.slice(0, end);
}

const BARE_URL_RE = /https?:\/\/\S+/g;

// 引用定义草稿 `[label]: url`（ref-def 特性）。草稿段落里的 url 是目标
// 地址数据，不应被裸链接扫描改成可点击链接——提交为结构化 link_def 后
// ref_url / ref_label 文本块同样属于 link_def，一并跳过。
const REF_DEF_DRAFT_RE = /^\[(?!\^)[^\]]+\]:/;

const scanAutoLinks = (
  text: string,
  consumed: Uint8Array,
  parentBlock: PMNode | null,
): InlineSpan[] => {
  if (REF_DEF_DRAFT_RE.test(text)) return [];
  if (parentBlock?.type.name === "link_def") return [];
  const out: InlineSpan[] = [];
  BARE_URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BARE_URL_RE.exec(text))) {
    const trimmed = trimTrailing(m[0]);
    if (trimmed.length < 4) continue;
    const start = m.index;
    const end = start + trimmed.length;
    // Skip if preceded by `<` without space — user is mid-typing a CommonMark autolink `<url>`
    if (start > 0 && text[start - 1] === "<") continue;

    let blocked = false;
    for (let i = start; i < end; i++) {
      if (consumed[i]) { blocked = true; break; }
    }
    if (blocked) continue;
    markConsumed(consumed, start, end);
    out.push({
      type: "autolink",
      from: start,
      to: end,
      openFrom: start,
      openTo: start,
      closeFrom: end,
      closeTo: end,
      attrs: { href: trimmed },
      // 旧 scan 对整段 `markConsumed`；derive 用 opaque 表达「内容不可再被认领」。
      opaque: true,
    });
  }
  return out;
};

export const autoLink: FeatureSpec = {
  name: "auto-link",

  markDelims: {
    autolink: { open: "", close: "" },
  },

  inline: {
    order: 3.1,
    derive: (ctx) => scanAutoLinks(ctx.text, ctx.consumed, ctx.parentBlock),
    markNames: ["autolink"],
    extRanges: (parent) => {
      const ranges: Array<[number, number]> = [];
      const autoLinkType = parent.type.schema.marks.autolink;
      if (!autoLinkType) return ranges;
      let start = -1;
      let off = 0;
      const flush = (end: number): void => {
        if (start < 0) return;
        ranges.push([start, end]);
        start = -1;
      };
      parent.forEach((child) => {
        if (child.isText) {
          const has = child.marks.some((mk) => mk.type === autoLinkType);
          if (has) { if (start < 0) start = off; }
          else { flush(off); }
        }
        off += child.nodeSize;
      });
      flush(off);
      return ranges;
    },
  },
};
