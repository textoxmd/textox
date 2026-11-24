import { describe, expect, it } from "vitest";

import { settingsSection } from "./settings";
import { VIEW_MODE_KEY } from "./view/mode";
import type { ViewMode } from "./view/types";

describe("settingsSection", () => {
  it("声明默认视图字段", () => {
    expect(settingsSection.id).toBe("front-matter.properties");
    const field = settingsSection.fields[0]!;
    if (field.type !== "select") throw new Error("expected select field");
    expect(field.key).toBe(VIEW_MODE_KEY);
    expect(field.default).toBe("panel");
    expect(field.options).toHaveLength(2);
  });

  it("视图模式字段的取值收敛在 ViewMode 集合内", () => {
    const field = settingsSection.fields[0]!;
    if (field.type !== "select") throw new Error("expected select field");
    expect(field.key).toBe(VIEW_MODE_KEY);
    const allowed: ViewMode[] = ["panel", "source"];
    for (const option of field.options) {
      expect(allowed).toContain(option.value as ViewMode);
    }
  });
});
