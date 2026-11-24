import type { FeatureSpecs } from "../_types.ts";

function tagRender(tag: string): (children: string, el: Element) => string {
  return (children, el) => {
    const attrs = Array.from(el.attributes)
      .filter((a) => a.name !== "style")
      .map((a) => ` ${a.name}="${a.value}"`)
      .join("");
    const style = el.getAttribute("style");
    const styleAttr = style ? ` style="${style}"` : "";
    return `<${tag}${styleAttr}${attrs}>${children}</${tag}>`;
  };
}

export const htmlInlineSpecs: FeatureSpecs = {
  name: "html-inline",
  renderCases: {
    span: tagRender("span"),
    kbd: tagRender("kbd"),
    abbr: tagRender("abbr"),
    cite: tagRender("cite"),
    q: tagRender("q"),
    dfn: tagRender("dfn"),
    ins: tagRender("ins"),
    small: tagRender("small"),
    time: tagRender("time"),
    bdo: tagRender("bdo"),
    bdi: tagRender("bdi"),
    samp: tagRender("samp"),
    var: tagRender("var"),
    data: tagRender("data"),
  },
  cases: [
    {
      id: "span-with-style",
      label: "<span style='color:red'>text</span>",
      seed: "",
      events: [
        "<", "s", "p", "a", "n", " ",
        "s", "t", "y", "l", "e", "=", "'", "c", "o", "l", "o", "r", ":", "r", "e", "d", "'", ">",
        "H", "e", "l", "l", "o",
        "<", "/", "s", "p", "a", "n", ">",
      ],
      checkpoints: [
        { at: 25, expect: "<span style='color:red'>H|" },
        { at: 26, expect: "<span style='color:red'>He|" },
        { at: 30, expect: "<span style='color:red'>Hello<|" },
        { at: 36, expect: '<g><span style=\'color:red\'></g><span style="color: red;">Hello</span><g></span></g>|' },
      ],
    },
    {
      id: "kbd-tag",
      label: "<kbd>Ctrl</kbd>",
      seed: "",
      events: ["<", "k", "b", "d", ">", "C", "t", "r", "l", "<", "/", "k", "b", "d", ">"],
      checkpoints: [
        { at: 5, expect: "<kbd>|" },
        { at: 15, expect: "<g><kbd></g><kbd>Ctrl</kbd><g></kbd></g>|" },
      ],
    },
    {
      id: "abbr-with-title",
      label: "<abbr title='HTML'>HyperText</abbr>",
      seed: "",
      events: [
        "<", "a", "b", "b", "r", " ",
        "t", "i", "t", "l", "e", "=", "'", "H", "T", "M", "L", "'", ">",
        "H", "y", "p", "e", "r", "T", "e", "x", "t",
        "<", "/", "a", "b", "b", "r", ">",
      ],
      checkpoints: [
        { at: 19, expect: "<abbr title='HTML'>|" },
        { at: 35, expect: '<g><abbr title=\'HTML\'></g><abbr title="HTML">HyperText</abbr><g></abbr></g>|' },
      ],
    },
    {
      id: "unknown-tag-ignored",
      label: "<unknown>text</unknown> — should NOT render as html_inline",
      seed: "",
      events: [
        "<", "u", "n", "k", "n", "o", "w", "n", ">",
        "t", "e", "x", "t",
        "<", "/", "u", "n", "k", "n", "o", "w", "n", ">",
      ],
      checkpoints: [
        { at: 23, expect: "<unknown>text</unknown>|" },
      ],
    },
    {
      id: "multiple-spans",
      label: "<kbd>A</kbd> <kbd>B</kbd> — two inline HTML tags on one line",
      seed: "",
      events: [
        "<", "k", "b", "d", ">", "A", "<", "/", "k", "b", "d", ">",
        " ",
        "<", "k", "b", "d", ">", "B", "<", "/", "k", "b", "d", ">",
      ],
      checkpoints: [
        { at: 12, expect: "<g><kbd></g><kbd>A</kbd><g></kbd></g>|" },
        { at: 25, expect: "<kbd>A</kbd> <g><kbd></g><kbd>B</kbd><g></kbd></g>|" },
      ],
    },
  ],
};
