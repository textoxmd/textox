import { describe, expect, test } from "vitest";

import { pretty, setup } from "../utils.ts";
import { setComposition } from "../../src/composition.ts";
import { headingTypeIndicatorSpecs } from "../../specs/features/heading-type-indicator.specs.ts";
import { runFeatureCases } from "../utils.ts";

runFeatureCases(headingTypeIndicatorSpecs);

describe("heading-type-indicator (direct tests)", () => {
  test("label stays stable during IME composition", () => {
    let state = setup("# Hello");
    expect(pretty(state)).toBe("<h1><h-label>H1</h-label>Hello|</h1>");

    setComposition(true);
    try {
      state = state.apply(state.tr);
      expect(pretty(state)).toBe("<h1><h-label>H1</h-label>Hello|</h1>");
    } finally {
      setComposition(false);
    }
  });
});
