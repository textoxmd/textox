import { describe, expect, it } from "vitest";
import { toDocumentRelativePath } from "../documentPath";

describe("toDocumentRelativePath", () => {
  it("returns a relative path when the file sits under the document directory", () => {
    expect(
      toDocumentRelativePath(
        "/Users/u/Documents/notes/drawings/flow.excalidraw",
        "/Users/u/Documents/notes/note.md",
      ),
    ).toBe("drawings/flow.excalidraw");
  });

  it("returns the filename for a file next to the document", () => {
    expect(
      toDocumentRelativePath(
        "/Users/u/Documents/notes/flow.excalidraw",
        "/Users/u/Documents/notes/note.md",
      ),
    ).toBe("flow.excalidraw");
  });

  it("keeps an absolute path when the file is outside the document directory", () => {
    expect(
      toDocumentRelativePath(
        "/Users/u/whiteboards/flow.excalidraw",
        "/Users/u/Documents/notes/note.md",
      ),
    ).toBe("/Users/u/whiteboards/flow.excalidraw");
  });

  it("handles Windows drive paths", () => {
    expect(
      toDocumentRelativePath(
        "C:\\notes\\drawings\\flow.excalidraw",
        "C:\\notes\\note.md",
      ),
    ).toBe("drawings/flow.excalidraw");
    expect(
      toDocumentRelativePath(
        "D:\\whiteboards\\flow.excalidraw",
        "C:\\notes\\note.md",
      ),
    ).toBe("D:/whiteboards/flow.excalidraw");
  });

  it("falls back to the absolute path when the document has no directory", () => {
    expect(
      toDocumentRelativePath("/Users/u/flow.excalidraw", "note.md"),
    ).toBe("/Users/u/flow.excalidraw");
  });
});
