import type { FeatureSpecs } from "../_types.ts";

export const htmlBlockSpecs: FeatureSpecs = {
  name: "html-block",
  renderCases: {
    "html-block": (children, el) => {
      const render = el.querySelector(".html-block-render");
      if (render && (render as HTMLElement).style.display !== "none") {
        return `<html-block>${(render as HTMLElement).innerHTML}</html-block>`;
      }
      // HTML 块视图由 official-plugins/html 懒加载：动态 import 完成前只有
      // 轻量外壳，没有渲染容器。同步的 spec 断言无法等待该 import，因此这里
      // 按模式投影：有光标 → 源码模式（沿用 children，保留 | 与语法折叠）；
      // 无光标 → 回读 contentDOM 的源码文本。这里的投影只是「源码等价文本」，
      // 并不等于浏览器真实渲染后的结构（渲染容器 innerHTML 也只是源码回显）。
      if (!el.querySelector(".play-caret")) {
        const code = el.querySelector(".html-block-code");
        if (code) return `<html-block>${code.textContent}</html-block>`;
      }
      return `<html-block>${children}</html-block>`;
    },
  },
  cases: [
    {
      id: "enter-converts-div",
      label: "<div> + Enter → html_block with auto-closed </div>",
      seed: "",
      events: ["<", "d", "i", "v", ">", "<Enter>"],
      checkpoints: [
        { at: 5, expect: "<div>|" },
        { at: 6, expect: "<html-block><div>\n|</div></html-block>" },
      ],
    },
    {
      id: "type-inside-block",
      label: "after conversion, typing lands inside the block",
      seed: "",
      events: ["<", "d", "i", "v", ">", "<Enter>", "x", "<Enter>", "y"],
      checkpoints: [
        { at: 7, expect: "<html-block><div>\nx|</div></html-block>" },
        { at: 9, expect: "<html-block><div>\nx\ny|</div></html-block>" },
      ],
    },
    {
      id: "comment-auto-close",
      label: "<!-- + Enter → html_block with --> auto-closed",
      seed: "",
      events: ["<", "!", "-", "-", "<Enter>"],
      checkpoints: [
        { at: 5, expect: "<html-block><!--\n|--></html-block>" },
      ],
    },
    {
      id: "arrow-down-exits",
      label: "last line of html_block + ArrowDown → exits to new paragraph below",
      seed: "<div>\n</div>",
      events: ["<ArrowDown>"],
      checkpoints: [
        { at: 0, expect: "<html-block><div>\n</div>|</html-block>" },
        { at: 1, expect: "<html-block><div>\n</div></html-block>\n|" },
      ],
    },
    {
      id: "render-when-blurred",
      label: "cursor outside html_block → content projected as source text",
      seed: "<div>\n<span>x</span>\n</div>\n\npara",
      events: [],
      checkpoints: [
        // seed 光标在块下方段落，块处于 blur 态 → 同步投影回读源码等价文本
        // （rendering 行为本身由懒加载的 html-block-view 负责，spec 不观察其真实 DOM）
        { at: 0, expect: "<html-block><div>\n<span>x</span>\n</div></html-block>\npara|" },
      ],
    },
    {
      id: "arrow-up-enters-source",
      label: "ArrowUp from below moves cursor into block → back to source mode",
      seed: "<div>\ncontent\n</div>\n\npara",
      events: ["<ArrowUp>"],
      checkpoints: [
        // 光标在块外 → 渲染模式（同步投影为源码等价文本）
        { at: 0, expect: "<html-block><div>\ncontent\n</div></html-block>\npara|" },
        // ArrowUp 后光标进入块内（块内容末尾）→ 切回源码模式
        { at: 1, expect: "<html-block><div>\ncontent\n</div>|</html-block>\npara" },
      ],
    },
  ],
};
