import { Schema, type NodeSpec, type MarkSpec } from "prosemirror-model";

import { collectMarks, collectNodes } from "./features/index.ts";

const coreNodes: Record<string, NodeSpec> = {
  doc: { content: "block+" },

  paragraph: {
    group: "block",
    content: "inline*",
    parseDOM: [{ tag: "p" }],
    toDOM: () => ["p", 0],
  },

  heading: {
    group: "block",
    content: "inline*",
    // style: "atx" → `# H`, "setext" → `H\n===` (level 1) / `H\n---` (level 2).
    // Captured at parse time from markdown-it's `markup` token field; new
    // headings created via input rule default to "atx".
    attrs: { level: { default: 1 }, style: { default: "atx" } },
    defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
      tag: `h${level}`,
      attrs: { level },
    })),
    toDOM: (node) => [`h${node.attrs.level as number}`, 0],
  },

  blockquote: {
    group: "block",
    content: "block+",
    defining: true,
    parseDOM: [{ tag: "blockquote" }],
    toDOM: () => ["blockquote", 0],
  },

  code_block: {
    group: "block",
    content: "text*",
    marks: "",
    code: true,
    defining: true,
    attrs: {
      lang: { default: "" },
      // 围栏写法：` vs `~` 及长度，解析/创建时写入，序列化按原样输出。
      fence: { default: "`" },
      fenceLen: { default: 3 },
    },
    parseDOM: [
      {
        tag: "pre",
        preserveWhitespace: "full",
        getAttrs: (el) => ({ lang: (el as HTMLElement).getAttribute("data-lang") ?? "" }),
      },
    ],
    toDOM: (node) => [
      "pre",
      node.attrs.lang ? { "data-lang": node.attrs.lang as string } : {},
      ["code", 0],
    ],
  },

  horizontal_rule: {
    group: "block",
    // 分隔线写法（`-`/`*`/`_`），解析时捕获。
    attrs: { variant: { default: "-" } },
    parseDOM: [{ tag: "hr" }],
    toDOM: () => ["hr"],
  },

  bullet_list: {
    group: "block",
    content: "list_item+",
    // marker: 用户使用的无序列表符号（`-`/`*`/`+`），解析时捕获、输入规则
    // 写入，序列化时按原符号输出；缺省 `-`。
    attrs: { marker: { default: "-" } },
    parseDOM: [{ tag: "ul" }],
    toDOM: () => ["ul", 0],
  },

  ordered_list: {
    group: "block",
    content: "list_item+",
    attrs: {
      start: { default: 1 },
      // 有序列表分隔符：`.` / `)`，解析/输入时写入。
      delimiter: { default: "." },
    },
    parseDOM: [
      {
        tag: "ol",
        getAttrs: (el) => {
          const start = (el as HTMLElement).getAttribute("start");
          return { start: start ? Number(start) : 1 };
        },
      },
    ],
    toDOM: (node) => {
      const start = node.attrs.start as number;
      return ["ol", start === 1 ? {} : { start }, 0];
    },
  },

  list_item: {
    content: "paragraph block*",
    defining: true,
    parseDOM: [{ tag: "li" }],
    toDOM: () => ["li", 0],
  },

  text: { group: "inline" },

  hard_break: {
    group: "inline",
    inline: true,
    selectable: false,
    parseDOM: [{ tag: "br" }],
    toDOM: () => ["br"],
  },
};

const coreNodesExtra: Record<string, NodeSpec> = {};

const coreMarks: Record<string, MarkSpec> = {};

let _schema: Schema | undefined;

export function getSchema(): Schema {
  return (_schema ??= new Schema({
    nodes: { ...coreNodes, ...coreNodesExtra, ...collectNodes() },
    marks: { ...coreMarks, ...collectMarks() },
  }));
}

/** 仅供测试：清空惰性 schema 缓存。 */
export function resetSchemaForTests(): void {
  _schema = undefined;
}
