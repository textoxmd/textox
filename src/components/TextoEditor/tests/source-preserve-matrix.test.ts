import { beforeAll, describe, expect, test } from "vitest";
import { EditorState } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";

import { parse } from "../src/parser.ts";
import { getSchema } from "../src/schema.ts";

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});
import { parseWithSource, serializePreserving } from "../src/source-preserve.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 穷举矩阵测试（确定性，无随机）：
// 每个语料 × 每类结构 × 每个位置，枚举全部单步编辑；小文档另做“两处编辑”
// 的有序组合。每个用例只断言两条机械不变式：
//   1) parse(P).eq(doc)
//   2) 无变化时 P === O
// ─────────────────────────────────────────────────────────────────────────────

const fixtures: Array<{ name: string; md: string; keep?: string[] }> = [
  {
    name: "paragraphs",
    md: "alpha one\n\nbeta two\n\ngamma three\n\ndelta four\n",
  },
  {
    name: "heading link adjacency (simple repro)",
    md: "# H1\n[H1](h1.md)\n",
  },
  {
    name: "atx + setext headings",
    md: "# One heading\n\nTwo heading\n===\n\nThree heading\n---\n\ntext after\n",
  },
  {
    name: "bullet + loose list",
    md: "- apple one\n- banana two\n\n- cherry three\n\n- date four\n\nbody words\n",
  },
  {
    name: "star bullet syntax",
    md: "* alpha one\n* beta two\n* gamma three\n\nend words\n",
    keep: ["* beta two", "* gamma three"],
  },
  {
    name: "plus bullet syntax",
    md: "+ alpha one\n+ beta two\n\nend words\n",
    keep: ["+ beta two"],
  },
  {
    name: "ordered start + task list",
    md: "5. five words\n6. six words\n\n- [ ] todo one\n- [x] done two\n\nafter words\n",
  },
  {
    name: "ordered paren syntax",
    md: "5) five words\n6) six words\n\nend words\n",
    keep: ["5) ", "6) "],
  },
  {
    name: "nested list",
    md: "- outer one\n  - inner alpha\n  - inner beta\n- outer two\n\nend words\n",
  },
  {
    name: "list item with code block",
    md: "- item one\n\n      code line\n      more code\n\n- item two\n\nbody words\n",
  },
  {
    name: "table",
    md: "| head a | head b |\n| --- | --- |\n| cell one | cell two |\n| cell three | cell four |\n\noutro words\n",
  },
  {
    name: "quote paragraphs",
    md: "> quoted alpha\n>\n> quoted beta\n\nbody words\n",
  },
  {
    name: "front matter + fenced code + hr",
    md: "---\ntitle: Hi\n---\n\nintro words\n\n```ts\nconst x = 1;\n```\n\n---\n\noutro words\n",
  },
  {
    name: "tilde fence + hr variants",
    md: "intro words\n\n~~~ts\nconst x = 1;\n~~~\n\n***\n\n___\n\noutro words\n",
    keep: ["~~~ts", "~~~", "***", "___"],
  },
  {
    name: "reference definitions",
    md: "Use [ref][1] here.\n\n[1]: https://example.com\n\nbody words\n",
  },
  {
    name: "unused reference definition",
    md: "use one\n\n[forgotten]: https://example.com\n\nbody words\n",
  },
  {
    name: "footnote definition",
    md: "Body words with note[^1].\n\n[^1]: footnote body\n\ntail words\n",
  },
  {
    name: "CRLF paragraphs",
    md: "alpha one\r\n\r\nbeta two\r\n\r\ngamma three\r\n",
  },
];

const plainRe = /^[A-Za-z0-9 .,;:!?'"-]+$/;
const wordRe = /[A-Za-z]{3,}/;
const replacement = "matrix";

function apply(doc: PMNode, tr: (s: EditorState) => void): PMNode {
  const state = EditorState.create({ schema, doc });
  const next = state;
  tr(next);
  return state.apply(state.tr).doc;
}

function replaceIn(doc: PMNode, from: number, to: number): PMNode {
  return apply(doc, (s) => {
    s.tr.insertText(replacement, from, to);
  });
}

function childStart(doc: PMNode, idx: number): number {
  let pos = 0;
  for (let i = 0; i < idx; i++) pos += doc.child(i).nodeSize;
  return pos;
}

/** 允许 `* `/`+ `/`1. `/`1) ` 前缀后为纯文本的行内 word 定位（绝对 doc 位置）。 */
function firstWordTarget(text: string, textStartPos: number): { from: number; to: number } | null {
  const cleaned = text.replace(/^(?:[-*+]\s|\d+[.)]\s)/, "");
  if (!plainRe.test(cleaned)) return null;
  const m = wordRe.exec(cleaned);
  if (!m) return null;
  const prefixLen = text.length - cleaned.length;
  const from = textStartPos + prefixLen + m.index;
  return { from, to: from + m[0].length };
}

/** 在指定顶层子块内找第一个“纯文本 word”区间（绝对 doc 位置）。 */
function firstWordInChild(doc: PMNode, childIdx: number): { from: number; to: number } | null {
  const child = doc.child(childIdx);
  const base = childStart(doc, childIdx);
  let hit: { from: number; to: number } | null = null;
  child.descendants((node, pos) => {
    if (hit) return false;
    if (!node.isTextblock) return true;
    const target = firstWordTarget(node.textContent, base + pos + 1);
    if (target) {
      hit = target;
      return false;
    }
    return true;
  });
  return hit;
}

