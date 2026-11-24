import { describe, expect, test } from "vitest";
import { parse } from "../src/parser.ts";
import { serialize, serializeHeadingLines } from "../src/serializer.ts";
import { headingPosToLine, lineColToPos, posToLineCol, posToMdOffset, mdOffsetToPos } from "../src/position.ts";

// 复现 issue 的文档：标题、链接、分隔线、CJK。
const outlineMd = `# 快速大綱跳轉演示

本文檔用於演示 Texto 的大綱視圖功能。通過大綱，你可以快速導航到文檔的任意章節。

[JUMP](#四級標題B-1-2)

[HTTPS](https://xxxxxxx.中國)

---

## 一級標題示例

這是一級標題下的內容。在大綱視圖中，一級標題會顯示為最頂層的節點。
`;

const codeMd = `before

\`\`\`js
const a = 1;
const b = 2;
\`\`\`

after`;

const listMd = `# Title

- item one
- item two

1. first
2. second

end`;

function headingsOf(doc: any): { text: string; pos: number }[] {
  const out: { text: string; pos: number }[] = [];
  doc.descendants((node: any, pos: number) => {
    if (node.type.name === "heading") out.push({ text: node.textContent, pos });
    return true;
  });
  return out;
}

describe("position mapping", () => {
  test("outline 文档：标题行号正确（issue 复现：`## 一級標題示例` 应定位到第 11 行）", () => {
    const doc = parse(outlineMd);
    const lines = serialize(doc).split("\n");
    for (const h of headingsOf(doc)) {
      const line = headingPosToLine(doc, h.pos);
      expect(lines[line - 1]).toContain(h.text);
    }
    const h2 = headingsOf(doc).find((h) => h.text === "一級標題示例")!;
    expect(headingPosToLine(doc, h2.pos)).toBe(11);
  });

  test("posToLineCol 光标在标题文本内落到标题行", () => {
    const doc = parse(outlineMd);
    const h2 = headingsOf(doc).find((h) => h.text === "一級標題示例")!;
    const lc = posToLineCol(doc, h2.pos + 1);
    expect(lc.line).toBe(11);
    expect(lc.col).toBe(3); // "## " 之后
  });

  test("块边界位置双向一致（不丢失位置）", () => {
    const doc = parse(outlineMd);
    const h2 = headingsOf(doc).find((h) => h.text === "一級標題示例")!;
    const { line, col } = posToLineCol(doc, h2.pos);
    const back = lineColToPos(doc, line, col);
    expect(Math.abs(back - h2.pos)).toBeLessThanOrEqual(1);
  });

  test("posToLineCol / lineColToPos 双向一致（全文扫描）", () => {
    const doc = parse(outlineMd);
    let worst = 0;
    for (let pos = 0; pos <= doc.content.size; pos++) {
      const { line, col } = posToLineCol(doc, pos);
      const back = lineColToPos(doc, line, col);
      worst = Math.max(worst, Math.abs(back - pos));
    }
    // 块边界本身有歧义，允许少量位置差；文本内部应精确
    expect(worst).toBeLessThanOrEqual(3);
  });

  test("代码块内部位置映射", () => {
    const doc = parse(codeMd);
    let codeStart = -1;
    doc.descendants((node: any, pos: number) => {
      if (node.type.name === "code_block") codeStart = pos + 1;
      return true;
    });
    expect(codeStart).toBeGreaterThan(0);
    const lc = posToLineCol(doc, codeStart + 5);
    const back = lineColToPos(doc, lc.line, lc.col);
    expect(Math.abs(back - (codeStart + 5))).toBeLessThanOrEqual(1);
  });

  test("列表文档标题行号", () => {
    const doc = parse(listMd);
    const lines = serialize(doc).split("\n");
    for (const h of headingsOf(doc)) {
      const line = headingPosToLine(doc, h.pos);
      expect(lines[line - 1]).toContain(h.text);
    }
  });

  test("mdOffsetToPos 是 posToMdOffset 的逆", () => {
    const doc = parse(outlineMd);
    const fullLen = serialize(doc).length;
    for (let off = 0; off <= fullLen; off += 7) {
      const pos = mdOffsetToPos(doc, off);
      const back = posToMdOffset(doc, pos);
      // 原子块（水平分隔线等）占 1 个文档位置却序列化成多字符（`\n\n---`），
      // 采样点正好落在这种块边界时逆映射会有一个块宽度的偏差（5）。
      expect(Math.abs(back - off)).toBeLessThanOrEqual(5);
    }
  });

  test("源码模式切换往返（renderedCursorToMdOffset ↔ mdOffsetToRenderedPos 语义）", () => {
    const doc = parse(outlineMd);
    const md = serialize(doc);
    // 复刻 enterSource/exitSource 的两次换算：
    // enterSource: renderedCursorToMdOffset = posToMdOffset(doc, sel.from)
    // exitSource:  mdOffsetToRenderedPos = mdOffsetToPos(parse(md), offset)
    for (let selFrom = 0; selFrom <= doc.content.size; selFrom += 5) {
      const offset = posToMdOffset(doc, selFrom);
      const back = mdOffsetToPos(parse(md), offset);
      expect(Math.abs(back - selFrom)).toBeLessThanOrEqual(2);
    }
  });

  test("serializeHeadingLines 与 posToLineCol 行号一致", () => {
    const doc = parse(outlineMd);
    const lines = serializeHeadingLines(doc);
    const headings: { pos: number }[] = [];
    doc.descendants((node: any, pos: number) => {
      if (node.type.name === "heading") headings.push({ pos });
      return true;
    });
    expect(lines.length).toBe(headings.length);
    headings.forEach((h, i) => {
      expect(lines[i]).toBe(posToLineCol(doc, h.pos + 1).line);
    });
  });

  // 文本块内容起点（每个块的第一列）必须精确：MCP 按行/列定位光标、IR↔SV 光标
  // 保持都依赖它。cut 序列化会丢掉「上一块与本块之间的空行」，曾使该位置少算两列。
  test("块内容起点精确：标题 / 引用 / 代码块之后的段落", () => {
    const cases = [
      { md: "# 标题\n\n第二行内容", line: 3, col: 0 },
      { md: "> 引用\n\n正文", line: 3, col: 0 },
      { md: "before\n\n```js\nconst a = 1;\n```\n\nafter", line: 7, col: 0 },
      { md: "text\n\n> quote\n\n# Head\n\nend", line: 7, col: 0 },
    ];
    for (const { md, line, col } of cases) {
      const doc = parse(md);
      let start = -1;
      doc.descendants((node: any, pos: number) => {
        const lc = posToLineCol(doc, pos + 1);
        if (node.isTextblock && node.content.size > 0 && lc.line === line) start = pos + 1;
        return true;
      });
      expect(start).toBeGreaterThan(0);
      expect(posToLineCol(doc, start)).toEqual({ line, col });
      expect(lineColToPos(doc, line, col)).toBe(start);
      const full = serialize(doc);
      const lineStart = full
        .split("\n")
        .slice(0, line - 1)
        .reduce((sum, text) => sum + text.length + 1, 0);
      expect(posToMdOffset(doc, start)).toBe(lineStart + col);
    }
  });
});
