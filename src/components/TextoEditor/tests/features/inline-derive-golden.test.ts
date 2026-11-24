import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import { parseInlineWith } from "../../src/inline-parse.ts";

// happy-dom 下 `new URL(rel, import.meta.url)` 会被 Vite 改写成 dev-server 的
// http URL，node:fs 不接受；这里沿用仓库的根相对路径约定（见
// tests/empty-textblock-caret.test.ts）。因此本测试必须从仓库根运行。
const FIXTURE = "src/components/TextoEditor/tests/fixtures/inline-derive.golden.json";
const UPDATE = process.env.UPDATE_GOLDEN === "1";

/** 语料：四个待迁移特性 + 核心语法 / 转义 / 嵌套 / 边界。 */
const CORPUS: string[] = [
  // highlight
  "==x==", "a ==b== c", "== x ==", "=====", "==a==b==", "**==x==**", "==*a*==", "==`c`==",
  // math
  "$x$", "a $x^2$ b", "$ x $", "$x", "x$", "$$x$$", "\\(y\\)", "a \\( y \\) b", "$~x~$",
  // sub-sup
  "H~2~O", "E=mc^2^", "~a b~", "^a b^", "~a\\ b~", "~a\\~b~", "~a\\\\~", "^a\\^b^",
  "~a^b^~", "~~x~~", "~~~x~~~", "~~5~10~~", "~a~~b~", "*~x~*", "[~x~](u)", "`~x~`", "\\~x\\~",
  // emoji
  ":smile:", "a :smile: b", ":bogus:", "::smile::", "a:smile:b", ":smile::smile:",
  "*:smile:*", "[:smile:](u)", "`:smile:`", "\\:smile:", ":+1:", ":-1:", "~:smile:~",
  // 核心 / 转义 / 边界
  "", "hello", "a *b* c", "**a**", "[t](u)", '[t](u "ti")', "[](u)", "![a](x.png)",
  "<https://a.b/~x~>", "a  \nb", "a\\\nb", "a\nb", "a \\* b", "a \\ b", "a\\\\ b", "x &amp; y",
  // 阶段 1 接受的行为差异 / 原生可嵌套 mark：alt 内 emoji 归上游 core 规则
  // （不下钻 image 的 alt children ⇒ 保持普通文本）；opaque 公式内容里的转义
  // 原样保留；`==` 之间允许再出现 `==` ⇒ 外层成对、内层成对。
  "![:smile:](u)", "$a\\*b$", "==a ==b== c==",
  // 阶段 2：包裹式构造 / 脚注引用 / html 注释 / 裸 URL
  "<u>**b**</u>", "a[^1]b", "<!-- c -->", "see https://x.com.",
];

const SPAN_KEYS = new Set([
  "type", "from", "to", "openFrom", "openTo", "closeFrom", "closeTo",
  "attrs", "opaque", "wrap", "delimRanges", "extraDecorations", "widgetDecorations",
]);

// span 顺序参与 normalize / decorations 的遍历序，属于契约的一部分；
// 不要为了 diff 干净而排序。
function normalized(text: string) {
  const { spans, atoms } = parseInlineWith(text, null);
  for (const span of spans) {
    for (const key of Object.keys(span)) {
      if (!SPAN_KEYS.has(key)) {
        throw new Error(`inline-derive golden: 未纳入快照的 span 字段 "${key}"`);
      }
    }
  }
  const json = spans.map((s) => ({
    type: s.type,
    from: s.from,
    to: s.to,
    openFrom: s.openFrom,
    openTo: s.openTo,
    closeFrom: s.closeFrom,
    closeTo: s.closeTo,
    ...(s.attrs ? { attrs: s.attrs } : {}),
    ...(s.opaque ? { opaque: true } : {}),
    ...(s.wrap ? { wrap: true } : {}),
    ...(s.delimRanges ? { delimRanges: s.delimRanges } : {}),
    ...(s.extraDecorations ? { extraDecorations: s.extraDecorations } : {}),
    ...(s.widgetDecorations ? { widgetDecorations: s.widgetDecorations } : {}),
  }));
  return { text, spans: json, atoms };
}

describe("inline derivation golden", () => {
  const actual = CORPUS.map(normalized);

  if (UPDATE) {
    test("rewrites the snapshot", () => {
      writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
      if (process.env.CI) throw new Error("UPDATE_GOLDEN 不应在 CI 中生效");
      console.warn(`[inline-derive-golden] 已重写 ${FIXTURE}（本次未与旧值比对）`);
      // 至少守住 JSON 无损往返：非 JSON 载荷会被 stringify 静默丢弃。
      expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(actual);
    });
    return;
  }

  const expected = JSON.parse(readFileSync(FIXTURE, "utf8")) as Array<
    ReturnType<typeof normalized>
  >;

  test.each(CORPUS.map((text, index) => [index, text] as const))(
    "corpus #%i %j",
    (index, text) => {
      expect(normalized(text)).toEqual(expected[index]);
    },
  );
});
