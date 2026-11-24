import { afterEach, describe, expect, it, vi } from "vitest";
import { resetPluginConfigSnapshotsForTests } from "@texto/plugin-sdk";

import { activate } from "./activate";
import { setTranslator, t } from "./view/i18n";
import { VIEW_MODE_KEY, readViewMode, setConfigWriter, writeViewMode } from "./view/mode";

afterEach(() => {
  resetPluginConfigSnapshotsForTests();
  setConfigWriter(null);
  setTranslator(null);
});

function makeHost(translate: (key: string) => string) {
  return {
    config: { set: vi.fn(), get: vi.fn(), getAll: vi.fn(), subscribe: vi.fn() },
    i18n: { t: vi.fn(translate), language: () => "en" },
  } as unknown as Parameters<typeof activate>[0];
}

describe("activate", () => {
  it("注入配置写入与翻译器（幂等）", async () => {
    const host = makeHost((k) => `front-matter.${k}`);

    activate(host);
    activate(host); // 幂等：重复注入不抛错

    // 翻译器：mock 对缺失 key 返回 `front-matter.<k>`，视为缺失 ⇒ 回退 fallback。
    expect(t("panelTitle", "Properties")).toBe("Properties");
    expect(host.i18n.t).toHaveBeenCalled();

    // 配置写入：writer 已注入，writeViewMode 会调 host.config.set。
    await writeViewMode("source");
    expect(host.config.set).toHaveBeenCalledWith(VIEW_MODE_KEY, "source");
    // host mock 不更新配置快照 ⇒ 读取仍为默认值。
    expect(readViewMode()).toBe("panel");
  });

  it("注入的真实翻译优先于 fallback", () => {
    const host = makeHost(() => "属性");

    activate(host);

    expect(t("panelTitle", "Properties")).toBe("属性");
    expect(host.i18n.t).toHaveBeenCalledWith("panelTitle");
  });
});
