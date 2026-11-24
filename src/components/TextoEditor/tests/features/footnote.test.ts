import { describe, expect, test } from "vitest";

import { parse } from "../../src/parser.ts";
import { serialize } from "../../src/serializer.ts";

describe("footnote", () => {
  test("parse footnote ref with def and serialize back", () => {
    const md = "Text[^1] more\n\n[^1]: Def";
    const doc = parse(md);
    const out = serialize(doc);
    expect(out).toBe("Text[^1] more\n\n[^1]: Def");
  });

  test("parse multiple footnotes", () => {
    const md = "A[^1] B[^2]\n\n[^1]: First\n\n[^2]: Second";
    const doc = parse(md);
    const out = serialize(doc);
    expect(out).toBe("A[^1] B[^2]\n\n[^1]: First\n\n[^2]: Second");
  });

  test("inline content has footnote_ref mark on references", () => {
    const md = "Text[^1]\n\n[^1]: Def";
    const doc = parse(md);
    const para = doc.firstChild!;
    let foundMark = false;
    para.forEach((child: any) => {
      if (child.marks?.some((m: any) => m.type.name === "footnote_ref")) {
        foundMark = true;
        expect(child.text).toBe("[^1]");
        expect(child.marks[0]!.attrs.id).toBe("1");
      }
    });
    expect(foundMark).toBe(true);
  });

  test("footnote definition is a paragraph with [^n]: prefix", () => {
    const md = "Text[^1]\n\n[^1]: Def";
    const doc = parse(md);
    let defPara: any = null;
    doc.forEach((node) => {
      if (node.type.name === "paragraph" && node.textContent.startsWith("[^1]:")) {
        defPara = node;
      }
    });
    expect(defPara).not.toBeNull();
    expect(defPara.textContent).toBe("[^1]: Def");
  });

  test("serialize empty footnote def gracefully", () => {
    const md = "Text[^1]\n\n[^1]: \n\nMore text";
    const doc = parse(md);
    const out = serialize(doc);
    expect(out).toContain("[^1]:");
  });

  test("serialize footnote with multi-paragraph def", () => {
    const md = "Text[^1]\n\n[^1]: First para\n\nSecond para";
    const doc = parse(md);
    const out = serialize(doc);
    expect(out).toContain("[^1]: First para");
  });
});
