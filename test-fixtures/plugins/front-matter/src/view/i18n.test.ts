import { afterEach, describe, expect, it } from "vitest";
import { setTranslator, t } from "./i18n";

afterEach(() => setTranslator(null));

describe("plugin i18n", () => {
  it("无翻译器用 fallback", () => {
    expect(t("panelTitle", "Properties")).toBe("Properties");
  });
  it("注入翻译器用其返回值", () => {
    setTranslator((k) => (k === "panelTitle" ? "属性" : undefined));
    expect(t("panelTitle", "Properties")).toBe("属性");
  });
  it("翻译器返回带前缀 key（缺失）时回退 fallback", () => {
    setTranslator((k) => `front-matter.${k}`);
    expect(t("panelTitle", "Properties")).toBe("Properties");
  });
});
