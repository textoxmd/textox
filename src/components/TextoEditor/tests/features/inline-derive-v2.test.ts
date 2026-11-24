import { describe, expect, test } from "vitest";

import { deriveInline } from "../../src/features/inline-derive.ts";
import type { InlineDeriveFeature } from "@texto/markdown-editor-runtime";

// 一个只存在于测试里的新行内语法：`%%x%%`。
// 它不使用 md-it 规则，也不改骨架——只要实现 derive，就能被引擎接受。
//
// 刻意不选 `__x__`：那是 CommonMark 的 strong，md-it 已经产出 strong_open /
// strong_close 并由核心先占用分隔符区间，插件再声明同区间只会被判「重复占用」。
// 本用例要证的是「md-it 不认识的新记号」，故用 md-it 不解析的 `%%`。
const underlineDemo: InlineDeriveFeature = {
  name: "demo-underline",
  inline: {
    order: -1,
    markNames: ["demo"],
    extRanges: () => [],
    derive: (ctx) => {
      const match = /%%([^%]+)%%/.exec(ctx.text);
      if (!match) return [];
      const openTo = match.index + 2;
      const from = openTo;
      const to = from + match[1]!.length;
      return [
        {
          type: "demo",
          from,
          to,
          openFrom: match.index,
          openTo,
          closeFrom: to,
          closeTo: to + 2,
        },
      ];
    },
  },
};

describe("derive v2 acceptance", () => {
  test("新语法只靠插件声明即可被引擎认领", () => {
    const d = deriveInline("a %%b%% c", { features: [underlineDemo] });
    expect(d.spans).toEqual([
      { type: "demo", from: 4, to: 5, openFrom: 2, openTo: 4, closeFrom: 5, closeTo: 7 },
    ]);
  });

  test("同一区间第二个特性被拒（先到先得）", () => {
    const rival: InlineDeriveFeature = {
      name: "demo-rival",
      inline: {
        order: 0,
        markNames: ["demo"],
        extRanges: () => [],
        derive: () => [
          { type: "demo", from: 4, to: 5, openFrom: 2, openTo: 4, closeFrom: 5, closeTo: 7 },
        ],
      },
    };
    expect(deriveInline("a %%b%% c", { features: [underlineDemo, rival] }).spans).toHaveLength(1);
  });

  test("一个 token 可以产出多个 span（旧契约做不到）", () => {
    const multi: InlineDeriveFeature = {
      name: "demo-multi",
      inline: {
        order: -1,
        markNames: [],
        extRanges: () => [],
        derive: (ctx) => {
          const text = ctx.tokens.find((t) => t.token.type === "text");
          if (!text) return [];
          return [
            {
              type: "demo",
              from: text.pos,
              to: text.end,
              openFrom: text.pos,
              openTo: text.pos,
              closeFrom: text.end,
              closeTo: text.end,
            },
            {
              type: "demo",
              from: text.end,
              to: text.end,
              openFrom: text.end,
              openTo: text.end,
              closeFrom: text.end,
              closeTo: text.end,
            },
          ];
        },
      },
    };
    const d = deriveInline("ab *c*", { features: [multi] });
    expect(d.spans.filter((s) => s.type === "demo")).toHaveLength(2);
  });
});
