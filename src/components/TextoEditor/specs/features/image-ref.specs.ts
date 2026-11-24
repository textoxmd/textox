import type { FeatureSpecs } from "../_types.ts";

export const imageRefSpecs: FeatureSpecs = {
  name: "image-ref",
  cases: [
    {
      id: "enter-commit-excalidraw",
      label: "standalone ![](drawings/flow.excalidraw) + Enter commits to a block; ArrowUp enters editable source",
      seed: "",
      events: [
        "!", "[", "白", "板", "]", "(", "d", "r", "a", "w", "i", "n", "g", "s", "/",
        "f", "l", "o", "w", ".", "e", "x", "c", "a", "l", "i", "d", "r", "a", "w",
        ")", "<Enter>", "<ArrowUp>",
      ],
      checkpoints: [
        // `)` 输完：整段恰好是完整引用 → 立即提交为块，光标在块内 → 源码态
        { at: 31, expect: "![白板](drawings/flow.excalidraw)|" },
        // Enter 提交：预览态（块 + 下方空段落，光标在空段落）
        { at: 32, expect: "<imgref:drawings/flow.excalidraw/>\n|" },
        // 上方向键移回块内：源码编辑态，直接可编辑文本
        { at: 33, expect: "![白板](drawings/flow.excalidraw)|" },
      ],
    },
    {
      id: "enter-commit-png",
      label: "standalone ![](img.png) + Enter commits to a block",
      seed: "",
      events: [
        "!", "[", "图", "]", "(", "i", "m", "g", ".", "p", "n", "g", ")", "<Enter>",
      ],
      checkpoints: [
        { at: 14, expect: "<imgref:img.png/>\n|" },
      ],
    },
    {
      id: "enter-commit-assets-png",
      label: "standalone ![无标题](assets/911d53dc.ec933968.png) + Enter commits to a block",
      seed: "",
      events: [
        "!", "[", "无", "标", "题", "]", "(", "a", "s", "s", "e", "t", "s", "/",
        "9", "1", "1", "d", "5", "3", "d", "c", ".", "e", "c", "9", "3", "3",
        "9", "6", "8", ".", "p", "n", "g", ")", "<Enter>",
      ],
      checkpoints: [
        // `)` 输完：立即提交为块源码态（含非 ASCII alt 与带点文件名）
        { at: 36, expect: "![无标题](assets/911d53dc.ec933968.png)|" },
        // Enter 提交：预览态
        { at: 37, expect: "<imgref:assets/911d53dc.ec933968.png/>\n|" },
      ],
    },
    {
      id: "immediate-block-source-typing",
      label: "typing a standalone ![](img.png) switches to the block source immediately (no inline img widget)",
      seed: "",
      events: ["!", "[", "图", "]", "(", "i", "m", "g", ".", "p", "n", "g", ")"],
      checkpoints: [
        // `(` 自动配对后文本 `![图]()`：src 为空 → 行内 file-input（块转换不触发）
        { at: 5, expect: "![图](<file-input/>|)" },
        // 敲下收尾 `)`（跳过自动配对的括号、光标到达段尾）→ 提交为块源码态
        { at: 14, expect: "![图](img.png)|" },
      ],
    },
    {
      id: "typing-more-after-ref-stays-inline",
      label: "typing prose right after a standalone ref falls back to an inline paragraph",
      seed: "",
      events: [
        "!", "[", "图", "]", "(", "i", "m", "g", ".", "p", "n", "g", ")",
        " ", "看", "下", "图",
      ],
      checkpoints: [
        // `)` 完成 → 块源码态
        { at: 13, expect: "![图](img.png)|" },
        // 空格续写 → 块回退为段落，走行内图片渲染（光标在区间外，源码隐藏）
        { at: 17, expect: "<img:>图</img> 看下图|" },
      ],
    },
    {
      id: "title-completes-block",
      label: "typing a title inside the ref still commits to the block at the final )",
      seed: "",
      events: [
        "!", "[", "图", "]", "(", "i", "m", "g", ".", "p", "n", "g",
        " ", "\"", "标", "题", "\"", ")",
      ],
      checkpoints: [
        // 标题未闭合前整段不是完整引用 → 保持段落（行内扫描同样不匹配）
        { at: 16, expect: "![图](img.png \"标题|)" },
        // 收尾 `)` 后立即提交为块源码态
        { at: 18, expect: "![图](img.png \"标题\")|" },
      ],
    },
    {
      id: "mid-paragraph-stays-inline",
      label: "a ref embedded in prose stays an inline image paragraph",
      seed: "",
      events: [
        "看", "下", "图", " ", "!", "[", "]", "(", "d", "r", "a", "w", "i", "n", "g", "s", "/", "f", "l", ".", "e", "x", "c", "a", "l", "i", "d", "r", "a", "w", ")", " ", "<Enter>",
      ],
      checkpoints: [
        { at: 32, expect: "看下图 <img:></img> |" },
      ],
    },
    {
      id: "list-item-stays-inline",
      label: "- ![](img.png) + Enter inside a list stays an inline image (standard list split, no block filler)",
      seed: "",
      events: [
        "-", " ", "!", "[", "图", "]", "(", "i", "m", "g", ".", "p", "n", "g", ")",
        "<Enter>",
      ],
      checkpoints: [
        // 列表项内不提交为块；Enter 由列表 splitListItem 处理 —— 图片保持
        // 行内留在第一项（光标移出区间 → 渲染 <img>），光标进入新空项
        { at: 17, expect: "<ul><li><img:>图</img></li><li>|</li></ul>" },
      ],
    },
  ],
};
