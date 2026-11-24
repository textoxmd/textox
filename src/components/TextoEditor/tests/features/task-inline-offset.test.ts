// 行内原子节点（任务标记）之后的偏移映射回归测试。
//
// 任务项里的段落以 `task_marker` 原子节点开头：它占一个 PM 位置但不在
// textContent 里。normalize 若把 parseInline 的「文本偏移」直接当「内容偏移」
// 使用，原子节点之后的所有 span 都会整体左移，行内代码的闭合反引号隐藏区间
// 就会压到最后一个字母上（`abc` 的 c 不可见）。
import { expect, it } from "vitest";

import { createState } from "../../src/editor.ts";
import { getDelims } from "../../src/normalize.ts";
import { parse } from "../../src/parser.ts";
import { serialize } from "../../src/serializer.ts";

const BT = String.fromCharCode(96);
const code = (s: string) => BT + s + BT;

function live(src: string) {
  const s0 = createState(parse(src));
  return s0.apply(s0.tr);
}

function codeText(src: string): string {
  const s = live(src);
  const marked: string[] = [];
  s.doc.descendants((n) => {
    if (n.isText && n.marks.some((m) => m.type.name === "code")) {
      marked.push(n.text!);
    }
    return true;
  });
  return marked.join("");
}

function hiddenTexts(src: string): string[] {
  const s = live(src);
  return getDelims(s).map((d) => s.doc.textBetween(d.from, d.to, "", ""));
}

it("inline code in a task item marks all content", () => {
  const src = "- [ ] " + code("abc");
  expect(codeText(src)).toBe("abc");
  expect(serialize(live(src).doc)).toBe(src);
});

it("no hidden delimiter covers the last letter", () => {
  const src = "- [ ] " + code("abc");
  const hidden = hiddenTexts(src);
  expect(hidden).not.toContain("c");
  // 只应隐藏两个反引号分隔符。
  expect(hidden).toEqual([BT, BT]);
});

it("checked task and following text", () => {
  const src = "- [x] " + code("abc") + " tail";
  expect(codeText(src)).toBe("abc");
  expect(serialize(live(src).doc)).toBe(src);
});

it("plain paragraph is unaffected", () => {
  const src = code("abc") + " tail";
  expect(codeText(src)).toBe("abc");
  expect(serialize(live(src).doc)).toBe(src);
});

it("inline code before a hard break keeps its full content", () => {
  const src = code("abc") + "  \ntail";
  expect(codeText(src)).toBe("abc");
  expect(serialize(live(src).doc)).toBe(src);
});

it("inline code after a hard break maps past the atom", () => {
  const src = "head  \n" + code("abc");
  expect(codeText(src)).toBe("abc");
  expect(serialize(live(src).doc)).toBe(src);
});
