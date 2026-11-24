// 加载期派生缓存：parse 期铺 mark 实际使用的 spans 交给 normalize 的首次 plan 复用。
//
// 键是 textblock 的 PM 节点（不可变、随文档释放）。缓存的是「push 铺 mark 实际
// 使用的那一份 spans」：来源可能是 token 派生（门禁 `sameInlineTokens` 通过），
// 也可能是文本派生（参考式 canonical 化 / env 分词不一致时的回退）。只要
// `node.textContent === text` 且没有行内原子，两者都与 normalize 会算出的结果
// 一致。消费时克隆 spans：normalize 的 mapSpanOffsets 会就地改写 from/to 及
// 嵌套区间。
//
// 覆盖边界：复用只覆盖「`closeNode` 创建的原样 textblock」。后处理器重建的块
// （例如任务列表插入 marker）节点对象已换新，不在覆盖范围内；含行内原子的块
// （硬换行）源码偏移与 `textContent` 不一致，调用方也不登记。
//
// `parentBlock` 前提：加载期派生始终以 `parentBlock: null` 计算。今天只有
// auto-link 读它、且只用于跳过 `link_def`，而 `link_def` 在加载路径不会以
// textblock 形式出现，故缓存派生与 normalize 的 `parseInlineWith(text, parent)`
// 等价。

import type Token from "markdown-it/lib/token.mjs";
import type { Node as PMNode } from "prosemirror-model";
import type { InlineSpan } from "@texto/markdown-editor-runtime";

export type LoadDerivation = {
  readonly text: string;
  readonly spans: InlineSpan[];
};

const cache = new WeakMap<PMNode, LoadDerivation>();

/** `token.meta` 是插件的自由数据（`any`）：无法稳定比较时保守拒绝复用。 */
function sameMeta(a: unknown, b: unknown): boolean {
  if (!a || !b) return !a && !b;
  // 非纯对象（Map / Set / 类实例）无法用 JSON 稳定比较，保守拒绝复用。
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * block 期 token 是否与「空 env 重新分词」逐项一致（含嵌套 `children`）。
 *
 * `assembleLoad` 拿到的是 `md.parse` 的 inline token，其分词边界受过文档 env
 * 影响：例如脚注定义存在时 `[^1]` 会被整段留在一个 text token 里，而按空 env
 * 重新分词时同一个 `^` 会被 sup 规则提前切开；图片的 alt 子 token 同样如此。
 * 分词不同 ⇒ token 派生与 `parseInlineWith(text)` 不等价。
 *
 * 首帧本身是一致的（normalize init 消费同一份派生）；不一致发生在该块之后被
 * 重新 derive（编辑、粘贴、round-trip）时 —— mark 会跳变，因此这类块必须走
 * 文本派生（登记给 normalize 的也是文本派生）。
 */
export function sameInlineTokens(a: readonly Token[], b: readonly Token[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.type !== y.type ||
      x.content !== y.content ||
      x.markup !== y.markup ||
      x.nesting !== y.nesting ||
      x.info !== y.info ||
      x.hidden !== y.hidden
    ) {
      return false;
    }
    const xa = x.attrs ?? [];
    const ya = y.attrs ?? [];
    if (xa.length !== ya.length) return false;
    for (let k = 0; k < xa.length; k++) {
      if (xa[k]![0] !== ya[k]![0] || xa[k]![1] !== ya[k]![1]) return false;
    }
    if (!sameMeta(x.meta, y.meta)) return false;
    if (!sameInlineTokens(x.children ?? [], y.children ?? [])) return false;
  }
  return true;
}

export function rememberLoadDerivation(node: PMNode, entry: LoadDerivation): void {
  cache.set(node, entry);
}

/**
 * 取出并删除该文本块的加载派生；`text` 与登记文本不一致时返回 `null`。
 * 返回的是 `spans` 的深拷贝（区间对象逐层复制），可以直接交给 `mapSpanOffsets`。
 */
export function takeLoadSpans(node: PMNode, text: string): InlineSpan[] | null {
  const entry = cache.get(node);
  if (!entry) return null;
  cache.delete(node);
  if (entry.text !== text) {
    if (import.meta.env.DEV) {
      console.warn("[load-derivation] 文本不一致，放弃复用");
    }
    return null;
  }
  return entry.spans.map((span) => ({
    ...span,
    ...(span.delimRanges
      ? { delimRanges: span.delimRanges.map((range) => ({ ...range })) }
      : {}),
    ...(span.extraDecorations
      ? { extraDecorations: span.extraDecorations.map((item) => ({ ...item })) }
      : {}),
    ...(span.widgetDecorations
      ? { widgetDecorations: span.widgetDecorations.map((item) => ({ ...item })) }
      : {}),
  }));
}

/** 仅测试：条目是否仍登记（不消费）。 */
export function peekLoadDerivation(node: PMNode): boolean {
  return cache.has(node);
}
