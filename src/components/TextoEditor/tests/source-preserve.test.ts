import { beforeAll, describe, expect, test } from "vitest";
import { EditorState } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";

import { parse } from "../src/parser.ts";
import { getSchema } from "../src/schema.ts";

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});
import { serialize } from "../src/serializer.ts";
import {
  parseWithSource,
  preservedLineColToPos,
  preservedHeadingLines,
  preservedPosToLineCol,
  serializePreserving,
} from "../src/source-preserve.ts";

// ─────────────────────────────────────────────────────────────────────────────
// source-preserve 正式模块测试（由 POC 场景沉淀而来）。
// 每个编辑用例都断言两个不变量：
//   1) parse(P).eq(editedDoc) —— 输出可无损重解析回同一文档树；
//   2) P 相对 O 的差异只落在被编辑单元（未编辑区域逐字节保留）。
// ─────────────────────────────────────────────────────────────────────────────

function preserve(O: string, editedDoc: PMNode): string {
  const ctx = parseWithSource(O);
  expect(ctx.supported, `unsupported structure:\n${O}`).toBe(true);
  const P = serializePreserving(ctx, editedDoc);
  expect(P).not.toBeNull();
  return P!;
}

function replaceWord(doc: PMNode, word: string, repl: string): PMNode {
  const holder: { hit: { from: number; to: number } | null } = { hit: null };
  doc.descendants((node, pos) => {
    if (holder.hit) return false;
    if (!node.isTextblock) return true;
    const idx = node.textContent.indexOf(word);
    if (idx >= 0) {
      holder.hit = { from: pos + 1 + idx, to: pos + 1 + idx + word.length };
      return false;
    }
    return true;
  });
  if (!holder.hit) throw new Error(`word not found: ${word}`);
  const st = EditorState.create({ schema, doc });
  return st.apply(st.tr.insertText(repl, holder.hit.from, holder.hit.to)).doc;
}

function insertParagraphBefore(doc: PMNode, anchorText: string, insertText: string): PMNode {
  let blockStart = -1;
  doc.descendants((node, pos) => {
    if (blockStart >= 0) return false;
    if (node.isTextblock && node.textContent === anchorText) {
      blockStart = pos;
      return false;
    }
    return true;
  });
  if (blockStart < 0) throw new Error(`block not found: ${anchorText}`);
  const para = schema.nodes.paragraph.create(null, schema.text(insertText));
  const st = EditorState.create({ schema, doc });
  return st.apply(st.tr.insert(blockStart, para)).doc;
}

function deleteBlock(doc: PMNode, anchorText: string): PMNode {
  let blockStart = -1;
  let blockEnd = -1;
  doc.descendants((node, pos) => {
    if (blockStart >= 0) return false;
    if (node.isTextblock && node.textContent === anchorText) {
      blockStart = pos;
      blockEnd = pos + node.nodeSize;
      return false;
    }
    return true;
  });
  if (blockStart < 0) throw new Error(`block not found: ${anchorText}`);
  const st = EditorState.create({ schema, doc });
  return st.apply(st.tr.delete(blockStart, blockEnd)).doc;
}

const mixedDoc = [
  "# Title",
  "",
  "Some paragraph with **bold** and *italic*.",
  "",
  "* first",
  "* second",
  "",
  "1. one",
  "2. two",
  "",
  "",
  "~~~ts",
  "const x = 1;",
  "~~~",
  "",
  "> quote here",
  "",
  "---",
  "",
  "end paragraph",
  "",
].join("\n");

