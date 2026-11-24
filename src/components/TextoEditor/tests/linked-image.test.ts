import { describe, expect, test } from "vitest";
import { EditorView } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";
import { setup, pretty, apply } from "./utils.ts";
import { parseInline } from "../src/inline-parse.ts";
import { serialize } from "../src/serializer.ts";

function dispatchModClickOnImg(mount: HTMLElement, mod: boolean): void {
  const img = mount.querySelector("img.image-render") as HTMLImageElement | null;
  if (!img) throw new Error("no image-render img");
  const ev = (t: string) => new MouseEvent(t, { bubbles: true, cancelable: true, clientX: 0, clientY: 0, ...(mod ? { metaKey: true } : {}) });
  img.dispatchEvent(ev("mousedown"));
  img.dispatchEvent(ev("mouseup"));
  img.dispatchEvent(ev("click"));
}

describe("linked image", () => {
  const md = `[![License](https://img.shields.io/badge/License-CC0-lightgray.svg?style=flat-square)](https://creativecommons.org/publicdomain/zero/1.0/)`;

  test("parseInline detects the outer link span", () => {
    const spans = parseInline(md);
    const link = spans.find((s) => s.type === "link");
    expect(link).toBeTruthy();
    expect(md.slice(link!.from, link!.to)).toBe("![License](https://img.shields.io/badge/License-CC0-lightgray.svg?style=flat-square)");
    expect(md.slice(link!.closeFrom, link!.closeTo)).toBe("](https://creativecommons.org/publicdomain/zero/1.0/)");
    expect(link!.attrs).toMatchObject({ href: "https://creativecommons.org/publicdomain/zero/1.0/" });
  });

  test("doc keeps the link mark after setup (normalize roundtrip)", () => {
    const state = setup(md);
    const text = state.doc.textContent;
    expect(text).toBe(md);
    let linkMarks = 0;
    state.doc.descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type.name === "link")) linkMarks++;
      return true;
    });
    expect(linkMarks).toBeGreaterThan(0);
  });

  test("stable view renders image inside link, no stray brackets", () => {
    const state = setup(md);
    const outside = apply(state, [" "]);
    const out = pretty(outside);
    expect(out).toContain("<l:https://creativecommons.org/publicdomain/zero/1.0/>");
    expect(out).toContain("<img:");
    expect(out).not.toContain("](https://creativecommons");
    expect(out).not.toContain("[![");
  });

  test("serializer roundtrips the linked image", () => {
    const state = setup(md);
    expect(serialize(state.doc)).toBe(md);
  });

  test("linked image with empty alt", () => {
    const m = `[![](http://x/img.png)](href)`;
    const spans = parseInline(m);
    const link = spans.find((s) => s.type === "link");
    expect(link).toBeTruthy();
    const state = setup(m);
    expect(serialize(state.doc)).toBe(m);
  });
});

describe("linked image renders inline (link mode)", () => {
  test("img gets inline class when image is inside a link", () => {
    const md = `[![License](https://img.shields.io/badge/License-CC0-lightgray.svg?style=flat-square)](https://creativecommons.org/publicdomain/zero/1.0/)`;
    const state = setup(md);
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    try {
      const img = mount.querySelector("img.image-render") as HTMLImageElement | null;
      expect(img).toBeTruthy();
      expect(img!.className).toContain("image-render-inline");
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("standalone image renders as a block preview", () => {
    const md = `![alt](https://img.shields.io/badge/x.svg)`;
    const state = setup(md);
    const stateOutside = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 0)),
    );
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state: stateOutside });
    try {
      const block = mount.querySelector(".image-ref-block") as HTMLElement | null;
      expect(block).toBeTruthy();
      const img = block?.querySelector("img.image-ref-img") as HTMLImageElement | null;
      expect(img).toBeTruthy();
      expect(img!.className).not.toContain("image-render-inline");
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});

describe("linked image cmd+click", () => {
  const md = `[![License](https://img.shields.io/badge/badge.svg)](https://creativecommons.org/zero/)`;

  test("cmd+click on img resolves the link href", () => {
    const state = setup(md);
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    let clickedHref: string | null = null;
    const view = new EditorView(mount, {
      state,
      handleClick(_view, _pos, event) {
        const mod = (event as MouseEvent).metaKey || (event as MouseEvent).ctrlKey;
        if (!mod) return false;
        const a = (event.target as Element | null)?.closest("a");
        if (!a) return false;
        const href = a.getAttribute("data-href") || a.getAttribute("href");
        if (!href) return false;
        clickedHref = href;
        return true;
      },
    });
    try {
      dispatchModClickOnImg(mount, true);
      expect(clickedHref).toBe("https://creativecommons.org/zero/");
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("plain click on linked image does NOT navigate", () => {
    const state = setup(md);
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    let clickedHref: string | null = null;
    const view = new EditorView(mount, {
      state,
      handleClick(_view, _pos, event) {
        const mod = (event as MouseEvent).metaKey || (event as MouseEvent).ctrlKey;
        if (!mod) return false;
        const a = (event.target as Element | null)?.closest("a");
        if (!a) return false;
        clickedHref = a.getAttribute("data-href") || a.getAttribute("href");
        return true;
      },
    });
    try {
      dispatchModClickOnImg(mount, false);
      expect(clickedHref).toBeNull();
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});

describe("link scan edge cases", () => {
  test("plain link unaffected", () => {
    const spans = parseInline("[text](url)");
    expect(spans.filter((s) => s.type === "link")).toHaveLength(1);
  });

  test("empty link text still gets visible href", () => {
    const spans = parseInline("[](url)");
    const link = spans.find((s) => s.type === "link");
    expect(link).toBeTruthy();
    expect(link!.delimRanges?.some((d) => d.forceVisible)).toBe(true);
  });

  test("link after a space still detected", () => {
    const spans = parseInline("abc [![alt](src)](href)");
    const link = spans.find((s) => s.type === "link");
    expect(link).toBeTruthy();
    expect(link!.attrs).toMatchObject({ href: "href" });
    expect(link!.from).toBe(5);
  });

  test("image NOT inside a link unaffected", () => {
    const spans = parseInline("![alt](src)");
    expect(spans.filter((s) => s.type === "link")).toHaveLength(0);
    expect(spans.filter((s) => s.type === "image")).toHaveLength(1);
  });

  test("stray [ before image but no outer link -> no link span", () => {
    const spans = parseInline("[![alt](src) text");
    expect(spans.filter((s) => s.type === "link")).toHaveLength(0);
  });

  test("pretty renders linked image with cursor inside", () => {
    const md = `[![alt](http://x/img.png)](href)`;
    const state = setup(md);
    const out = pretty(state);
    expect(out).toContain("<l:href>");
    expect(out).toContain("<img:http://x/img.png>alt</img>");
  });
});
