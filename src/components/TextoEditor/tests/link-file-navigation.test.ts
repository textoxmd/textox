import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Plugin } from "prosemirror-state";
import type { Node as PMNode, Schema } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";

vi.mock("../src/confirm-link-dialog.ts", () => ({
  showConfirmLinkDialog: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

import { showConfirmLinkDialog } from "../src/confirm-link-dialog.ts";
import { openUrl } from "@tauri-apps/plugin-opener";
import { fakeView } from "../specs/sim.ts";

(window as any).__TAURI_INTERNALS__ = {
  transformCallback: () => 0,
  invoke: async () => undefined,
  convertFileSrc: () => "",
};

let isFileLink: (href: string, openableExtensions: string[]) => boolean;
let resolveFileLink: (href: string, documentDir: string) => string;
let navigateLink: typeof import("../src/link-navigation.ts").navigateLink;
beforeAll(async () => {
  const nav = await import("../src/link-navigation.ts");
  isFileLink = nav.isFileLink;
  resolveFileLink = nav.resolveFileLink;
  navigateLink = nav.navigateLink;
});

let defaultPlugins: (options?: {
  cursorWidget?: boolean;
  documentPath?: string;
  isSingleFileMode?: boolean;
  openableExtensions?: string[];
  onOpenFileLink?: (path: string) => void;
}) => Plugin[];
let schema: Schema;
let parse: (src: string) => PMNode;
let getOpenableExtensions: (state: EditorState) => string[];
let getOnOpenFileLink: (state: EditorState) => ((path: string) => void) | undefined;
beforeAll(async () => {
  const editor = await import("../src/editor.ts");
  const info = await import("../src/doc-info.ts");
  const schemaMod = await import("../src/schema.ts");
  const parserMod = await import("../src/parser.ts");
  defaultPlugins = editor.defaultPlugins;
  getOpenableExtensions = info.getOpenableExtensions;
  getOnOpenFileLink = info.getOnOpenFileLink;
  schema = schemaMod.getSchema();
  parse = parserMod.parse;
});

describe("isFileLink", () => {
  const exts = ["md", "markdown", "txt"];

  test("relative file link matches openable extension", () => {
    expect(isFileLink("other.md", exts)).toBe(true);
    expect(isFileLink("./a.md", exts)).toBe(true);
    expect(isFileLink("sub/b.markdown", exts)).toBe(true);
    expect(isFileLink("C:\\x\\y.txt", exts)).toBe(true);
  });

  test("non-openable extension is not a file link", () => {
    expect(isFileLink("other.png", exts)).toBe(false);
    expect(isFileLink("foo", exts)).toBe(false);
    expect(isFileLink("www.example.com", exts)).toBe(false);
  });

  test("scheme/anchor links are never file links", () => {
    expect(isFileLink("https://x.com/a.md", exts)).toBe(false);
    expect(isFileLink("mailto:a@b.com", exts)).toBe(false);
    expect(isFileLink("tel:123", exts)).toBe(false);
    expect(isFileLink("file:///x/a.md", exts)).toBe(false);
    expect(isFileLink("#anchor", exts)).toBe(false);
  });

  test("empty openable list disables file links", () => {
    expect(isFileLink("other.md", [])).toBe(false);
  });
});

describe("resolveFileLink", () => {
  const dir = "/base";

  test("plain relative", () => {
    expect(resolveFileLink("a.md", dir)).toBe("/base/a.md");
  });
  test("explicit ./", () => {
    expect(resolveFileLink("./a.md", dir)).toBe("/base/a.md");
  });
  test("../ climbs a level", () => {
    expect(resolveFileLink("../up.md", dir)).toBe("/up.md");
  });
  test("absolute path passes through", () => {
    expect(resolveFileLink("/abs/x.md", dir)).toBe("/abs/x.md");
  });
  test("url-decodes the href", () => {
    expect(resolveFileLink("a%20b.md", dir)).toBe("/base/a b.md");
  });
  test("strips # fragment", () => {
    expect(resolveFileLink("a.md#sec", dir)).toBe("/base/a.md");
  });
  test("strips ? query string", () => {
    expect(resolveFileLink("b.md?a=1", dir)).toBe("/base/b.md");
  });
  test("windows drive absolute path preserved", () => {
    expect(resolveFileLink("C:\\docs\\x.md", dir)).toBe("C:/docs/x.md");
  });
});

describe("docInfo openableExtensions/onOpenFileLink", () => {
  function buildState(options: {
    openableExtensions?: string[];
    onOpenFileLink?: (path: string) => void;
  }) {
    const doc = parse("hi");
    const base = EditorState.create({
      schema,
      doc,
      plugins: defaultPlugins({
        cursorWidget: false,
        documentPath: "/docs/a.md",
        ...options,
      }),
    });
    return base.apply(base.tr.setSelection(TextSelection.atStart(doc)));
  }

  test("getters return configured values", () => {
    const onOpenFileLink = () => {};
    const state = buildState({ openableExtensions: ["md", "txt"], onOpenFileLink });
    expect(getOpenableExtensions(state)).toEqual(["md", "txt"]);
    expect(getOnOpenFileLink(state)).toBe(onOpenFileLink);
  });

  test("defaults are empty/undefined", () => {
    const state = buildState({});
    expect(getOpenableExtensions(state)).toEqual([]);
    expect(getOnOpenFileLink(state)).toBeUndefined();
  });
});

describe("navigateLink file links", () => {
  beforeEach(() => {
    vi.mocked(showConfirmLinkDialog).mockReset();
    vi.mocked(openUrl).mockReset();
  });

  function makeFileState(onOpenFileLink: (p: string) => void) {
    const doc = parse("[text](other.md)");
    const base = EditorState.create({
      schema,
      doc,
      plugins: defaultPlugins({
        cursorWidget: false,
        documentPath: "/docs/a.md",
        openableExtensions: ["md", "markdown", "txt"],
        onOpenFileLink,
      }),
    });
    return base.apply(base.tr.setSelection(TextSelection.atStart(doc)));
  }

  test("non-empty text link calls onOpenFileLink with resolved path", async () => {
    const spy = vi.fn();
    await navigateLink("other.md", fakeView(makeFileState(spy)) as unknown as EditorView);
    expect(spy).toHaveBeenCalledWith("/docs/other.md");
  });

  test("empty-text link ./other.md resolves too", async () => {
    const spy = vi.fn();
    await navigateLink("./other.md", fakeView(makeFileState(spy)) as unknown as EditorView);
    expect(spy).toHaveBeenCalledWith("/docs/other.md");
  });

  test("../ climbs above the document dir", async () => {
    const spy = vi.fn();
    await navigateLink("../sibling.md", fakeView(makeFileState(spy)) as unknown as EditorView);
    expect(spy).toHaveBeenCalledWith("/sibling.md");
  });

  test("external link still opens externally", async () => {
    vi.mocked(showConfirmLinkDialog).mockResolvedValue(true);
    const doc = parse("hi");
    const base = EditorState.create({
      schema,
      doc,
      plugins: defaultPlugins({
        cursorWidget: false,
        documentPath: "/docs/a.md",
        openableExtensions: ["md"],
        onOpenFileLink: vi.fn(),
      }),
    });
    const state = base.apply(base.tr.setSelection(TextSelection.atStart(doc)));
    await navigateLink("https://example.com", fakeView(state) as unknown as EditorView);
    expect(openUrl).toHaveBeenCalledWith("https://example.com");
  });

  test("mailto link asks for confirmation before opening", async () => {
    vi.mocked(showConfirmLinkDialog).mockResolvedValue(true);
    vi.mocked(openUrl).mockClear();
    const doc = parse("hi");
    const base = EditorState.create({
      schema,
      doc,
      plugins: defaultPlugins({
        cursorWidget: false,
        documentPath: "/docs/a.md",
        openableExtensions: ["md"],
        onOpenFileLink: vi.fn(),
      }),
    });
    const state = base.apply(base.tr.setSelection(TextSelection.atStart(doc)));
    await navigateLink("mailto:a@b.co", fakeView(state) as unknown as EditorView);
    expect(showConfirmLinkDialog).toHaveBeenCalledWith("mailto:a@b.co");
    expect(openUrl).toHaveBeenCalledWith("mailto:a@b.co");
  });

  test("mailto link is not opened when the dialog is dismissed", async () => {
    vi.mocked(showConfirmLinkDialog).mockResolvedValue(false);
    vi.mocked(openUrl).mockClear();
    const doc = parse("hi");
    const base = EditorState.create({
      schema,
      doc,
      plugins: defaultPlugins({
        cursorWidget: false,
        documentPath: "/docs/a.md",
        openableExtensions: ["md"],
        onOpenFileLink: vi.fn(),
      }),
    });
    const state = base.apply(base.tr.setSelection(TextSelection.atStart(doc)));
    await navigateLink("tel:+123456", fakeView(state) as unknown as EditorView);
    expect(showConfirmLinkDialog).toHaveBeenCalledWith("tel:+123456");
    expect(openUrl).not.toHaveBeenCalled();
  });

  test("file link without documentDir is a silent no-op", async () => {
    const spy = vi.fn();
    const doc = parse("hi");
    const base = EditorState.create({
      schema,
      doc,
      plugins: defaultPlugins({ cursorWidget: false, openableExtensions: ["md"], onOpenFileLink: spy }),
    });
    const state = base.apply(base.tr.setSelection(TextSelection.atStart(doc)));
    await navigateLink("other.md", fakeView(state) as unknown as EditorView);
    expect(spy).not.toHaveBeenCalled();
    expect(showConfirmLinkDialog).not.toHaveBeenCalled();
  });
});
