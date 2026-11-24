import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type MarkdownIt from "markdown-it";
import { registerContributions, resetExtensionPointsForTests } from "@texto/plugin-sdk";
import { MARKDOWN_EDITOR_SYNTAX_FEATURE, type SyntaxFeature } from "@texto/markdown-editor-api";
import type { InlineDeriveFeature, InlineFeatureSpec } from "@texto/markdown-editor-runtime";
import type Token from "markdown-it/lib/token.mjs";

import {
  collectInlineFeatures,
  resetFeaturesForTests,
} from "../../src/features/index.ts";
import { parseInline } from "../../src/inline-parse.ts";
import {
  advanceForToken,
  deriveInline,
  resetInlineDeriveWarningsForTests,
  textAdvance,
  unownedAdvance,
} from "../../src/features/inline-derive.ts";
import { parseInlineTokens, parseTokens, resetParserForTests } from "../../src/parser.ts";
import { bootstrapPluginsForTests } from "../plugins-setup";

// 仅「mark 同步 / 不派生 span」形态的行内功能：没有 derive，只有
// markNames / extRanges —— 契约必须接受这种形状（normalize / decorations /
// serializer 仍能看到它，inline 解析不产出任何 span）。
const deriveOnly: SyntaxFeature = {
  name: "derive-only",
  inline: {
    markNames: ["derive_mark"],
    extRanges: () => [],
  },
};

