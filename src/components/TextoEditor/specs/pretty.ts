// pretty is a projection of the real EditorView DOM:
//   - boot a real EditorView in headless DOM (happy-dom), let PM do
//     `toDOM` + decoration ordering itself
//   - recursively walk `view.dom`, map tags to our HTML-ish DSL:
//     <i>/<b>/<c>/<l:url>/<g>/|/[]
//   - no duplicated rendering — cursor side, decoration ordering and mark
//     nesting are all decided by PM
//
// As long as the real view renders correctly, the pretty snapshot is correct.
// And by construction, the snapshot can never drift away from the real view.

import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { collectRenderCases } from "./features/index.ts";

const featureRenderCases = collectRenderCases();

// ─────────────────────────────────────────────────────────────────────────────
// DOM → test DSL text
// ─────────────────────────────────────────────────────────────────────────────

function isElement(n: Node): n is Element {
  return n.nodeType === 1;
}
function isText(n: Node): n is Text {
  return n.nodeType === 3;
}

// Recursive render: input is any DOM node, output is the corresponding text.
function renderNode(n: Node): string {
  if (isText(n)) return n.data;
  if (!isElement(n)) return "";

  const el = n;
  const tag = el.tagName.toLowerCase();
  const list = el.classList;

  // Decoration widgets — PM also adds "ProseMirror-widget" to the class list,
  // so use classList.contains rather than a strict className comparison.
  if (tag === "span") {
    // Emoji glyph widget — the unicode face rendered in place of the
    // `:name:` source. Collapse the widget span to its text so the DSL
    // stays `😄<g>:smile:</g>` (source visible) / `😄 ` (hidden).
    if (list.contains("emoji-glyph")) return el.textContent ?? "";
    // image mark 的 toDOM 用 span[data-image-mark] 承载 alt 文本 ——
    // 它只是 round-trip 载体，不改变显示，DSL 中透明化（只输出子内容）。
    if (el.hasAttribute("data-image-mark")) {
      return Array.from(el.childNodes).map(renderNode).join("");
    }
    // 行内数学 mark span 是 latex 数据载体 + 可编辑内容容器，恒带
    // `data-latex`。DSL 中透明化：光标在外时内容范围带 syntax-hidden
    // （渲染为空），光标在内时输出源码文本。放在 html-inline 的 `span`
    // renderCase 之前，否则会被当作通用 HTML <span> 输出成原始标签。
    // 用 `data-latex` 判定而非 `class`，避免误伤用户手写的
    // `<span class="math inline">`（HTML inline 走通用 span 分支）。
    if (el.hasAttribute("data-latex")) {
      return Array.from(el.childNodes).map(renderNode).join("");
    }
    if (list.contains("syntax-hint")) return `<g>${el.textContent ?? ""}</g>`;
    if (list.contains("syntax-hint-italic"))
      return `<gi>${el.textContent ?? ""}</gi>`;
    if (list.contains("syntax-hidden")) return ""; // delim char present in text, visually hidden
    if (list.contains("task-marker-hidden")) return "";
    if (list.contains("play-caret")) return "|";
    if (list.contains("selection-marker")) return el.textContent ?? "";
    // The task NodeView wraps the checkbox in an inert frame span — collapse
    // it so the DSL stays just `<checkbox/>`.
    if (list.contains("checkbox-frame"))
      return Array.from(el.childNodes).map(renderNode).join("");
    if (list.contains("checkbox"))
      return el.getAttribute("data-checked") === "1"
        ? "<checkbox checked/>"
        : "<checkbox/>";
    if (list.contains("file-input")) return "<file-input/>";
    // 行内数学公式分隔符
    if (list.contains("math-delim-open") || list.contains("math-delim-close")) {
      return `<g>${el.textContent ?? "$"}</g>`;
    }
  }

  // 检查 style 属性中是否有 display: none
  const style = el.getAttribute("style");
  if (style && style.includes("display: none")) {
    return "";
  }
  if (tag === "img" && list.contains("image-render")) {
    const src = el.getAttribute("src") ?? "";
    const alt = el.getAttribute("alt") ?? "";
    return `<img:${src}>${alt}</img>`;
  }
  // 白板引用 `![](path.excalidraw)` 的预览 widget —— 内部是异步懒加载的
  // SVG（测试环境不会真正渲染），断言只关心引用是否被识别与源码显隐。
  if (tag === "div" && list.contains("excalidraw-embed")) {
    return `<excalidraw:${el.getAttribute("data-src") ?? ""}/>`;
  }
  // 图片引用块：源码编辑态输出源码文本，预览态只保留引用标记。
  if (tag === "div" && list.contains("image-ref-block")) {
    const source = el.querySelector(".image-ref-source") as HTMLElement | null;
    if (source && source.style.display !== "none") {
      return renderNode(source);
    }
    return `<imgref:${el.getAttribute("data-src") ?? ""}/>`;
  }

  // Trailing break PM injects for empty textblocks — not part of the doc content.
  if (tag === "br" && list.contains("ProseMirror-trailingBreak")) return "";

  // Emoji autocomplete dropdown — collapsed to a self-closing tag in
  // pretty since the option list is dynamic and not the focus of the
  // assertion (presence/absence is what we test).
  if (list.contains("emoji-completion")) return "<select />";

  const children = Array.from(el.childNodes).map(renderNode).join("");

  // 行内数学公式 - 通过 tag 识别
  if (tag === "math-jax") {
    const latex = el.getAttribute("latex") ?? el.getAttribute("data-formula") ?? children;
    return `<math-jax latex="${latex}"/>`;
  }

  const featureCase = featureRenderCases[tag];
  if (featureCase) return featureCase(children, el);

  switch (tag) {
    case "p":
      return children;
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      // Keep the tag so a rendered heading is distinguishable from a
      // paragraph whose text happens to start with `#{1,6} ` (method-B
      // draft state). `#` / level is already encoded in the tag name.
      // The H-label is now a node-decoration class + data-label rendered
      // via CSS ::before (no contenteditable=false widget in the DOM),
      // so emit it here for the test DSL.
      const label = el.classList.contains("heading-type-indicator")
        ? el.getAttribute("data-label") ?? ""
        : "";
      return `<${tag}>${label ? `<h-label>${label}</h-label>` : ""}${children}</${tag}>`;
    }
    case "br":
      return "<br/>";
    case "hr":
      // Self-closing tag matches the convention used by other block
      // markers (<toc/>, <yaml-block .../>); avoids collision with a
      // paragraph whose text happens to be `---`.
      return "<hr/>";
    case "blockquote":
      // Same ambiguity fix as headings: a paragraph whose text starts
      // with `> ` would pretty-render identically to an actual
      // blockquote under the old `> ${line}` form. Wrap with <bq> and
      // join multi-block children by newline.
      return `<bq>${Array.from(el.children).map(renderNode).join("\n")}</bq>`;
    case "pre": {
      // <pre data-lang="ts"><code>text</code></pre>. Recurse through the
      // `<code>` child instead of reading textContent — textContent skips
      // zero-text widget spans (e.g. PM's play-caret), so we'd lose the
      // `|` marker when the cursor lives inside the code block.
      const codeEl = el.querySelector("code");
      const lang = el.getAttribute("data-lang") ?? "";
      const text = codeEl ? renderNode(codeEl) : "";
      return `\`\`\`${lang}\n${text}\n\`\`\``;
    }
    case "ul":
    case "ol": {
      // Explicit <ul>/<ol> + <li> nesting: list state is unambiguous (a
      // paragraph starting with `- ` would otherwise look identical to a
      // one-item bullet list), and the bullet/number is implied by the
      // tag rather than emitted as text. `<ol s=N>` carries non-default
      // start.
      const isOrdered = tag === "ol";
      const startAttr = el.getAttribute("start");
      const start = startAttr ? Number(startAttr) : 1;
      const inner = Array.from(el.children).map(renderNode).join("");
      const open = isOrdered
        ? start === 1
          ? "<ol>"
          : `<ol s=${start}>`
        : "<ul>";
      const close = isOrdered ? "</ol>" : "</ul>";
      return `${open}${inner}${close}`;
    }
    case "li": {
      // First block child is the item content. Non-first <p> children
      // are "bulletless trailing paragraphs" (staircase-exit intermediate
      // or CommonMark loose-list continuation) — wrap them in <li-tail>.
      // Nested ul/ol keep their own wrappers.
      const inner = Array.from(el.children)
        .map((child, i) => {
          const content = renderNode(child);
          if (i === 0) return content;
          return child.tagName.toLowerCase() === "p"
            ? `<li-tail>${content}</li-tail>`
            : content;
        })
        .join("");
      return `<li>${inner}</li>`;
    }
    default:
      return children;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry: render with a real EditorView, then stringify the DOM.
// ─────────────────────────────────────────────────────────────────────────────

export function pretty(state: EditorState): string {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const view = new EditorView(mount, { state });
  view.focus();
  try {
    const blocks = Array.from(view.dom.children).map(renderNode);
    return blocks.join("\n").replace(/\n+$/, "");
  } finally {
    view.destroy();
    mount.remove();
  }
}
