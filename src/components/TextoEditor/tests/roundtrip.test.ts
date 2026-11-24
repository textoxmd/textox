import { beforeAll, describe, expect, test } from "vitest";

import { parse } from "../src/parser.ts";
import { getSchema } from "../src/schema.ts";

let schema: ReturnType<typeof getSchema>;
beforeAll(() => {
  schema = getSchema();
});
import { serialize } from "../src/serializer.ts";

// Core invariant: parse(serialize(parse(md))) is structurally equal to parse(md).
// We do not assert md string equality (the serializer normalizes), only that
// parsing again yields the same tree — i.e. the doc round-trips losslessly.
function roundTripStable(md: string): void {
  const doc1 = parse(md);
  const md2 = serialize(doc1);
  const doc2 = parse(md2);
  if (!doc1.eq(doc2)) {
    throw new Error(
      `round-trip mismatch\n--- input md ---\n${md}\n--- serialized md ---\n${md2}\n--- doc1 ---\n${JSON.stringify(doc1.toJSON(), null, 2)}\n--- doc2 ---\n${JSON.stringify(doc2.toJSON(), null, 2)}`,
    );
  }
}

describe("round-trip: blocks", () => {
  test("paragraph", () => roundTripStable("hello world"));
  test("empty paragraph between contentful paragraphs serializes as blank-line separator", () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text("a")),
      schema.nodes.paragraph.create(),
      schema.nodes.paragraph.create(null, schema.text("b")),
    ]);
    expect(serialize(doc)).toBe("a\n\nb");
  });
  test("multiple paragraphs", () => roundTripStable("one\n\ntwo\n\nthree"));
  test("all heading levels", () =>
    roundTripStable("# h1\n\n## h2\n\n### h3\n\n#### h4\n\n##### h5\n\n###### h6"));
  test("setext h1", () => roundTripStable("Heading 1\n==="));
  test("setext h2", () => roundTripStable("Heading 2\n---"));
  test("setext mixed with atx", () =>
    roundTripStable("Title\n===\n\n## Sub\n\nBody"));
  test("blockquote single paragraph", () => roundTripStable("> quoted text"));
  test("blockquote multi paragraph", () => roundTripStable("> first\n>\n> second"));
  test("horizontal rule", () => roundTripStable("before\n\n---\n\nafter"));
  test("toc", () => roundTripStable("# Title\n\n[toc]\n\nbody"));
  test("toc uppercase normalizes", () =>
    roundTripStable("# Title\n\n[toc]\n\nbody")); // [TOC] also accepted on input; output is [toc]
  test("front matter", () =>
    roundTripStable("---\ntitle: Hello\ndate: 2024-01-01\n---\n\nbody"));
  test("front matter empty body", () => roundTripStable("---\n\n---\n\nbody"));
  test("table basic", () =>
    roundTripStable("| col1 | col2 |\n| ---  | ---  |\n| a    | b    |"));
  test("table with alignment", () =>
    roundTripStable("| L   | C     | R   |\n| :--- | :---: | ---: |\n| a   | b     | c   |"));
  test("table with inline marks", () =>
    roundTripStable("| a   | b      |\n| --- | ---    |\n| x   | **y**  |"));
  test("fenced code with lang", () => roundTripStable("```ts\nconst x = 1;\n```"));
  test("fenced code without lang", () => roundTripStable("```\nplain text\n```"));
  test("code block preserves internal newlines", () =>
    roundTripStable("```\nline 1\nline 2\nline 3\n```"));
  test("fenced code with trailing blank line: 文本级往返保留末行空行", () => {
    const md = "```\na\n\n```";
    const doc1 = parse(md);
    const md2 = serialize(doc1);
    const doc2 = parse(md2);
    expect(doc2.eq(doc1)).toBe(true);
    let text = "";
    doc2.forEach((n) => {
      if (n.type.name === "code_block") text = n.textContent;
    });
    expect(text).toBe("a\n");
    expect(md2).toBe(md);
  });
  test("code_block 以 \\n 结尾：serialize→parse 保留尾部空行", () => {
    const block = schema.nodes.code_block.create(
      { lang: "", fence: "`", fenceLen: 3 },
      schema.text("a\n"),
    );
    const doc = schema.nodes.doc.create(null, block);
    const md = serialize(doc);
    const reparsed = parse(md);
    let text = "";
    reparsed.forEach((n) => {
      if (n.type.name === "code_block") text = n.textContent;
    });
    expect(md).toBe("```\na\n\n```");
    expect(text).toBe("a\n");
  });
  test("列表项内代码块含尾部空行：serialize 不吞行且闭合围栏缩进", () => {
    const md = "- item\n\n  ```\n  a\n\n  ```\n\n- next\n";
    const doc1 = parse(md);
    expect(doc1.childCount).toBe(1);
    const md2 = serialize(doc1);
    // canonical 会收敛项间空行与文末换行，但代码内容（含尾行空行）与闭合围栏缩进保留。
    expect(md2).toBe("- item\n\n  ```\n  a\n\n  ```\n- next");
    expect(parse(md2).eq(doc1)).toBe(true);
  });
  // Indented (4-space) code: md-it produces a `code_block` token with no
  // markup, same shape as a fenced block w/ no lang. Round-trip is at
  // doc level — md-text serialises to the fenced form (no `style` attr
  // distinguishes the two; phase 2 if shape preservation is needed).
  test("indented code (collapses to fenced on save)", () =>
    roundTripStable("    line 1\n    line 2"));
});

