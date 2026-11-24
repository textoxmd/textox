import { describe, expect, it } from "vitest";
import {
  MODE_SWITCH_ANCHOR_RATIO,
  modeSwitchAnchorY,
} from "../src/scroll-anchor";

describe("模式切换视觉锚点", () => {
  it("锚点略高于窗口几何中心（视觉中线偏置）", () => {
    expect(MODE_SWITCH_ANCHOR_RATIO).toBeGreaterThan(0.4);
    // 0.5 = 窗口正中；按正中会略偏低（标题栏 + 视觉舒适线偏上）。
    expect(MODE_SWITCH_ANCHOR_RATIO).toBeLessThan(0.5);
  });

  it("锚点 y 按窗口高度换算", () => {
    expect(modeSwitchAnchorY()).toBeCloseTo(
      window.innerHeight * MODE_SWITCH_ANCHOR_RATIO,
    );
  });
});
