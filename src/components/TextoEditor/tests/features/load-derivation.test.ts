import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Node as PMNode } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import { resetExtensionPointsForTests } from "@texto/plugin-sdk";

import { createState } from "../../src/editor.ts";
import {
  parse,
  parseInlineTokens,
  parseTokens,
  resetParserForTests,
} from "../../src/parser.ts";
import { parseInlineWith } from "../../src/inline-parse.ts";
import { getDelims, getExtras, getWidgets } from "../../src/normalize.ts";
import { getSchema } from "../../src/schema.ts";
import {
  deriveCallCountForTests,
  deriveInline,
  resetDeriveCallCountForTests,
} from "../../src/features/inline-derive.ts";
import {
  collectDeriveFeatures,
  collectTokenAdvances,
  resetFeaturesForTests,
} from "../../src/features/index.ts";
import { assembleLoad } from "../../src/features/load-assemble.ts";
import {
  peekLoadDerivation,
  sameInlineTokens,
} from "../../src/features/load-derivation.ts";
import { bootstrapPluginsForTests } from "../plugins-setup";

beforeEach(() => {
  bootstrapPluginsForTests();
});

afterEach(() => {
  resetExtensionPointsForTests();
  resetFeaturesForTests();
  resetParserForTests();
});

function textblocks(doc: PMNode): PMNode[] {
  const out: PMNode[] = [];
  doc.descendants((node) => {
    if (node.isTextblock) out.push(node);
    return true;
  });
  return out;
}

describe("load-time derivation cache", () => {
  it("parse 登记、normalize init 消费（参考式块登记文本派生）", () => {
    const doc = parse("plain\n\na *b* c\n\nsee [t][id]\n\n[id]: https://x.example\n");
    const [plain, bold, ref] = textblocks(doc);

    expect(peekLoadDerivation(plain!)).toBe(true);
    expect(peekLoadDerivation(bold!)).toBe(true);
    // 参考式 canonical 化的块回退到文本派生，登记的是 push 实际用的那一份。
    expect(peekLoadDerivation(ref!)).toBe(true);

    createState(doc);
    for (const block of textblocks(doc)) {
      expect(peekLoadDerivation(block)).toBe(false);
    }
  });

  it("首帧仍有 mark（复用不改渲染）", () => {
    const state = createState(parse("a **b** c"));
    let strong = false;
    state.doc.descendants((node) => {
      if (node.isText && node.text === "b") {
        strong = node.marks.some((m) => m.type.name === "strong");
      }
      return true;
    });
    expect(strong).toBe(true);
  });

  it("env 改变了分词时登记文本派生（首帧与 normalize 一致）", () => {
    // 脚注定义存在时，block 期把 `[^1]` 与两侧 `^…^` 分在同一边界里；按空 env
    // 重新分词则 sup 会在 `[^` 的 `^` 处提前收口。两条路径的派生不等价，必须
    // 回退到文本派生（并登记同一份），否则首帧会多出 footnote_ref mark。
    const doc = parse("a^b[^1]c^d\n\n[^1]: note\n");
    const [block] = textblocks(doc);
    expect(peekLoadDerivation(block!)).toBe(true);

    let footnoteMark = false;
    doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === "footnote_ref")) {
        footnoteMark = true;
      }
      return true;
    });
    expect(footnoteMark).toBe(false);

    createState(doc);
    expect(peekLoadDerivation(block!)).toBe(false);
  });
});

const CORPUS: string[] = [
  "plain",
  "a *b* **c** ~~d~~",
  "`code` and ``a`b``",
  '[t](u) [t](u "ti") <https://a.b/~x~>',
  '![a](x.png "ti")',
  "a  \\nb",
  "a\\nb",
  "a \\* b",
  "==x== <u>u</u>",
  "H~2~O x^2^ ~a\\ b~",
  "$x^2$ \\(y\\)",
  ":smile: \\:smile:",
  "note[^a]\n\n[^a]: def",
  "see [def]\n\n[def]: https://x.example",
  "a^b[^1]c^d\n\n[^1]: note",
  "![a^b[^1]c^d](x.png)\n\n[^1]: note",
  "a <!-- c --> b",
];

