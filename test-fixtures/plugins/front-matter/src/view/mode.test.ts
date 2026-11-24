import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetPluginConfigSnapshotsForTests,
  setPluginConfigSnapshot,
} from "@texto/plugin-sdk";

import { readViewMode, setConfigWriter, subscribeViewMode, writeViewMode } from "./mode";

const PLUGIN_ID = "front-matter";

afterEach(() => {
  resetPluginConfigSnapshotsForTests();
  setConfigWriter(null);
});

describe("view mode", () => {
  it("缺省为 panel", () => {
    expect(readViewMode()).toBe("panel");
  });

  it("读取快照里的 view", () => {
    setPluginConfigSnapshot(PLUGIN_ID, { view: "source" });
    expect(readViewMode()).toBe("source");
  });

  it("订阅在快照变更时回调", () => {
    const cb = vi.fn();
    const off = subscribeViewMode(cb);
    setPluginConfigSnapshot(PLUGIN_ID, { view: "source" });
    expect(cb).toHaveBeenCalledWith("source");
    off();
  });

  it("writeViewMode 未注入 writer 时为 no-op（不抛错）", async () => {
    await expect(writeViewMode("source")).resolves.toBeUndefined();
  });

  it("writeViewMode 调 writer", async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    setConfigWriter({ set });
    await writeViewMode("source");
    expect(set).toHaveBeenCalledWith("view", "source");
  });
});
