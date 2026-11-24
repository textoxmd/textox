import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

import { resolveImageSrc } from "../imagePath";

describe("resolveImageSrc absolute-path handling", () => {
  it("treats a Windows drive path as absolute, not relative to the document", () => {
    expect(resolveImageSrc("C:\\Pictures\\texto\\a.png", "/Users/u/Documents")).toBe(
      "asset://localhost/C:\\Pictures\\texto\\a.png",
    );
  });

  it("treats a UNC path as absolute even without a document directory", () => {
    expect(resolveImageSrc("\\\\server\\share\\a.png", null)).toBe(
      "asset://localhost/\\\\server\\share\\a.png",
    );
  });

  it("still resolves POSIX absolute paths as absolute", () => {
    expect(resolveImageSrc("/abs/a.png", "/Users/u/Documents")).toBe(
      "asset://localhost//abs/a.png",
    );
  });

  it("still resolves relative paths against the document directory", () => {
    expect(resolveImageSrc("assets/a.png", "/Users/u/Documents")).toBe(
      "asset://localhost//Users/u/Documents/assets/a.png",
    );
  });

  it("keeps protocol-relative URLs untouched (isDirectUrl wins over absolute-path handling)", () => {
    expect(resolveImageSrc("//server/share/a.png", "/Users/u/Documents")).toBe(
      "//server/share/a.png",
    );
  });

  it("keeps asset:// URLs untouched", () => {
    expect(resolveImageSrc("asset://localhost/x.png", "/Users/u/Documents")).toBe(
      "asset://localhost/x.png",
    );
  });
});
