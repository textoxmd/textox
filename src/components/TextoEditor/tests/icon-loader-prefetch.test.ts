import { beforeEach, describe, expect, it, vi } from "vitest";

// 用假映射表替换真实 lucide 动态导入，以便观测每个图标 loader 被调用的次数。
const { loaderSpy } = vi.hoisted(() => ({ loaderSpy: vi.fn() }));

vi.mock("lucide-react/dynamicIconImports", () => ({
  default: { bold: loaderSpy },
}));

import { prefetchIcons, resetIconLoaderForTests, resolveIcon } from "../src/iconLoader.ts";

describe("prefetchIcons", () => {
  beforeEach(() => {
    resetIconLoaderForTests();
    loaderSpy.mockReset();
    loaderSpy.mockResolvedValue({ __iconNode: [["path", "M0 0h1"]] });
  });

  it("loads each distinct lucide name once", async () => {
    prefetchIcons(["bold", "bold", [["path", "M0 0"]], "bold"]);
    await vi.waitFor(() => expect(resolveIcon("bold")).toBeDefined());
    expect(loaderSpy).toHaveBeenCalledTimes(1);
  });
});