function allPlainWords(doc: PMNode): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (!plainRe.test(node.textContent)) return true;
    const m = wordRe.exec(node.textContent);
    if (m) out.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + m[0].length });
    return true;
  });
  return out;
}

function allLinkLabels(doc: PMNode): Array<{ from: number; to: number; marks: readonly import("prosemirror-model").Mark[] }> {
  const out: Array<{ from: number; to: number; marks: readonly import("prosemirror-model").Mark[] }> = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const re = /\[([A-Za-z0-9 ]+)\]\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(node.textContent))) {
      const from = pos + 1 + m.index + 1;
      out.push({ from, to: from + m[1]!.length, marks: doc.resolve(from).marks() });
    }
    return true;
  });
  return out;
}

function insertParagraphAt(doc: PMNode, beforeChildIdx: number, after = false): PMNode {
  const idx = Math.max(0, Math.min(doc.childCount, beforeChildIdx + (after ? 1 : 0)));
  let pos = 0;
  for (let i = 0; i < idx; i++) pos += doc.child(i).nodeSize;
  const para = schema.nodes.paragraph.create(null, schema.text("matrix insert words"));
  return apply(doc, (s) => {
    s.tr.insert(pos, para);
  });
}

function deleteChild(doc: PMNode, idx: number): PMNode {
  const start = childStart(doc, idx);
  const size = doc.child(idx).nodeSize;
  return apply(doc, (s) => {
    s.tr.delete(start, start + size);
  });
}

function check(label: string, O: string, ctx: ReturnType<typeof parseWithSource>, doc: PMNode): string {
  const P = serializePreserving(ctx, doc);
  expect(P, `${label} → null\nO:\n${O}`).not.toBeNull();
  expect(
    parse(P!).eq(doc),
    `${label} parse mismatch\nO:\n${O}\nP:\n${P}`,
  ).toBe(true);
  if (doc.eq(ctx.doc)) expect(P).toBe(O);
  return P!;
}

function assertKept(P: string, fixture: (typeof fixtures)[number], label: string): void {
  for (const frag of fixture.keep ?? []) {
    expect(P.includes(frag), `${label}: 缺少保留片段 ${JSON.stringify(frag)}\nP:\n${P}`).toBe(true);
  }
}

describe("source-preserve 穷举矩阵", () => {
  for (const fixture of fixtures) {
    test(`${fixture.name}: 全部单步编辑`, () => {
      const ctx = parseWithSource(fixture.md);
      expect(ctx.supported, `unsupported:\n${fixture.md}`).toBe(true);
      const base = ctx.doc;

      // 0) 零编辑：输出必须逐字节 === 原文（App 的 dirty 严格比较依赖此不变量）
      check(`${fixture.name}: no edit`, fixture.md, ctx, base);

      // 1) 每个顶层块的文本替换（首词）
      for (let i = 0; i < base.childCount; i++) {
        const hit = firstWordInChild(base, i);
        if (!hit) continue;
        const P = check(`${fixture.name}: replace child ${i}`, fixture.md, ctx, replaceIn(base, hit.from, hit.to));
        assertKept(P, fixture, `${fixture.name}: replace child ${i}`);
      }

      // 2) 纯文本 word 全部替换（含列表项/表格格/引用段等嵌套文本）
      for (const hit of allPlainWords(base)) {
        const P = check(`${fixture.name}: replace word @${hit.from}`, fixture.md, ctx, replaceIn(base, hit.from, hit.to));
        assertKept(P, fixture, `${fixture.name}: replace word @${hit.from}`);
      }

      // 3) 链接 label 替换（保留 marks）
      for (const hit of allLinkLabels(base)) {
        const doc = apply(base, (s) => {
          s.tr.replaceWith(hit.from, hit.to, schema.text("matrix", hit.marks));
        });
        check(`${fixture.name}: replace link label @${hit.from}`, fixture.md, ctx, doc);
      }

      // 4) 每个顶层块前后插入段落 / 删除该块
      for (let i = 0; i < base.childCount; i++) {
        check(`${fixture.name}: insert before ${i}`, fixture.md, ctx, insertParagraphAt(base, i));
        check(`${fixture.name}: insert after ${i}`, fixture.md, ctx, insertParagraphAt(base, i, true));
        if (base.childCount > 1) {
          check(`${fixture.name}: delete child ${i}`, fixture.md, ctx, deleteChild(base, i));
        }
      }

      // 5) 两处编辑的有序组合（小文档全枚举；替换第 i、j 个顶层块首词）
      if (base.childCount <= 4) {
        for (let i = 0; i < base.childCount; i++) {
          for (let j = 0; j < base.childCount; j++) {
            const h1 = firstWordInChild(base, i);
            if (!h1) continue;
            const doc1 = replaceIn(base, h1.from, h1.to);
            const h2 = firstWordInChild(doc1, j);
            if (!h2) continue;
            const doc2 = replaceIn(doc1, h2.from, h2.to);
            check(`${fixture.name}: pair (${i},${j})`, fixture.md, ctx, doc2);
          }
        }
      }
    });
  }
});
