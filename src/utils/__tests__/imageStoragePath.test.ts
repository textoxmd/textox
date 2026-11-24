import { describe, expect, it } from "vitest";
import { isAbsoluteImageStoragePath } from "../imageStoragePath";

describe("isAbsoluteImageStoragePath", () => {
  it("accepts POSIX absolute paths", () => {
    expect(isAbsoluteImageStoragePath("/")).toBe(true);
    expect(isAbsoluteImageStoragePath("/Users/u/Pictures/texto")).toBe(true);
  });

  it("accepts Windows drive paths with either separator", () => {
    expect(isAbsoluteImageStoragePath("C:\\Pictures\\texto")).toBe(true);
    expect(isAbsoluteImageStoragePath("C:/Pictures/texto")).toBe(true);
    expect(isAbsoluteImageStoragePath("D:/")).toBe(true);
  });

  it("accepts UNC paths", () => {
    expect(isAbsoluteImageStoragePath("\\\\server\\share\\texto")).toBe(true);
  });

  it("rejects empty and relative paths", () => {
    expect(isAbsoluteImageStoragePath("")).toBe(false);
    expect(isAbsoluteImageStoragePath("assets")).toBe(false);
    expect(isAbsoluteImageStoragePath("./assets")).toBe(false);
    expect(isAbsoluteImageStoragePath("../images")).toBe(false);
    expect(isAbsoluteImageStoragePath("C:")).toBe(false);
  });
});