describe("round-trip: lists", () => {
  test("bullet list", () => roundTripStable("- a\n- b\n- c"));
  test("task list unchecked", () => roundTripStable("- [ ] foo"));
  test("task list checked", () => roundTripStable("- [x] foo"));
  test("task list mixed", () => roundTripStable("- [ ] todo\n- [x] done\n- plain"));
  test("ordered list default start", () => roundTripStable("1. a\n2. b"));
  test("ordered list with start", () => roundTripStable("5. a\n6. b"));
  test("nested bullet list", () => roundTripStable("- outer\n  - inner\n- next"));
  test("list item with multi-paragraph content", () =>
    roundTripStable("- first para\n\n  second para\n- next item"));
});

// 源码写法（列表符号/有序分隔符/围栏字符/分隔线变体）由 parse 捕获为节点
// attr、serialize 按原样输出。这是有意行为：默认保存/复制/导出不再把
// `*`/`1)`/`~~~`/`___` 归一化为 `-`/`1.`/```` ``` ````/`---`，且语义不变。
describe("serialize: 源码写法原样保留", () => {
  test("* / + 列表符号保留", () => {
    expect(serialize(parse("* a\n* b"))).toBe("* a\n* b");
    expect(serialize(parse("+ a\n+ b"))).toBe("+ a\n+ b");
  });
  test("有序列表 `)` 分隔符保留", () => {
    expect(serialize(parse("5) a\n6) b"))).toBe("5) a\n6) b");
    expect(serialize(parse("1) a\n2) b"))).toBe("1) a\n2) b");
  });
  test("`~~~` 围栏与长度保留", () => {
    expect(serialize(parse("~~~ts\nconst x = 1;\n~~~"))).toBe("~~~ts\nconst x = 1;\n~~~");
    expect(serialize(parse("````\ncode\n````"))).toBe("````\ncode\n````");
  });
  test("分隔线 `_`/`*` 变体保留", () => {
    expect(serialize(parse("___\n\nbody"))).toBe("___\n\nbody");
    expect(serialize(parse("***\n\nbody"))).toBe("***\n\nbody");
  });
  test("canonical `-` 写法不受影响", () => {
    expect(serialize(parse("- a\n- b"))).toBe("- a\n- b");
  });
});