describe("token derivation === text derivation (only when reusable)", () => {
  it.each(CORPUS)("%j", (src) => {
    for (const token of parseTokens(src)) {
      if (token.type !== "inline" || !token.children?.length) continue;
      const load = assembleLoad(token.children, token.content);
      // 会复用的块才需要等价；canonical 化的块走第二条路径。
      if (!load || !load.reusable) continue;
      // 门禁（与实现一致）：token 流必须与空 env 分词逐项一致才允许复用。
      if (!sameInlineTokens(token.children, parseInlineTokens(token.content))) continue;

      const fromTokens = deriveInline(token.content, {
        tokens: token.children,
        tokenAdvances: collectTokenAdvances(),
        features: collectDeriveFeatures(),
      });
      const fromText = parseInlineWith(token.content, null);

      expect(fromTokens.spans).toEqual(fromText.spans);
      expect(fromTokens.atoms).toEqual(fromText.atoms);
      expect([...fromTokens.consumed]).toEqual([...fromText.consumed]);
    }
  });
});

describe("reuse gate", () => {
  it("图片 alt 内的 env 分词差异也会被门禁拦下（回退文本派生并登记）", () => {
    const src = "![a^b[^1]c^d](x.png)\n\n[^1]: note\n";
    const token = parseTokens(src).find((t) => t.type === "inline")!;
    expect(sameInlineTokens(token.children!, parseInlineTokens(token.content))).toBe(false);

    const doc = parse(src);
    const [block] = textblocks(doc);
    // 门禁拒绝 token 派生，但 push 回退用的文本派生同样可交给 normalize。
    expect(peekLoadDerivation(block!)).toBe(true);
    createState(doc);
    expect(peekLoadDerivation(block!)).toBe(false);
  });

  it("普通块的 token 流与空 env 分词一致", () => {
    const token = parseTokens("a **b** c").find((t) => t.type === "inline")!;
    expect(sameInlineTokens(token.children!, parseInlineTokens(token.content))).toBe(true);
  });
});

describe("load derivation coverage", () => {
  it("普通块只 derive 一次（assembly）", () => {
    resetDeriveCallCountForTests();
    createState(parse("a *b* c\n\nd *e* f"));
    expect(deriveCallCountForTests()).toBe(2); // 2 块 × 1
  });

  it("参考式 canonical 化块 derive 两次（assembly + 文本派生），normalize 复用", () => {
    resetDeriveCallCountForTests();
    createState(parse("see [t][id]\n\n[id]: https://x.example\n"));
    expect(deriveCallCountForTests()).toBe(2);
  });

  it("env 分词不一致块 derive 两次（assembly + 文本派生），normalize 复用", () => {
    resetDeriveCallCountForTests();
    createState(parse("a^b[^1]c^d\n\n[^1]: note\n"));
    expect(deriveCallCountForTests()).toBe(2);
  });

  it("硬换行块 derive 两次（不登记）", () => {
    resetDeriveCallCountForTests();
    createState(parse("a *b*  \nc"));
    expect(deriveCallCountForTests()).toBe(2);
  });

  it("硬换行块不登记（源码偏移无法用于 textContent）", () => {
    const [block] = textblocks(parse("a *b*  \nc"));
    expect(peekLoadDerivation(block!)).toBe(false);
  });
});

describe("cached plan === fresh text derivation", () => {
  function planSnapshot(state: EditorState): unknown {
    return {
      doc: state.doc.toJSON(),
      delims: getDelims(state),
      extras: getExtras(state),
      widgets: getWidgets(state),
    };
  }

  // 重建 doc（新节点、无缓存条目）⇒ normalize 只能走 parseInlineWith 文本派生。
  function withoutLoadCache(doc: PMNode): PMNode {
    return getSchema().nodeFromJSON(doc.toJSON())!;
  }

  it.each(CORPUS)("%j", (src) => {
    const doc = parse(src);
    const cached = createState(doc);
    const fresh = createState(withoutLoadCache(doc));
    // 一次空事务触发 normalize 的 mark 对账；两个 state 的 doc/装饰必须一致。
    expect(planSnapshot(cached.apply(cached.tr))).toEqual(planSnapshot(fresh.apply(fresh.tr)));
  });
});
