import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";

import { alertSplitPlugin } from "./split";

function makeMd() {
  const md = new MarkdownIt("commonmark", { html: false });
  md.use(alertSplitPlugin);
  return md;
}

function inlineTokens(src: string) {
  return makeMd().parse(src, {}).filter((t) => t.type === "inline");
}

function blockTypes(src: string) {
  return makeMd()
    .parse(src, {})
    .filter((t) => t.type === "paragraph_open" || t.type === "paragraph_close")
    .map((t) => t.type);
}

describe("alertSplitPlugin", () => {
  it("splits marker and continuation line into two paragraphs", () => {
    const src = "> [!WARNING]\n> Be careful\n";
    const inline = inlineTokens(src);
    expect(inline).toHaveLength(2);
    expect(inline[0]!.content).toBe("[!WARNING]");
    expect(inline[1]!.content).toBe("Be careful");
    // 结构断言：必须是两个独立段落，而非一个段落里的两段文本。
    expect(blockTypes(src)).toEqual([
      "paragraph_open",
      "paragraph_close",
      "paragraph_open",
      "paragraph_close",
    ]);
    const html = makeMd().render(src);
    expect(html).toContain("<p>[!WARNING]</p>");
    expect(html).toContain("<p>Be careful</p>");
  });

  it("does not split when the marker has no continuation line", () => {
    expect(inlineTokens("> [!NOTE]")).toHaveLength(1);
  });

  it("ignores blockquotes that are not alerts", () => {
    expect(inlineTokens("> Just a quote\n> second line\n")).toHaveLength(1);
  });
});