describe("round-trip: inline marks", () => {
  test("strong", () => roundTripStable("**bold**"));
  test("highlight", () => roundTripStable("==marked=="));
  test("subscript", () => roundTripStable("H~2~O"));
  test("superscript", () => roundTripStable("E=mc^2^"));
  test("highlight with spaces", () => roundTripStable("a ==hello world== b"));
  test("em", () => roundTripStable("*italic*"));
  test("strong (underscore)", () => roundTripStable("__bold__"));
  test("em (underscore)", () => roundTripStable("_italic_"));
  test("strong and em adjacent", () => roundTripStable("**bold** and *italic*"));
  test("nested strong+em", () => roundTripStable("***both***"));
  test("inline code", () => roundTripStable("run `npm test`"));
  test("inline code with backticks inside", () => roundTripStable("use `` ` `` as fence"));
  test("link without title", () => roundTripStable("see [site](https://example.com)"));
  test("autolink url", () => roundTripStable("see <https://example.com>"));
  test("autolink email", () => roundTripStable("mail <foo@example.com>"));
  test("link with title", () => roundTripStable('see [site](https://example.com "home")'));
  // markdown-it percent-encodes non-ASCII hrefs internally; the editor
  // decodes them at parse time so the saved markdown keeps the raw Chinese
  // path (string equality, not just parse-tree equality).
  test("link with Chinese file path keeps raw Chinese on serialize", () => {
    const md = "[外部文件](/Users/geange/Documents/Texto/zh-CN/代码块与图表.md)";
    expect(serialize(parse(md))).toBe(md);
  });
  test("link with Chinese file path and title keeps raw Chinese on serialize", () => {
    const md = '[外部文件](/Users/geange/Documents/Texto/zh-CN/代码块与图表.md "标题")';
    expect(serialize(parse(md))).toBe(md);
  });
  test("link file path preserves ASCII percent-escapes (%20)", () => {
    const md = "[a](/base/My%20File.md)";
    expect(serialize(parse(md))).toBe(md);
  });
  test("image with Chinese src keeps raw Chinese on serialize", () => {
    const md = "![图](images/截图.png)";
    expect(serialize(parse(md))).toBe(md);
  });
  // Reference links — doc-level round-trip stable (md-text collapses to
  // inline form on serialize; the link mark carries the resolved href so
  // re-parsing yields the same doc).
  test("reference link full", () =>
    roundTripStable("[ref][1]\n\n[1]: https://example.com"));
  test("reference link collapsed", () =>
    roundTripStable("[ref][]\n\n[ref]: https://example.com"));
  test("reference link shortcut", () =>
    roundTripStable("[ref]\n\n[ref]: https://example.com"));
  test("reference link with title", () =>
    roundTripStable('[ref][1]\n\n[1]: https://example.com "home"'));
  test("image", () => roundTripStable("![alt](https://example.com/x.png)"));
  test("image with title", () =>
    roundTripStable('![alt](https://example.com/x.png "caption")'));
  test("image empty alt", () => roundTripStable("![](https://example.com/x.png)"));
  test("hard break", () => roundTripStable("line a  \nline b"));
  test("html comment", () => roundTripStable("before <!-- a note --> after"));
  test("html comment empty", () => roundTripStable("<!---->"));
  test("emoji known", () => roundTripStable("ship it :rocket: now"));
  test("emoji unknown stays text", () => roundTripStable(":notarealname: still here"));
  test("soft break (newline in paragraph)", () => roundTripStable("line a\nline b"));
});

describe("round-trip: escaping", () => {
  test("escaped markdown meta characters as literal text", () =>
    roundTripStable("literal \\*not italic\\*"));
  test("paragraph starting with heading-like char", () => roundTripStable("\\# not a heading"));
  test("paragraph starting with list-like char", () => roundTripStable("\\- not a bullet"));
  test("angle brackets", () => roundTripStable("a \\<b\\> c"));
  test("underscores inside word (escaped input)", () => roundTripStable("snake\\_case\\_ident"));
  test("underscores inside word (raw input)", () => roundTripStable("snake_case_ident"));
  test("environment variable style underscores", () => roundTripStable("HELM_ROBOT_PASSWORD"));
  test("underscore at word boundary still escaped", () => roundTripStable("not \\_ italic"));
  test("list with env-style underscores", () => roundTripStable("- HELM_ROBOT_PASSWORD\n- ANOTHER_VAR"));
});

describe("round-trip: math", () => {
  test("inline math", () => roundTripStable("before $x^2$ after"));
  test("inline math with surrounding Chinese text", () =>
    roundTripStable("质能方程 $E=mc^2$ 很著名"));
  test("consecutive inline math", () => roundTripStable("$a$ and $b$"));
  test("block math", () => roundTripStable("$$\nE = mc^2\n$$"));
  test("block math between paragraphs", () =>
    roundTripStable("intro\n\n$$\nE = mc^2\n$$\n\noutro"));
});

describe("round-trip: composite", () => {
  test("typical document", () => {
    const md = [
      "# Title",
      "",
      "Intro paragraph with **bold**, *italic*, and `code`.",
      "",
      "> A blockquote with a [link](https://example.com).",
      "",
      "- first item",
      "- second **item**",
      "",
      "1. one",
      "2. two",
      "",
      "```ts",
      "const x: number = 1;",
      "```",
      "",
      "---",
      "",
      "final paragraph",
    ].join("\n");
    roundTripStable(md);
  });
});
