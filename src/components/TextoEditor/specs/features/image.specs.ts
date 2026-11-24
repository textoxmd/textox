import type { FeatureSpecs } from "../_types.ts";

export const imageSpecs: FeatureSpecs = {
  name: "image",
  cases: [
    {
      id: "type-image",
      label: "![alt](url) — full typing path with auto-pair",
      seed: "",
      events: [
        "!", "[", "a", "l", "t", "]", "(", "u", "r", "l", ")", " ",
      ],
      checkpoints: [
        { at: 1, expect: "!|" },
        { at: 2, expect: "![|]" },                                  // [ auto-pair
        { at: 5, expect: "![alt|]" },
        { at: 6, expect: "![alt]|" },                               // ] skip-over
        // ( auto-pair → image recognized (empty src), source visible,
        // file-input between ( and ).
        { at: 7, expect: "![alt](<file-input/>|)" },
        // 非空 src 敲出：自动配对的 `)` 尚在行内，整行仍是段落——
        // 行内 img widget 显示在源码下方；块转换要等收尾 `)` 落下（下个
        // checkpoint），见 image-ref 的立即提交插件。
        { at: 8, expect: "![alt](u|)<img:>alt</img>" },
        // src 继续敲到完整 URL，仍未收尾 `)`：行内态持续，不转块。
        { at: 9, expect: "![alt](ur|)<img:>alt</img>" },
        { at: 10, expect: "![alt](url|)<img:>alt</img>" },
        // 收尾 `)`：仍是块源码态
        { at: 11, expect: "![alt](url)|" },
        // space 续写 → 块回退为段落，光标移出区间 → 源码隐藏，仅 <img> 保留。
        { at: 12, expect: "<img:>alt</img> |" },
      ],
    },
    {
      id: "empty-alt",
      label: "![](url) — empty alt still recognized; url used as alt fallback",
      seed: "",
      events: ["!", "[", "]", "(", "u", "r", "l", ")", " "],
      checkpoints: [
        { at: 3, expect: "![]|" },
        { at: 4, expect: "![](<file-input/>|)" },
        // 收尾 `)` 之前的行内态（空 alt → alt="" → pretty 空子内容）。
        { at: 5, expect: "![](u|)<img:></img>" },
        { at: 8, expect: "![](url)|" },
        // space 续写 → 回退为行内 <img>（空 alt → alt="" → pretty 空子内容）。
        { at: 9, expect: "<img:></img> |" },
      ],
    },
    {
      id: "leave-and-reenter",
      label: "moving cursor out and back in toggles render/source",
      seed: "",
      events: [
        "!", "[", "a", "]", "(", "u", ")", " ", "<ArrowLeft>",
      ],
      checkpoints: [
        // `)` 完成 → 立即块源码态
        { at: 7, expect: "![a](u)|" },
        // space 续写 → 回退行内：光标移出区间，源码隐藏
        { at: 8, expect: "<img:>a</img> |" },
        // ArrowLeft 回到区间边界 `)|<space>` → 源码重新显示，图片仍在下方
        { at: 9, expect: "![a](u)<img:>a</img>| " },
      ],
    },
  ],
};