// 登记「派生形态」贡献后必须清掉 allFeatures() 的惰性缓存：本用例的
// 基线（parseInline）会把缓存预热成「插件态」，不清就看不到新贡献。
function registerDeriveOnly(): void {
  registerContributions("derive-probe", {
    [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [deriveOnly],
  });
  resetFeaturesForTests();
}

// 探针：注册一条 core ruler 规则，往 inline children 末尾塞一个自定义 token。
// 只有 `parseInlineTokens` 真的跑 core 链时，这个 token 才会出现。
// （只跑 `md.inline.parse` 的话 inline 阶段之后没有 core 规则，token 不会出现。）
const coreProbe = (md: MarkdownIt) => {
  md.core.ruler.after("inline", "probe_core_token", (state) => {
    for (const tok of state.tokens) {
      if (tok.type !== "inline" || !tok.children) continue;
      tok.children.push(new state.Token("core_probe", "", 0));
    }
  });
};

const coreProbeFeature: SyntaxFeature = {
  name: "core-probe",
  mdItPlugins: [coreProbe],
};

function registerCoreProbe(): void {
  registerContributions("core-probe", {
    [MARKDOWN_EDITOR_SYNTAX_FEATURE]: [coreProbeFeature],
  });
  resetFeaturesForTests();
}

// 插件态与惰性缓存对两个 describe 都要成立：`parseInlineTokens` 首次调用会
// 惰性构建并永久缓存 md-it 实例，若在插件态被清空时构建，后续用例（含任务 4-6
// 的 math/footnote/emoji token 断言）都会跑在 plugin-less parser 上。
beforeEach(() => {
  bootstrapPluginsForTests();
});

afterEach(() => {
  // 扩展点由下一例的 bootstrap 重建；功能缓存与 parser 缓存需显式失效，
  // 否则下一例会复用上一例的注册态 / plugin-less 解析器。
  resetExtensionPointsForTests();
  resetFeaturesForTests();
  resetParserForTests();
  vi.restoreAllMocks();
});

describe("features: inline feature without derive", () => {
  it("is still collected for markNames / extRanges", () => {
    registerDeriveOnly();

    const collected = collectInlineFeatures();
    expect(collected).toContain(deriveOnly.inline);

    const item = collected.find((f) => f === deriveOnly.inline);
    expect(item?.markNames).toEqual(["derive_mark"]);
    expect(item?.extRanges).toBe(deriveOnly.inline!.extRanges);
  });

  it("does not change parseInline output", () => {
    // 不声明 derive 的特性只参与 mark 同步 / 序列化，inline 解析必须保持
    // 逐字段不变（基线本身含 emoji span，确保比较不是空对空）。
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // 基线：真实插件态下 `:smile:` 产出一个 emoji span。
    const baseline = parseInline(":smile:");
    expect(baseline).toHaveLength(1);
    expect(baseline.map((s) => s.type)).toEqual(["emoji"]);

    registerDeriveOnly();

    const spans = parseInline(":smile:");
    expect(spans).toHaveLength(1);
    expect(spans.map((s) => s.type)).toEqual(["emoji"]);
    expect(spans).toEqual(baseline);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

// 插件契约用例：待建 inline-plugin-contract.test.ts 后再考虑迁移过去。
describe("parseInlineTokens", () => {
  it("returns raw inline tokens", () => {
    const toks = parseInlineTokens("a *b* c");
    expect(toks.map((t) => t.type)).toEqual([
      "text", "em_open", "text", "em_close", "text",
    ]);
  });

  it("keeps entities verbatim so token content equals the source", () => {
    const toks = parseInlineTokens("a &amp; b");
    expect(toks).toHaveLength(1);
    expect(toks[0]!.type).toBe("text");
    expect(toks[0]!.content).toBe("a &amp; b");
  });

  it("keeps backslash escapes verbatim as a single text token", () => {
    // 编辑器把 md-it 默认的 `escape` 换成了 `escapePreserveBackslash`（见 parser.ts），
    // 默认规则才产 `text_special`；这里的覆写把 `\X` 原样留在 `text.content` 里。
    // 守的是定位层 / 组装层的前提：token content === 源文。
    expect(parseInlineTokens("a \\* b").map((t) => [t.type, t.content])).toEqual([
      ["text", "a \\* b"],
    ]);
    expect(parseInlineTokens("\\~x\\~").map((t) => [t.type, t.content])).toEqual([
      ["text", "\\~x\\~"],
    ]);
  });

  it("runs core rules (core-ruler plugins see the inline children)", () => {
    // 走 `md.inline.parse` 全量替换（不经 core 链）时，inline 之后没有 core
    // 规则被执行，这里拿不到 `core_probe`。
    registerCoreProbe();

    expect(parseInlineTokens("hi").some((t) => t.type === "core_probe")).toBe(true);
  });
});

const span = (text: string) =>
  deriveInline(text).spans.map((s) => `${s.type}:"${text.slice(s.from, s.to)}"`);

it("basic tokens: text / em / strong / strike / breaks", () => {
  expect(span("a *b* c")).toEqual(['em:"b"']);
  expect(span("a **b** c")).toEqual(['strong:"b"']);
  expect(span("a ***b*** c")).toEqual(['strong:"b"', 'em:"**b**"']);
  expect(span("x ~~s~~ y")).toEqual(['strike:"s"']);
  expect(span("_em_ and __strong__")).toEqual(['em:"em"', 'strong:"strong"']);
  expect(deriveInline("a  \nb").atoms).toEqual([{ at: 1, node: "hard_break" }]);
  expect(deriveInline("a\\\nb").atoms).toEqual([{ at: 1, node: "hard_break" }]);
  expect(deriveInline("a\nb").atoms).toEqual([]);
});

it("breaks skip the next line's leading whitespace", () => {
  expect(span("a\n  *b*")).toEqual(['em:"b"']);
  expect(span("a  \n  *b*")).toEqual(['em:"b"']);
  expect(span("a\\\n  *b*")).toEqual(['em:"b"']);
  expect(span("a\n\t*b*")).toEqual(['em:"b"']);
  // 行尾单个空格不算 hardbreak：md-it 会把它从 text token 里剥掉。
  expect(span("a \n*b*")).toEqual(['em:"b"']);
  expect(span("a \n  *b*")).toEqual(['em:"b"']);
});

it("consumed covers exactly the delimiters", () => {
  const d = deriveInline("a *b* c");
  const used = Array.from(d.consumed).flatMap((v, i) => (v ? [i] : []));
  expect(used).toEqual([2, 4]);
});

it("code_inline locates the fence and folds padding", () => {
  expect(span("a `b` c")).toEqual(['code:"b"']);
  expect(span("a `` b ` c `` d")).toEqual(['code:"b ` c"']);
  // 单侧空格不裁（CommonMark）：内容为 ` a`
  const s1 = "a ` a` c";
  expect(span(s1)).toEqual(['code:" a"']);
  // 两侧都有空格 → 裁掉，填充走软隐藏
  const s2 = "a ` x ` c";
  const d = deriveInline(s2);
  expect(span(s2)).toEqual(['code:"x"']);
  const code = d.spans.find((x) => x.type === "code")!;
  expect(code.delimRanges?.some((r) => r.softInside)).toBe(true);
  // 围栏边界正确（含围栏）
  expect(s2.slice(code.openFrom, code.openTo)).toBe("`");
  expect(s2.slice(code.closeFrom, code.closeTo)).toBe("`");
});

it("links locate raw delimiters and keep attrs", () => {
  expect(span("[t](u)")).toEqual(['link:"t"']);
  expect(span("[t](u \"ti\")")).toEqual(['link:"t"']);
  expect(span("[t](u 'ti')")).toEqual(['link:"t"']); // 单引号 title
  expect(span("[t](<u v>)")).toEqual(['link:"t"']); // 尖括号目标
  expect(span("[a [b] c](u)")).toEqual(['link:"a [b] c"']); // 配平方括号
  expect(span("[t](foo(and(bar)))")).toEqual(['link:"t"']); // 配平圆括号
  const d = deriveInline("[t](u \"ti\")");
  expect(d.spans[0]!.attrs).toMatchObject({ href: "u", title: "ti" });
});

it("images locate the bang-bracket and the destination", () => {
  expect(span("![a](x.png)")).toEqual(['image:"a"']);
  expect(span("x ![a *em*](x.png) y")).toEqual(['em:"em"', 'image:"a *em*"']);
  expect(span("x ![a [b] c](x.png) y")).toEqual(['image:"a [b] c"']);
  const d = deriveInline("![a](x.png \"t\")");
  const img = d.spans.find((s) => s.type === "image")!;
  expect(img.attrs).toMatchObject({ src: "x.png", title: "t" });
  expect(img.delimRanges?.some((r) => r.softInside)).toBe(true);
});

it("a destination does not get inline marks", () => {
  expect(span("[a](x*y*z)")).toEqual(['link:"a"']);
});

it("empty link text keeps its delimiters visible", () => {
  const d = deriveInline("[](u)");
  const link = d.spans[0]!;
  expect(link.type).toBe("link");
  expect(link.delimRanges?.every((r) => r.forceVisible)).toBe(true);
});

it("link and image delimiters cover the exact source", () => {
  const l = "[t](u 'ti')";
  const link = deriveInline(l).spans[0]!;
  expect(l.slice(link.openFrom, link.openTo)).toBe("[");
  expect(l.slice(link.closeFrom, link.closeTo)).toBe("](u 'ti')");

  const img = "x ![a [b] c](x.png \"t\") y";
  const image = deriveInline(img).spans.find((s) => s.type === "image")!;
  expect(img.slice(image.openFrom, image.openTo)).toBe("![");
  expect(img.slice(image.closeFrom, image.closeTo)).toBe("](x.png \"t\")");

  // autolink（`<url>`）：分隔符是单个 `<` / `>`，整段归 autolink 占用。
  const auto = "<http://x.com/a%20b>";
  const d = deriveInline(auto);
  const autoSpan = d.spans[0]!;
  expect(autoSpan.type).toBe("autolink");
  expect(auto.slice(autoSpan.openFrom, autoSpan.openTo)).toBe("<");
  expect(auto.slice(autoSpan.closeFrom, autoSpan.closeTo)).toBe(">");
  expect(Array.from(d.consumed).every((v) => v === 1)).toBe(true);
});

it("escaped > inside an angle destination still locates the link", () => {
  const src = "x [a](<u\\>v>) *z*";
  const d = deriveInline(src);
  const link = d.spans.find((s) => s.type === "link");
  expect(link, "link should be located").toBeTruthy();
  expect(src.slice(link!.closeFrom, link!.closeTo)).toBe("](<u\\>v>)");
  // 失败不再拖累后续位置
  expect(span(src)).toEqual(['link:"a"', 'em:"z"']);
});

it("non-ASCII destinations are decoded", () => {
  const d = deriveInline("[a](中文.md)");
  expect(d.spans[0]!.attrs).toMatchObject({ href: "中文.md" });
  const e = deriveInline("![a](中文.png)");
  expect(e.spans.find((s) => s.type === "image")!.attrs).toMatchObject({ src: "中文.png" });
});

it("cursor advances past non-owned tokens (math)", () => {
  // 若游标不跳过 `$m$`，后面的 em 会整体偏 4
  expect(span("x $m$ *b*")).toEqual(['em:"b"']);
  expect(span("x $$b$$ *c*")).toEqual(['em:"c"']);
  // 数学内容本身不产出 span（留给扩展扫描器）
  expect(deriveInline("x $m$ y").spans).toEqual([]);
  // 数学构造的位置不被定位器占用
  const d = deriveInline("x $m$ y");
  expect(Array.from(d.consumed).every((v) => v === 0)).toBe(true);
});

it("image spans carry the render widget; empty src gets the file input", () => {
  const d = deriveInline("![a](x.png)");
  const img = d.spans.find((s) => s.type === "image")!;
  expect(img.widgetDecorations?.map((w) => w.kind)).toEqual(["image-render"]);
  expect(img.delimRanges?.some((r) => r.softInside)).toBe(true);

  // 空 src（`![]()`）才进编辑态；`![](x.png)` 只是空 alt，src 非空 ⇒ 仍渲染。
  const e = deriveInline("![]()");
  const empty = e.spans.find((s) => s.type === "image")!;
  expect(empty.widgetDecorations?.map((w) => w.kind)).toEqual(["file-input"]);
  expect(empty.delimRanges?.length ?? 0).toBe(0);
});

describe("oracle: locator agrees with markdown-it", () => {
  const corpus = [
    "a *b* c", "a **b** c", "a ***b*** c", "a _b_ c", "a __b__ c",
    "a `b` c", "a `` b ` c `` d", "a ` x ` c",
    "[t](u)", "[t](u \"ti\")", "[t](u 'ti')", "[t](<u v>)",
    "[t](foo(and(bar)))", "[a [b] c](u)", "[[a]](u)",
    "![a](x.png)", "![a](x.png \"t\")",
    "x ![a *em*](x.png) y", "x ![a [b] c](x.png) y",
    "x ![a `c`](x.png) y", "[](u)", "[]()", "[](u \"t\")",
    "[a](x*y*z)", "*[a](b)*", "**![a](x)*", "~~![a](x)~~",
    "a  \nb", "a\nb", "a\\\nb", "a\n  *b*", "a  \n  *b*",
    "x $m$ *b*", "x $$b$$ *c*", "x $m$ y",
    "a &amp; b", "\\*x\\*", "x [a](u <v>) y",
  ];

  it("all delimiter ranges are in-bounds and non-empty", () => {
    for (const src of corpus) {
      const d = deriveInline(src);
      for (const s of d.spans) {
        expect(s.openTo, `${src} ${s.type} open`).toBeGreaterThan(s.openFrom);
        expect(s.closeTo, `${src} ${s.type} close`).toBeGreaterThan(s.closeFrom);
        expect(s.openFrom).toBeGreaterThanOrEqual(0);
        expect(s.closeTo).toBeLessThanOrEqual(src.length);
        expect(s.from).toBeGreaterThanOrEqual(s.openTo);
        expect(s.to).toBeLessThanOrEqual(s.closeFrom);
      }
    }
  });

  it("mark sets match markdown-it semantics", () => {
    const set = (src: string) => deriveInline(src).spans.map((s) => s.type).sort();
    expect(set("*![a](x)*")).toEqual(["em", "image"]);
    expect(set("![a *em*](x.png)")).toEqual(["em", "image"]);
    expect(set("~~![a](x)~~")).toEqual(["image", "strike"]);
    expect(set("[a](x*y*z)")).toEqual(["link"]);
    expect(set("**1*")).toEqual(["em"]);
    expect(set("a*\"foo\"*")).toEqual([]);
    expect(set("x $m$ y")).toEqual([]);
  });

  it("content slices never cross the source boundaries", () => {
    for (const src of corpus) {
      for (const s of deriveInline(src).spans) {
        expect(() => src.slice(s.from, s.to)).not.toThrow();
        expect(s.from).toBeLessThanOrEqual(s.to);
      }
    }
  });
});

describe("unownedAdvance: 未登记 token", () => {
  it("未登记的成对 token 只按 markup 推进游标", () => {
    const tok = { type: "mark_open", markup: "==", content: "", nesting: 1 } as unknown as Token;
    expect(unownedAdvance("==x==", 0, tok)).toBe(2);
  });

  it("成对 token 的 markup 与源文不符时不推进", () => {
    const tok = { type: "mark_open", markup: "==", content: "", nesting: 1 } as unknown as Token;
    expect(unownedAdvance("xx", 0, tok)).toBe(0);
  });

  it("nesting 为 0 的纯文本 token 仍交给 unownedAdvance 兜底", () => {
    const tok = { type: "text", markup: "", content: "==x==", nesting: 0 } as unknown as Token;
    expect(unownedAdvance("==x==", 0, tok)).toBe(5);
  });

  it("成对 token 带 content 时退回围栏整段核对", () => {
    const tok = { type: "mark_open", markup: "==", content: "x", nesting: 1 } as unknown as Token;
    expect(unownedAdvance("==x==", 0, tok)).toBe(5); // 去掉 !content 会变 2
    expect(unownedAdvance("==y==", 0, tok)).toBe(0);
  });
});

describe("textAdvance", () => {
  it("普通原文（无转义）", () => {
    expect(textAdvance("abc", 0, "abc")).toBe(3);
    expect(textAdvance("xabc", 1, "abc")).toBe(3);
  });

  it("反转义内容：把反斜杠计入源码跨度", () => {
    expect(textAdvance("a\\ b", 0, "a b")).toBe(4);
    expect(textAdvance("a\\~b", 0, "a~b")).toBe(4);
    expect(textAdvance("a\\~\\~b", 0, "a~~b")).toBe(6);
  });

  it("content 以字面反斜杠结尾时不被前缀假阳性截断", () => {
    // md-it-sub：源文 `~a\\~` 的 text content 是 `a\`（`\\` 反转义）
    expect(textAdvance("~a\\\\~", 1, "a\\")).toBe(3);
  });

  it("原文里的 `\\ ` 按字面计（快路径兜底不可省）", () => {
    expect(textAdvance("a\\ b", 0, "a\\ b")).toBe(4);
  });

  it("转义之后的字面反斜杠按字面计（必须走慢路径）", () => {
    // `\~` 被反转义，`\z` 不是转义对：慢路径必须落到「字面反斜杠」分支。
    expect(textAdvance("a\\~b\\zc", 0, "a~b\\zc")).toBe(7);
  });

  it("对不齐返回 -1", () => {
    expect(textAdvance("a b", 0, "a~b")).toBe(-1);
    expect(textAdvance("a\\ b", 0, "a~b")).toBe(-1);
    expect(textAdvance("ab", 0, "abc")).toBe(-1);
  });
});

describe("positioned tokens", () => {
  const posOf = (src: string) =>
    deriveInline(src).positioned.map(
      (t) => [t.token.type, t.pos, t.end, t.exact, t.verified] as const,
    );

  it("定位普通文本与成对 token", () => {
    expect(posOf("a *b* c")).toEqual([
      ["text", 0, 2, true, true],
      ["em_open", 2, 3, true, true],
      ["text", 3, 4, true, true],
      ["em_close", 4, 5, true, true],
      ["text", 5, 7, true, true],
    ]);
  });

  it("定位链接、图片与硬换行", () => {
    expect(posOf("[t](u)")).toEqual([
      ["link_open", 0, 1, true, true],
      ["text", 1, 2, true, true],
      ["link_close", 2, 6, true, true],
    ]);
    expect(posOf("a  \nb")).toEqual([
      ["text", 0, 1, true, true],
      ["hardbreak", 1, 4, true, true],
      ["text", 4, 5, true, true],
    ]);
  });

  it("图片容器先于 alt 子 token（依赖排序）", () => {
    expect(posOf("![a *b*](u)")).toEqual([
      ["image", 0, 11, true, true],
      ["text", 2, 4, true, true],
      ["em_open", 4, 5, true, true],
      ["text", 5, 6, true, true],
      ["em_close", 6, 7, true, true],
    ]);
  });

  it("tokens 覆盖时不再重新解析", () => {
    const toks = parseInlineTokens("a *b* c");
    const fromInput = deriveInline("a *b* c", { tokens: toks });
    const fromParse = deriveInline("a *b* c");
    expect(fromInput.positioned).toEqual(fromParse.positioned);
  });

  it("text 与源文对不上时 verified=false", () => {
    const toks = [
      { type: "text", content: "zzz" },
      { type: "text", content: "zzz" },
    ] as unknown as Token[];
    const d = deriveInline("abc", { tokens: toks });
    expect(d.positioned.map((p) => [p.pos, p.end, p.verified])).toEqual([
      [0, 3, false],
      [3, 6, false],
    ]);
  });

  it("参考式链接的闭合段是正常路径：verified=true 且不告警", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const block = parseTokens("see [t][id]\n\n[id]: https://x.example\n").find(
        (t) => t.type === "inline",
      )!;
      const d = deriveInline(block.content, { tokens: block.children! });
      const close = d.positioned.find((p) => p.token.type === "link_close")!;
      expect(close.verified).toBe(true);
      expect(warn.mock.calls.some(([m]) => String(m).includes("目标定位失败"))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("advanceForToken", () => {
  it("优先用声明，其次按 token 形状推断", () => {
    const demo = (_text: string, _pos: number, tok: Token) => (tok.type === "demo" ? 5 : null);
    expect(advanceForToken("abcde", 0, { type: "demo" } as Token, [demo])).toBe(5);
    expect(advanceForToken("abc", 0, { type: "text", content: "abc" } as Token, [demo])).toBe(3);
    expect(advanceForToken("abc", 0, { type: "weird" } as Token, [])).toBe(0);
  });

  it("只接受有限正整数，非法值视为无效", () => {
    const t = { type: "text", content: "abcd" } as Token;
    expect(advanceForToken("abcd", 0, t, [() => 0])).toBe(4);
    expect(advanceForToken("abcd", 0, t, [() => -1])).toBe(4);
    expect(advanceForToken("abcd", 0, t, [() => 1.5])).toBe(4);
    expect(advanceForToken("abcd", 0, t, [() => Number.NaN])).toBe(4);
    expect(advanceForToken("abcd", 0, t, [() => Infinity])).toBe(4);
    expect(advanceForToken("abcd", 0, t, [() => 1e21])).toBe(4);
    // 上界：恰好推进到末端合法，越过末端视为无效并继续下一个声明 / 兜底。
    expect(advanceForToken("abcd", 0, t, [() => 4])).toBe(4);
    expect(advanceForToken("abcd", 0, t, [() => 5])).toBe(4);
    expect(advanceForToken("abcd", 0, t, [() => 9, () => 2])).toBe(2);
  });

  it("声明抛错时忽略该声明，继续下一个", () => {
    const t = { type: "demo" } as Token;
    const bad = () => {
      throw new Error("boom");
    };
    const good = () => 3;
    expect(advanceForToken("abcdef", 0, t, [bad, good])).toBe(3);
  });
});

describe("derive v2 engine", () => {
  type Demo = {
    name: string;
    order?: number;
    markNames?: string[];
    derive: NonNullable<InlineFeatureSpec["derive"]>;
  };
  const demo = (d: Demo): InlineDeriveFeature => ({
    name: d.name,
    inline: {
      order: d.order ?? 0,
      derive: d.derive,
      markNames: d.markNames ?? ["demo"],
      extRanges: () => [],
    },
  });
  const span = (from: number, to: number) => ({
    type: "demo",
    from,
    to,
    openFrom: from,
    openTo: from,
    closeFrom: to,
    closeTo: to,
  });

  it("按 order 依次认领；同区间低 order 先得", () => {
    const first = demo({ name: "first", order: -1, derive: () => [span(2, 5)] });
    const second = demo({ name: "second", order: 1, derive: () => [span(2, 5)] });
    const d = deriveInline("xxabcxx", { features: [second, first] });
    expect(d.spans.map((s) => [s.type, s.from, s.to])).toEqual([["demo", 2, 5]]);
  });

  it("mark 只占分隔符：内容里可以再嵌套", () => {
    const markFeature = demo({
      name: "mark",
      order: -1,
      derive: () => [
        { type: "demo", from: 1, to: 2, openFrom: 0, openTo: 1, closeFrom: 2, closeTo: 3 },
      ],
    });
    const atomFeature = demo({ name: "atom", order: 0, derive: () => [span(1, 2)] });
    const d = deriveInline("xabx", { features: [markFeature, atomFeature] });
    expect(d.spans.map((s) => [s.type, s.from, s.to])).toEqual([
      ["demo", 1, 2],
      ["demo", 1, 2],
    ]);
  });

  it("opaque span 占满整段，后续特性不能认领其内容", () => {
    const opaque = demo({
      name: "opaque",
      order: -1,
      derive: () => [
        {
          type: "demo",
          from: 1,
          to: 2,
          openFrom: 0,
          openTo: 1,
          closeFrom: 2,
          closeTo: 3,
          opaque: true,
        },
      ],
    });
    const inner = demo({
      name: "inner",
      derive: () => [
        { type: "demo", from: 1, to: 2, openFrom: 1, openTo: 1, closeFrom: 2, closeTo: 2 },
      ],
    });
    const d = deriveInline("xabx", { features: [opaque, inner] });
    expect(d.spans.map((s) => [s.type, s.from, s.to])).toEqual([["demo", 1, 2]]);
  });

  it("wrap span 整段记账，但允许内容里已有嵌套 span", () => {
    // 内层只占内容的一段（`xabcx` 的 `b`），外层 wrap 有真实分隔符
    // （`x` / `x`），中间 `abc` 是被包住的真实内容 ⇒ guard 只看分隔符时必须
    // 放行，记账时必须占掉整段。
    const inner = demo({
      name: "inner",
      order: -1,
      derive: () => [
        {
          type: "demo-inner",
          from: 2,
          to: 3,
          openFrom: 2,
          openTo: 2,
          closeFrom: 3,
          closeTo: 3,
        },
      ],
    });
    const wrap = demo({
      name: "wrap",
      markNames: ["demo-wrap"],
      derive: () => [
        {
          type: "demo-wrap",
          from: 1,
          to: 4,
          openFrom: 0,
          openTo: 1,
          closeFrom: 4,
          closeTo: 5,
          wrap: true,
        },
      ],
    });
    let consumedInside: boolean | null = null;
    const later = demo({
      name: "later",
      derive: (ctx) => {
        consumedInside = ctx.isConsumed(1, 2);
        return [];
      },
    });
    const d = deriveInline("xabcx", { features: [inner, wrap, later] });
    expect(d.spans.map((s) => s.type)).toEqual(["demo-inner", "demo-wrap"]);
    expect(consumedInside).toBe(true);
  });

  it("wrap 的 guard 只看分隔符：内容里的既有占用不挡外层", () => {
    // 外层不按 mark 分类（type 不在 markNames 里）⇒ 只有 `wrap: true` 能让
    // guard 只看分隔符；没有它整段检查会撞上内层已占用的内容。
    const inner = demo({
      name: "inner",
      order: -1,
      derive: () => [span(2, 3)],
    });
    const wrap = demo({
      name: "wrap",
      derive: () => [
        {
          type: "demo-wrap",
          from: 1,
          to: 4,
          openFrom: 0,
          openTo: 1,
          closeFrom: 4,
          closeTo: 5,
          wrap: true,
        },
      ],
    });
    const d = deriveInline("xabcx", { features: [inner, wrap] });
    expect(d.spans.map((s) => s.type)).toEqual(["demo", "demo-wrap"]);
  });

  it("非法跨度被丢弃并告警", () => {
    const bad = demo({
      name: "bad",
      derive: () => [
        { type: "demo", from: 5, to: 2, openFrom: 5, openTo: 5, closeFrom: 2, closeTo: 2 },
      ],
    });
    const good = demo({ name: "good", order: 1, derive: () => [] });
    expect(deriveInline("abc", { features: [bad, good] }).spans).toEqual([]);
  });

  it("单个特性抛错不影响其它特性", () => {
    const boom = demo({
      name: "boom",
      order: -1,
      derive: () => {
        throw new Error("boom");
      },
    });
    const ok = demo({ name: "ok", derive: () => [span(0, 1)] });
    expect(deriveInline("abc", { features: [boom, ok] }).spans.map((s) => s.from)).toEqual([0]);
  });

  it("isConsumed 能看到核心语法的分隔符", () => {
    let seen: boolean | null = null;
    const probe = demo({
      name: "probe",
      derive: (ctx) => {
        seen = ctx.isConsumed(0, 1);
        return [];
      },
    });
    deriveInline("*a*", { features: [probe] });
    expect(seen).toBe(true);
  });

  it("插件返回非法形状时只跳过自身", () => {
    resetInlineDeriveWarningsForTests();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const garbage = [
      { length: 1, 0: undefined },
      [null],
      [{ type: 7, from: 0, to: 1, openFrom: 0, openTo: 0, closeFrom: 1, closeTo: 1 }],
    ];
    for (const value of garbage) {
      const bad = demo({
        name: "bad-shape",
        order: -1,
        derive: () => value as never,
      });
      const ok = demo({ name: "ok-shape", derive: () => [span(0, 1)] });
      const d = deriveInline("abc", { features: [bad, ok] });
      // 断言 type：非法元素若漏进 spans，会以 `7` 之类的类型出现（而非 "demo"）。
      expect(d.spans.map((s) => s.type), JSON.stringify(value)).toEqual(["demo"]);
    }
    // 丢弃必须留痕：非数组走「未返回数组」，数组内的非法元素走「非法元素」，
    // 且两条都不允许退化成 catch-all。
    const msgs = warn.mock.calls.map(([msg]) => String(msg)).join("\n");
    expect(msgs).toContain("未返回数组");
    expect(msgs).toContain("非法元素");
    expect(msgs).not.toContain("无法处理");
  });

  it("缺 markNames 不会抛错", () => {
    const bad: InlineDeriveFeature = {
      name: "no-marks",
      inline: { order: -1, derive: () => [span(0, 1)], extRanges: () => [] } as never,
    };
    expect(deriveInline("abc", { features: [bad] }).spans.map((s) => s.from)).toEqual([0]);
  });

  it("isConsumed 默认只看一个字符，且能看到前一个特性的认领", () => {
    let single: boolean | null = null;
    let fromPrev: boolean | null = null;
    const first = demo({ name: "first", order: -1, derive: () => [span(0, 1)] });
    const second = demo({
      name: "second",
      derive: (ctx) => {
        single = ctx.isConsumed(0);
        fromPrev = ctx.isConsumed(0, 1);
        return [];
      },
    });
    deriveInline("abc", { features: [first, second] });
    expect(single).toBe(true);
    expect(fromPrev).toBe(true);
  });

  it("派生 span 与核心 span 一起按闭合序归并", () => {
    const inner = demo({
      name: "inner",
      order: -1,
      derive: () => [
        { type: "demo", from: 2, to: 2, openFrom: 2, openTo: 2, closeFrom: 2, closeTo: 2 },
      ],
    });
    // 派生 span 闭合于 2，核心 em 闭合于 3：不归并时会得到 [em, demo]。
    expect(
      deriveInline("*ab* cd", { features: [inner] }).spans.map((s) => s.type),
    ).toEqual(["demo", "em"]);
  });

  it("ctx.consumed 是当前占用位图的快照", () => {
    let snapshot: Uint8Array | null = null;
    const probe = demo({
      name: "probe",
      order: -1,
      derive: (ctx) => {
        snapshot = ctx.consumed;
        return [span(0, 1)];
      },
    });
    const later = demo({
      name: "later",
      derive: (ctx) => {
        // 前一个特性的认领必须反映在位图里
        expect(ctx.consumed[0]).toBe(1);
        // 修改快照不应影响引擎/后续特性的真实占用
        ctx.consumed[1] = 1;
        return [];
      },
    });
    deriveInline("abc", { features: [probe, later] });
    // probe 拿到的是「它自己认领之前」的快照
    expect(snapshot![0]).toBe(0);
  });

  it("后续特性看不到前一个特性对快照的篡改", () => {
    const tamper = demo({
      name: "tamper",
      order: -1,
      derive: (ctx) => {
        ctx.consumed.fill(1);
        return [];
      },
    });
    let seen = -1;
    const check = demo({
      name: "check",
      derive: (ctx) => {
        seen = ctx.consumed[0]!;
        return [];
      },
    });
    deriveInline("abc", { features: [tamper, check] });
    expect(seen).toBe(0);
  });

  it("同 closeFrom 时按 openFrom 升序（核心在前）", () => {
    const zero = demo({
      name: "zero",
      order: -1,
      derive: () => [
        { type: "demo", from: 3, to: 3, openFrom: 3, openTo: 3, closeFrom: 3, closeTo: 3 },
      ],
    });
    // em 与零宽 demo 的 closeFrom 都是 3；openFrom 0 < 3 ⇒ 核心在前，
    // 与「旧扫描期后追加」的历史序一致（emoji 迁移后 `~:smile:~` 依赖这条）。
    expect(deriveInline("*ab*", { features: [zero] }).spans.map((s) => s.type)).toEqual([
      "em",
      "demo",
    ]);
  });
});