describe("source-preserve: canonical-diff + 原文拼接", () => {
  test("marker attr：`* `/`+ ` 创建的列表按原符号序列化", () => {
    const li = schema.nodes.list_item.create(
      null,
      schema.nodes.paragraph.create(null, schema.text("xxxxx")),
    );
    const star = schema.nodes.doc.create(
      null,
      schema.nodes.bullet_list.create({ marker: "*" }, li),
    );
    expect(serialize(star)).toBe("* xxxxx");
    const plus = schema.nodes.doc.create(
      null,
      schema.nodes.bullet_list.create({ marker: "+" }, li),
    );
    expect(serialize(plus)).toBe("+ xxxxx");
  });

  test("有序列表分隔符 `)` 保留", () => {
    const item1 = schema.nodes.list_item.create(
      null,
      schema.nodes.paragraph.create(null, schema.text("five")),
    );
    const item2 = schema.nodes.list_item.create(
      null,
      schema.nodes.paragraph.create(null, schema.text("six")),
    );
    const doc = schema.nodes.doc.create(
      null,
      schema.nodes.ordered_list.create({ start: 5, delimiter: ")" }, [item1, item2]),
    );
    expect(serialize(doc)).toBe("5) five\n6) six");
  });

  test("围栏 `~~~` 保留字符与长度", () => {
    const code = schema.nodes.code_block.createChecked(
      { lang: "ts", fence: "~", fenceLen: 3 },
      schema.text("const x = 1;"),
    );
    expect(serialize(schema.nodes.doc.create(null, code))).toBe("~~~ts\nconst x = 1;\n~~~");
  });

  test("分隔线 `***`/`___` variant 保留", () => {
    const star = schema.nodes.horizontal_rule.create({ variant: "*" });
    expect(serialize(schema.nodes.doc.create(null, star))).toBe("***");
    const under = schema.nodes.horizontal_rule.create({ variant: "_" });
    expect(serialize(schema.nodes.doc.create(null, under))).toBe("___");
  });

  test("未编辑：输出 === 原文（多空行/`*` 列表/`~~~` 围栏/引用块/分隔线）", () => {
    const doc = parse(mixedDoc);
    const P = preserve(mixedDoc, doc);
    expect(P).toBe(mixedDoc);
    expect(parse(P).eq(doc)).toBe(true);
  });

  test("单段改词：只有该段变化，其余逐字节保留", () => {
    const edited = replaceWord(parse(mixedDoc), "Some paragraph", "CHANGED paragraph");
    const P = preserve(mixedDoc, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe(mixedDoc.replace("Some paragraph", "CHANGED paragraph"));
  });

  test("CRLF 文件：未编辑行保留 \\r\\n，语义不变", () => {
    const O = "alpha\r\n\r\nbeta\r\n";
    const edited = replaceWord(parse(O), "beta", "B");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    // canonical 替换文本跟随文件主导 EOL，未编辑行逐字节保留
    expect(P).toBe("alpha\r\n\r\nB\r\n");
  });

  test("front matter + 正文：改正文不动 front matter", () => {
    const O = "---\ntitle: Hi\n---\n\nbody text\n";
    const edited = replaceWord(parse(O), "body text", "BODY text");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("---\ntitle: Hi\n---\n\nBODY text\n");
  });

  test("表格原子块：改表外段落，手排表格逐字保留", () => {
    const O = "intro\n\n| a  | bbb |\n| --- | --- |\n| 1  | 2   |\n\noutro\n";
    const edited = replaceWord(parse(O), "intro", "INTRO");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe(O.replace("intro", "INTRO"));
  });

  test("表格内改格：行级重写，表外原文保留", () => {
    const O = "intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\noutro\n";
    const edited = replaceWord(parse(O), "1", "X");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toContain("| X ");
    expect(P.startsWith("intro\n\n")).toBe(true);
    expect(P.endsWith("\n\noutro\n")).toBe(true);
  });

  test("表格行级：改一格只重写该行，其余行原文保留", () => {
    const O =
      "intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\noutro\n";
    const edited = replaceWord(parse(O), "3", "X");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    // 未编辑的 header/分隔行/首行保持原文（整表 canonical 会把它们 pad 成 3 格宽）
    expect(P).toContain("\n| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    expect(P).toContain("| X ");
    expect(P).not.toContain("| a   | b   |");
  });

  test("表格格级：编辑行内未变化的格保留原对齐空格", () => {
    const O =
      "intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 33 | 4    |\n\noutro\n";
    const edited = replaceWord(parse(O), "33", "3");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    // 第二格未变化：保留原文的空格宽度，而不是整行 canonical 重排
    expect(P).toContain("4    |");
  });

  test("多处同时编辑：表格仍行级、列表仍项级（不做整块 canonical）", () => {
    const O =
      "intro words\n\n| name | note |\n|-|-|\n| a | 1 |\n| b | 2 |\n\n* x one\n* y two\n\noutro words\n";
    const d1 = replaceWord(parse(O), "intro words", "INTRO words");
    const d2 = replaceWord(d1, "1", "X");
    const d3 = replaceWord(d2, "y", "Y");
    const edited = replaceWord(d3, "outro words", "OUTRO words");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    // 表格：原始分隔线与未编辑行保留（整表 canonical 会输出 | ---- |）
    expect(P).toContain("|-|-|");
    expect(P).toContain("| b | 2 |");
    expect(P).not.toContain("| ---- |");
    // 列表：未编辑项 marker/内容保留，编辑项继承 `*`
    expect(P).toContain("* x one");
    expect(P).toContain("* Y two");
    // 其他脏块各自局部
    expect(P).toContain("INTRO words");
    expect(P).toContain("OUTRO words");
  });

  test("旧表格替换为多行硬换行段落：不泄漏表格分隔行（协调器类型守卫）", () => {
    // 旧文档在该位置是表格（2 行），新文档替换为 3 行硬换行段落 —— 行数恰好
    // 与表格行数对齐会诱使表格协调器拼接，类型守卫必须拦住。
    const O = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\noutro\n";
    const editedMd = "x  \ny  \nz\n\noutro\n";
    const edited = parse(editedMd);
    const P = preserve(O, edited);
    expect(P).not.toContain("| --- |");
    expect(parse(P).eq(edited)).toBe(true);
    // 该位置应走 canonical（无表格格式泄漏）。
    expect(P).toBe(editedMd);
  });

  test("引用定义：编辑相邻后段，定义块逐字保留", () => {
    const O = 'Use [ref][1] now.\n\n[1]: https://example.com "title"\n\npara two\n';
    const edited = replaceWord(parse(O), "para two", "para TWO");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe('Use [ref][1] now.\n\n[1]: https://example.com "title"\n\npara TWO\n');
  });

  test("未编辑文档含未引用定义：freeform 原样保留（P === O，不触发伪 dirty）", () => {
    const O = "para one\n\n[ref]: https://example.com\n\npara two\n";
    const doc = parse(O);
    const P = preserve(O, doc);
    expect(P).toBe(O);
    expect(parse(P).eq(doc)).toBe(true);
  });

  test("删除引用所在段：游离定义 Phase 1 原样保留（惰性清理留待 Phase 2）", () => {
    const O = "para one\n\n[ref]: https://example.com\n\npara two\n";
    const edited = deleteBlock(parse(O), "para two");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toContain("[ref]: https://example.com");
    expect(P).toContain("para one");
  });

  test("引用段改写为纯文本：游离定义 Phase 1 原样保留（含 4 空格续行）", () => {
    const O = "Use [a][x].\n\n[x]: https://a.example.com\n[y]: https://b.example.com\n\nbody\n";
    const editedMd = O.replace("Use [a][x].", "plain");
    const edited = parse(editedMd);
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toContain("[x]: https://a.example.com");
    expect(P).toContain("[y]: https://b.example.com");
    expect(P).toContain("plain");
  });

  test("嵌套列表：改列表外段落，整个列表（含内部缩进/空行）逐字保留", () => {
    const O = "outer para\n\n- a\n  - a1\n  - a2\n- b\n\nafter\n";
    const edited = replaceWord(parse(O), "after", "AFTER");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe(O.replace("after", "AFTER"));
  });

  test("松散列表：改列表外段落，项间空行保留", () => {
    const O = "- a\n\n- b\n\npara\n";
    const edited = replaceWord(parse(O), "para", "PARA");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("- a\n\n- b\n\nPARA\n");
  });

  test("列表内改词（项级拼接）：其他项原文与 marker 保留", () => {
    const O = "intro\n\n* a\n* b\n* c\n\noutro\n";
    const edited = replaceWord(parse(O), "b", "B");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("intro\n\n* a\n* B\n* c\n\noutro\n");
  });

  test("嵌套列表内改外层项：该项整行区间重写，其他项原文保留", () => {
    const O = "outer para\n\n* a\n  * a1\n  * a2\n* b\n\nafter\n";
    const edited = replaceWord(parse(O), "b", "B");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe(O.replace("b", "B"));
  });

  test("起始序号列表内改词：编号继承原文", () => {
    const O = "5. five\n6. six\n\nafter\n";
    const edited = replaceWord(parse(O), "six", "SIX");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("5. five\n6. SIX\n\nafter\n");
  });

  test("松散列表内改末项：项间空行与首项原文保留", () => {
    const O = "- a\n\n- b\n\npara\n";
    const edited = replaceWord(parse(O), "b", "B");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("- a\n\n- B\n\npara\n");
  });

  test("列表项含缩进代码块：改项内词不吞并后续内容", () => {
    const O = "- item one\n\n      code line\n\n- item two\n\nafter\n";
    const edited = replaceWord(parse(O), "one", "ONE");
    const P = preserve(O, edited);
    expect(P).not.toBeNull();
    expect(parse(P!).eq(edited)).toBe(true);
    expect(P!.includes("- item two")).toBe(true);
    expect(P!.includes("code line")).toBe(true);
  });

  test("CRLF 列表：编辑一项时未编辑项与 \\r\\n 逐字保留", () => {
    const O = "intro\r\n\r\n* a\r\n* b\r\n* c\r\n\r\noutro\r\n";
    const edited = replaceWord(parse(O), "b", "B");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("intro\r\n\r\n* a\r\n* B\r\n* c\r\n\r\noutro\r\n");
  });

  test("引用块内改段落：只重写该段，`>` 空行与相邻段原文保留", () => {
    const O = "> first quote\n>\n> second quote\n\nbody\n";
    const edited = replaceWord(parse(O), "second quote", "SECOND quote");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe(O.replace("second quote", "SECOND quote"));
  });

  test("引用块内改首段：未编辑段（含特殊间距）原文保留", () => {
    const O = ">  spaced first\n>\n> plain second\n\nbody\n";
    const edited = replaceWord(parse(O), "spaced first", "spaced FIRST");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toContain("\n> plain second\n");
    expect(P.startsWith("> ")).toBe(true);
  });

  test("中间插入整段：前后锚点原文保留", () => {
    const O = "alpha\n\nbeta\n\ngamma\n";
    const edited = insertParagraphBefore(parse(O), "beta", "INSERTED");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("alpha\n\nINSERTED\n\nbeta\n\ngamma\n");
  });

  test("删除中间整段：空行收敛为 canonical 单空行", () => {
    const O = "alpha\n\nbeta\n\ngamma\n";
    const edited = deleteBlock(parse(O), "beta");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("alpha\n\ngamma\n");
  });

  test("两处独立编辑：中间锚点原文保留", () => {
    const O = "one\n\ntwo\n\nthree\n\nfour\n";
    const d1 = replaceWord(parse(O), "one", "ONE");
    const d2 = replaceWord(d1, "four", "FOUR");
    const P = preserve(O, d2);
    expect(parse(P).eq(d2)).toBe(true);
    expect(P).toBe("ONE\n\ntwo\n\nthree\n\nFOUR\n");
  });

  test("文档末尾多空行：末块 clean 时逐字保留，dirty 时 canonical 收尾", () => {
    const Oclean = "a\n\nb\n\n\n";
    expect(preserve(Oclean, parse(Oclean))).toBe(Oclean);

    const edited = replaceWord(parse(Oclean), "b", "B");
    const P = preserve(Oclean, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("a\n\nB\n");
  });

  test("脏块相邻的多空行按原文保留（>1 不再收敛为单空行）", () => {
    const O = "alpha\n\n\n\nbeta\n\n\n\ngamma\n";
    const edited = replaceWord(parse(O), "beta", "BETA");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe(O.replace("beta", "BETA"));
  });

  test("松散列表首项被替换：项间空行保留", () => {
    const O = "- apple\n\n- banana\n\nafter\n";
    const edited = replaceWord(parse(O), "apple", "APPLE");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("- APPLE\n\n- banana\n\nafter\n");
  });

  test("标题与段落无空行相邻：段落编辑不插入空行", () => {
    const O = "# H1\n[H1](h1.md)\n";
    const editedMd = O.replace("[H1](h1.md)", "[H2](h1.md)");
    const edited = parse(editedMd);
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("# H1\n[H2](h1.md)\n");
  });

  test("标题被编辑：与相邻段仍保持紧贴", () => {
    const O = "# H1\npara\n";
    const editedMd = O.replace("# H1", "# H1X");
    const edited = parse(editedMd);
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("# H1X\npara\n");
  });

  test("空/不支持结构：serializePreserving 返回 null（调用方回退 canonical）", () => {
    const ctx = parseWithSource("");
    // 空内容 parse 后 doc 无顶层块区间覆盖，按不支持处理并回退。
    expect(ctx.supported).toBe(false);
    expect(serializePreserving(ctx, ctx.doc)).toBeNull();
  });

  test("preservedHeadingLines：行号映射到保真输出（松散列表空行不再错位）", () => {
    const O = "# One\n\n- a\n\n- b\n\n# Two\n\ntext\n";
    const ctx = parseWithSource(O);
    expect(ctx.supported).toBe(true);
    expect(preservedHeadingLines(ctx, ctx.doc)).toEqual([1, 7]);

    const edited = replaceWord(parse(O), "text", "TEXT");
    expect(preservedHeadingLines(ctx, edited)).toEqual([1, 7]);
  });

  test("preservedHeadingLines：嵌套标题无法精确映射时返回 null", () => {
    const O = "> # Quote Heading\n\nbody\n";
    const ctx = parseWithSource(O);
    expect(ctx.supported).toBe(true);
    expect(preservedHeadingLines(ctx, ctx.doc)).toBeNull();
  });

  test("preservedPosToLineCol：松散列表后的标题与项内光标映射到 P 行号", () => {
    const O = "# One\n\n- a\n\n- b\n\n# Two\n\ntext\n";
    const ctx = parseWithSource(O);
    let twoPos = -1;
    let bPos = -1;
    ctx.doc.descendants((node, pos) => {
      if (twoPos >= 0 && bPos >= 0) return false;
      if (node.type.name === "heading" && node.textContent === "Two") twoPos = pos;
      if (node.isText && node.text === "b") bPos = pos;
      return true;
    });
    expect(twoPos).toBeGreaterThan(0);
    expect(bPos).toBeGreaterThan(0);

    const heading = preservedPosToLineCol(ctx, ctx.doc, twoPos + 1);
    expect(heading).toEqual({ line: 7, col: 2 });
    const item = preservedPosToLineCol(ctx, ctx.doc, bPos);
    expect(item?.line).toBe(5);

    const back = preservedLineColToPos(ctx, ctx.doc, 7, 2);
    expect(back).not.toBeNull();
    expect(Math.abs(back! - (twoPos + 1))).toBeLessThanOrEqual(1);
  });

  test("preservedLineColToPos：标题后段落首列落到内容起点（不右移一个字符）", () => {
    const O = "# One\n\ntext\n";
    const ctx = parseWithSource(O);
    let textStart = -1;
    ctx.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "text") textStart = pos + 1;
      return true;
    });
    expect(textStart).toBeGreaterThan(0);

    // 行 3 列 0（1 起列 0 起，与编辑器内部一致）应是段落内容起点，
    // 而不是「首字符之后」——后者会让插入文字落到第一个字后面。
    const pos = preservedLineColToPos(ctx, ctx.doc, 3, 0);
    expect(pos).toBe(textStart);
    expect(preservedPosToLineCol(ctx, ctx.doc, pos!)).toEqual({ line: 3, col: 0 });
    expect(preservedLineColToPos(ctx, ctx.doc, 3, 1)).toBe(textStart + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 场景补充：硬换行 / 内联数学 / 数学块 / [TOC] / 图片引用块 / HTML 块 /
// 脚注 / 任务列表 / 起始序号 / 引用链接
// ─────────────────────────────────────────────────────────────────────────────

const kitchenSink = [
  "# Kitchen Sink",
  "",
  "Bold **b**, em *i*, code `c`, ==mark==, ~~strike~~, H~2~O, E=mc^2^, $x=1$, :rocket:.",
  "",
  "hard break line one  ",
  "line two continues",
  "",
  "---",
  "",
  "* alpha",
  "* beta",
  "",
  "5. five",
  "6. six",
  "",
  "- [ ] todo",
  "- [x] done",
  "",
  "> quote one",
  ">",
  "> quote two",
  "",
  "    indented code line",
  "",
  "```ts",
  "const a: number = 1;",
  "```",
  "",
  "$$",
  "e = mc^2",
  "$$",
  "",
  "<div>",
  "raw html",
  "</div>",
  "",
  "![img](/path/pic.png)",
  "",
  "Body with footnote[^1].",
  "",
  "[^1]: the footnote text",
  "",
  "tail",
  "",
].join("\n");

describe("source-preserve: 其余场景", () => {
  test("kitchen sink 未编辑：输出 === 原文", () => {
    const doc = parse(kitchenSink);
    const P = preserve(kitchenSink, doc);
    expect(P).toBe(kitchenSink);
    expect(parse(P).eq(doc)).toBe(true);
  });

  test("硬换行段落改词：`  \\n` 原文保留", () => {
    const editedMd = kitchenSink.replace("line two", "line TWO");
    const edited = parse(editedMd);
    const P = preserve(kitchenSink, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe(editedMd);
  });

  test("内联数学内部改词：mark 保留，`$...$` 原文形态不变", () => {
    const editedMd = kitchenSink.replace("$x=1$", "$y=1$");
    const edited = parse(editedMd);
    const P = preserve(kitchenSink, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe(editedMd);
  });

  test("[TOC] 大写未编辑：逐字保留", () => {
    const O = "# A\n\n[TOC]\n\nbody\n";
    const edited = replaceWord(parse(O), "body", "BODY");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe("# A\n\n[TOC]\n\nBODY\n");
  });

  test("数学块 / HTML 块 / 缩进代码 / 图片引用：未编辑时逐字保留", () => {
    const edited = replaceWord(parse(kitchenSink), "tail", "TAIL");
    const P = preserve(kitchenSink, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe(kitchenSink.replace("tail", "TAIL"));
  });

  test("任务列表 / `*` 列表 / 起始序号列表：改尾部段落时逐字保留", () => {
    const O = "- [ ] todo\n- [x] done\n\n* a\n* b\n\n5. five\n6. six\n\nafter\n";
    const edited = replaceWord(parse(O), "after", "AFTER");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe(O.replace("after", "AFTER"));
  });

  test("脚注：改正文引用段，脚注定义逐字保留（md-it 重定位由 freeform 吸收）", () => {
    const O = "Body with footnote[^1].\n\n[^1]: the footnote text\n\nafter\n";
    const editedMd = O.replace("footnote[^1]", "footnote AGAIN[^1]");
    const edited = parse(editedMd);
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toBe(editedMd);
  });

  test("多段脚注定义：未编辑时逐字保留", () => {
    const O = "Body with footnote[^1].\n\n[^1]: first para\n\n    second para\n\nbody\n";
    const doc = parse(O);
    const P = preserve(O, doc);
    expect(P).toBe(O);
    expect(parse(P).eq(doc)).toBe(true);
  });

  test("引用链接段落改词：引用折叠为内联，游离定义 Phase 1 原样保留", () => {
    const O = "Use [ref][1] here.\n\n[1]: https://example.com\n\nafter\n";
    const edited = replaceWord(parse(O), "here", "HERE");
    const P = preserve(O, edited);
    expect(parse(P).eq(edited)).toBe(true);
    expect(P).toContain("Use [ref](https://example.com) HERE.");
    expect(P).toContain("[1]: https://example.com");
  });
});
