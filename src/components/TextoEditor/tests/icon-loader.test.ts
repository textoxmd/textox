import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IconDef } from "@texto/markdown-editor-api";

import {
  iconNodeToIconDef,
  loadIcon,
  prefetchIcons,
  resetIconLoaderForTests,
  resolveIcon,
} from "../src/iconLoader.ts";

describe("iconNodeToIconDef", () => {
  it("maps supported svg tags", () => {
    const def = iconNodeToIconDef([
      ["path", { d: "M0 0h1" }],
      ["line", { x1: "1", y1: "2", x2: "3", y2: "4" }],
      ["rect", { x: "1", y: "2", width: "3", height: "4" }],
      ["circle", { cx: "1", cy: "2", r: "3" }],
      ["ellipse", { cx: "1", cy: "2", rx: "3", ry: "4" }],
      ["polyline", { points: "1,2 3,4" }],
      ["polygon", { points: "5,6 7,8" }],
    ]);
    expect(def).toEqual([
      ["path", "M0 0h1"],
      ["line", 1, 2, 3, 4],
      ["rect", 1, 2, 3, 4],
      ["circle", 1, 2, 3],
      ["ellipse", 1, 2, 3, 4],
      ["polyline", "1,2 3,4"],
      ["polygon", "5,6 7,8"],
    ]);
  });

  it("skips unsupported tags with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const def = iconNodeToIconDef([["g", { id: "x" }]]);
    expect(def).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps rect rx when present", () => {
    expect(iconNodeToIconDef([["rect", { x: "1", y: "2", width: "3", height: "4", rx: "5" }]])).toEqual([
      ["rect", 1, 2, 3, 4, 5],
    ]);
  });

  it("drops path/polygon entries that are missing required attributes", () => {
    expect(iconNodeToIconDef([["path", {}], ["polygon", {}]])).toEqual([]);
  });
});

describe("iconLoader", () => {
  beforeEach(() => resetIconLoaderForTests());

  it("returns IconDef specs as-is", async () => {
    const spec: IconDef = [["path", "M0 0h1"]];
    await expect(loadIcon(spec)).resolves.toBe(spec);
    expect(resolveIcon(spec)).toBe(spec);
  });

  it("loads a lucide icon by name and caches it", async () => {
    expect(resolveIcon("bold")).toBeUndefined();
    const def = await loadIcon("bold");
    expect(Array.isArray(def)).toBe(true);
    expect(def.length).toBeGreaterThan(0);
    expect(resolveIcon("bold")).toBe(def);
    await expect(loadIcon("bold")).resolves.toBe(def);
  });

  it("rejects unknown names", async () => {
    await expect(loadIcon("definitely-not-a-lucide-icon")).rejects.toThrow();
  });

  it("prefetchIcons warms the cache", async () => {
    prefetchIcons(["bold", "nope-x"]);
    await vi.waitFor(() => expect(resolveIcon("bold")).toBeDefined());
  });
});
