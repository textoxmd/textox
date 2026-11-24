import { describe, expect, test } from "vitest";
import { TextSelection } from "prosemirror-state";

import { createState } from "../../src/editor.ts";
import { fakeView } from "../../specs/sim.ts";
import { parse } from "../../src/parser.ts";
import { serialize } from "../../src/serializer.ts";
import {
  toggleBlockquote,
  toggleBulletList,
  toggleCodeBlock,
  toggleOrderedList,
} from "../../src/features/toolbar-toggle.ts";
import { toggleTaskList } from "../../src/features/task.ts";

function findPos(md: string, needle: string, nth = 0): number {
  const doc = parse(md);
  const matches: number[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const text = node.text ?? "";
    let idx = text.indexOf(needle);
    while (idx >= 0) {
      matches.push(pos + idx);
      idx = text.indexOf(needle, idx + needle.length);
    }
    return true;
  });
  return matches[nth] ?? -1;
}

function run(md: string, cmd: (state: any, dispatch: any, view: any) => boolean, needle = "hi", nth = 0): { ok: boolean; md: string } {
  const doc = parse(md);
  let state = createState(doc);
  const f = findPos(md, needle, nth);
  const p = f < 0 ? 1 : f + 1;
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, p, p)));
  const view = fakeView(state);
  const ok = cmd(view.state, view.dispatch, view);
  return { ok, md: serialize(view.state.doc) };
}

describe("toggleBlockquote", () => {
  test("wraps paragraph in blockquote", () => {
    const r = run("hello", toggleBlockquote());
    expect(r.ok).toBe(true);
    expect(r.md).toBe("> hello");
  });
  test("unwraps when inside blockquote", () => {
    const r = run("> hi", toggleBlockquote(), "hi");
    expect(r.ok).toBe(true);
    expect(r.md).toBe("hi");
  });
  test("unwraps multi-paragraph blockquote", () => {
    const r = run("> a\n> b", toggleBlockquote(), "b");
    expect(r.ok).toBe(true);
    expect(r.md).toBe("a\nb");
  });
});

describe("toggleBulletList", () => {
  test("wraps paragraph in bullet list", () => {
    const r = run("hello", toggleBulletList());
    expect(r.ok).toBe(true);
    expect(r.md).toBe("- hello");
  });
  test("unwraps single-item bullet list", () => {
    const r = run("- hi", toggleBulletList(), "hi");
    expect(r.ok).toBe(true);
    expect(r.md).toBe("hi");
  });
  test("unwraps first item of two", () => {
    const r = run("- a\n- b", toggleBulletList(), "a");
    expect(r.ok).toBe(true);
    expect(r.md).toBe("a\n- b");
  });
  test("unwraps last item of two", () => {
    const r = run("- a\n- b", toggleBulletList(), "b");
    expect(r.ok).toBe(true);
    expect(r.md).toBe("- a\n\nb");
  });
  test("unwraps the cursor's item when siblings are identical", () => {
    const r = run("- a\n- a", toggleBulletList(), "a", 1);
    expect(r.ok).toBe(true);
    expect(r.md).toBe("- a\n\na");
  });
});

describe("toggleOrderedList", () => {
  test("wraps paragraph in ordered list", () => {
    const r = run("hello", toggleOrderedList());
    expect(r.ok).toBe(true);
    expect(r.md).toBe("1. hello");
  });
  test("unwraps single-item ordered list", () => {
    const r = run("1. hi", toggleOrderedList(), "hi");
    expect(r.ok).toBe(true);
    expect(r.md).toBe("hi");
  });
});

describe("toggleCodeBlock", () => {
  test("turns paragraph into code block", () => {
    const r = run("hello", toggleCodeBlock());
    expect(r.ok).toBe(true);
    expect(r.md).toBe("```\nhello\n```");
  });
  test("turns code block back to paragraph", () => {
    const r = run("```\nhi\n```", toggleCodeBlock(), "hi");
    expect(r.ok).toBe(true);
    expect(r.md).toBe("hi");
  });
});

describe("toggleTaskList", () => {
  test("wraps paragraph into task item", () => {
    const r = run("hello", toggleTaskList());
    expect(r.ok).toBe(true);
    expect(r.md).toBe("- [ ] hello");
  });
  test("removes marker when already inside task item", () => {
    const r = run("- [ ] hi", toggleTaskList(), "hi");
    expect(r.ok).toBe(true);
    expect(r.md).toBe("- hi");
  });
});
