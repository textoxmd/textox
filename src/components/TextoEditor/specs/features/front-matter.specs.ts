import { setPluginConfigSnapshot } from "@texto/plugin-sdk";

import type { FeatureSpecs } from "../_types.ts";

// 编辑器 spec 覆盖「源码模式」下的键位/文本行为（与改造前的文本块 UX 一致）。
// 面板渲染由插件侧 happy-dom 测试覆盖（official-plugins/front-matter/src/view/*.test.ts）。
// vitest 默认按文件隔离，此处快照设置不会泄漏到其它测试文件。
setPluginConfigSnapshot("front-matter", { view: "source" });

export const frontMatterSpecs: FeatureSpecs = {
  name: "front-matter",
  renderCases: {
    "yaml-block": (_children, el) => {
      const raw = el.getAttribute("data-source") ?? "";
      const escaped = raw
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n");
      return `<yaml-block content="${escaped}" />`;
    },
  },
  cases: [
    {
      id: "type-and-convert",
      label: "---<Enter> at doc start opens an empty yaml block",
      seed: "",
      events: ["-", "-", "-", "<Enter>"],
      checkpoints: [
        { at: 1, expect: "-|" },
        { at: 2, expect: "--|" },
        // hr feature flags `---` as a draft (gray) waiting for Enter to
        // commit. Enter beats it to convert into yaml block instead since
        // we're at doc start — our keymap runs before hr's commit path.
        { at: 3, expect: "<g>---</g>|" },
        { at: 4, expect: '<yaml-block content="" />' },
      ],
    },
    {
      id: "type-into-block",
      label: "after conversion, typed chars land in the yaml block",
      seed: "",
      events: ["-", "-", "-", "<Enter>", "t", "i", "t", "l", "e"],
      checkpoints: [
        { at: 4, expect: '<yaml-block content="" />' },
        { at: 9, expect: '<yaml-block content="title" />' },
      ],
    },
    {
      id: "double-enter-exits",
      label: "Enter twice on an empty trailing line exits the block",
      seed: "",
      events: ["-", "-", "-", "<Enter>", "a", "<Enter>", "<Enter>"],
      checkpoints: [
        { at: 5, expect: '<yaml-block content="a" />' },
        // First Enter inside: appends \n, cursor on empty trailing line.
        { at: 6, expect: '<yaml-block content="a\\n" />' },
        // Second Enter: strips the trailing \n, cursor lands in the new
        // paragraph below the block.
        { at: 7, expect: '<yaml-block content="a" />\n|' },
      ],
    },
    {
      id: "arrow-down-exits",
      label: "ArrowDown on the last line exits to the paragraph below",
      seed: "",
      events: ["-", "-", "-", "<Enter>", "a", "<ArrowDown>"],
      checkpoints: [
        { at: 5, expect: '<yaml-block content="a" />' },
        { at: 6, expect: '<yaml-block content="a" />\n|' },
      ],
    },
    {
      id: "parse-from-seed",
      label: "front matter at doc start parses to yaml block",
      seed: "---\ntitle: Hello\ndate: 2024-01-01\n---\n\nbody",
      events: [],
      checkpoints: [
        {
          at: 0,
          expect:
            '<yaml-block content="title: Hello\\ndate: 2024-01-01" />\nbody|',
        },
      ],
    },
    {
      id: "no-close-falls-through",
      label: "leading `---` without a closing `---` is hr",
      seed: "---\n\nbody",
      events: [],
      checkpoints: [
        { at: 0, expect: "<hr/>\nbody|" },
      ],
    },
    {
      id: "not-at-doc-start",
      label: "`---` after a paragraph is setext h2, not yaml",
      seed: "Title\n---\n\nbody",
      events: [],
      checkpoints: [
        { at: 0, expect: "<h2>Title</h2>\nbody|" },
      ],
    },
  ],
};
