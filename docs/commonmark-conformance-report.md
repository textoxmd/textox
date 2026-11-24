# textox 编辑器 CommonMark 合规差异报告

- 比对基准：**CommonMark 0.31.2**（[spec.commonmark.org/0.31.2](https://spec.commonmark.org/0.31.2/)）
- 比对对象：textox 的 IR（WYSIWYG）编辑器 —— 解析 / 实时渲染 / 保存三条链路
- 产出形式：**差异报告**（不含代码改动）
- 生成日期：2026-10-22
- 最后刷新：2026-10-24（按当前 `develop` 行为复核）

---

## 1. 结论摘要

textox 的块级解析直接复用 markdown-it 的 `commonmark` 预设（`src/components/TextoEditor/src/parser.ts`），因此 **CommonMark 的块级语法几乎全部能正确解析**。总体判断：**差异已大幅收敛**——行内语法早期走自研的 “method-B” 扫描器（Typora 风格的简化实现），与规范存在语义级偏差；**后续工作已把行内语义收敛到 markdown-it**（定位层 `src/components/TextoEditor/src/features/inline-derive.ts`）：markdown-it 决定「哪些是语法、如何配对」，textox 只负责「这些语法在源文中的位置」。下列历史差异均已修复：

1. **反斜杠转义**（§4.1）：`\X` 解析期原样保留，`escape` 行内功能保护被转义字符；**反斜杠在光标离开时隐藏**（只显示字面字符），光标进入时显示源码。
2. **实体引用**（§4.2）：`md.disable("entity")`，`&amp;` / `&#42;` **原样保留**，不再解码、也不再激活语法。
3. **嵌套 / 配平括号 / 行内图片 alt**（§4.3）：`*![a](x)*`、`*[a](b)*`、`*<http://x>*` 可正确嵌套；`[a [b] c](u)`、`[t](foo(and(bar)))`、`[[a]](u)` 正确；`x ![a *em*](x.png) y` 仍是图片。
4. **行内代码**（§4.4）：识别与空白裁剪改由 markdown-it 决定，源码里的填充空格原样保留。
5. **强调/加粗**（§4.5）：flanking、rule-of-three、混合 run 嵌套均为 CommonMark 语义。
6. **自动链接**（§4.8）：`<foo@bar>`、`<a@b.co>` 均可识别，且源文原样保留。
7. **链接/图片的原始写法**（§4.9）：`[t](<u v>)`、`[t](u 'ti')`、`![a](<x y>)` 加载后保持原样（参考式链接是例外，见 §4.7）。

**现在剩下的差异集中在「保真度」**：canonical 序列化器（`serializer.ts`）会规范化语法形状（缩进代码 → 围栏、松散列表 → 紧凑、引用定义丢弃……）。这些**语义一致、源码被重写**，只有在开启 `source-preserve`（Beta，默认关闭）时才逐字节保留。此外还有明确列出的已知边界：松散列表不建模（§4.6）、引用定义不是节点（§4.7）、目标内含非 ASCII 空白（U+00A0 等）时定位失败、`~~~x~~~` 既非删除线也非下标（§4.9）。

> 历史：**「转义符失效」曾是本报告中最严重的问题**（**已于 2026-10-22 修复，见 §4.1**）：CommonMark 规定 `\*`、`` \` ``、`\[`、`\<` 等是字面量，修复前 textox 中的转义**不会阻止行内扫描器把后续文本识别为语法**，而且保存时反斜杠会**丢失**，文本反而变成真正的语法。

---

## 2. 方法与范围

编辑器有三条渲染链路（AGENTS.md）：IR（ProseMirror WYSIWYG）、SV（源码 textarea）、Preview/Export。

- **IR 是唯一的语法真源**：Preview/Export 从编辑器 DOM 渲染，不做第二套 markdown-it 解析。
- 行内标记的**语义**由 markdown-it 决定：加载期走 `parser.ts` 的 token → 节点映射；实时编辑期 `normalizeInlinePlugin`（`src/components/TextoEditor/src/normalize.ts`）在每个事务后按 `features/inline-derive.ts` 的结果**强制对齐**——该模块把 md-it 的 inline token 反推回源文位置，normalize 据此打/清 mark。
- 自研 “method-B” 扫描器（`inline-parse.ts` + `features/*.ts`）现在只负责 md-it 之外的扩展语法（高亮、上下标、删除线等），并在定位层无法映射时兜底。
- 本报告的状态判定同时看两条路径：`parse()`（加载）与 `parse → createState → apply(tr)`（实时/保存）。

证据来源：
- 代码：`parser.ts`、`serializer.ts`、`schema.ts`、`inline-parse.ts`、`normalize.ts`、`features/*.ts`（尤其 `inline-derive.ts`、`load-assemble.ts`、`escape.ts`、`url.ts`）、`official-plugins/*`
- 测试：`src/components/TextoEditor/tests/**`、`specs/**`
- 人工验收：`docs/verification/commonmark-checklist.md`（见 §9）
- **实测**：临时 vitest 用例（已删除）对每条差异跑真实 `parse` / `createState().apply(tr)` / `serialize`，输出见 §7。

状态图例：`✅ 完整` · `🟡 部分（有差异）` · `🔴 默认不支持`

---

## 3. 总表：CommonMark 章节 × 支持状态

| CommonMark 章节 | 状态 | 说明 |
|---|---|---|
| 2.1 Tabs | 🟡 | 解析正确（4 列制表位）；canonical 输出用空格，制表缩进的代码块被写成围栏 |
| 2.2 Insecure characters | ✅ | 交由 markdown-it（未单独实测） |
| 2.3 Backslash escapes | ✅ | 解析期保留 `\X`，`escape` 行内功能保护被转义字符；保存保持反斜杠；光标离开时反斜杠隐藏（曾失效，2026-10-22 修复，见 §4.1） |
| 2.4 Entity / 数字字符引用 | ✅ | `md.disable("entity")`：`&amp;` / `&#42;` 原样保留，不解码、不激活语法（见 §4.2） |
| 3.2 Thematic breaks | 🟡 | 语义一致；`- - -`/`----` 规范化为 `---`（变体 `-`/`*`/`_` 保留） |
| 3.3 ATX headings | 🟡 | 语义一致；闭合 `#`、行首 ≤3 空格被丢弃 |
| 3.4 Setext headings | ✅ | 以 `style` 属性区分并原样回写 |
| 3.5 Indented code blocks | 🟡 | 解析正确；保存一律写成围栏（保真度差异） |
| 3.6 Fenced code blocks | ✅ | `` ` ``/`~`、围栏长度、info string、嵌套缩进均保留 |
| 3.7 HTML blocks | ✅* | 需 `html` 插件（**默认启用**）；关闭时回落为段落文本 |
| 3.8 Link reference definitions | 🟡 | markdown-it 解析期消耗（无节点）；canonical 保存丢弃，`source-preserve` 才保留（§4.7） |
| 3.9 Paragraphs | ✅ | 自定义 paragraph 规则保留行尾空白 |
| 3.10 Blank lines | 🟡 | 语义一致；连续空行规范化为 1 行 |
| 4.1 Block quotes | 🟡 | 懒续行被改写为显式 `> ` |
| 4.2 List items | 🟡 | **松散/紧凑不建模**，松散列表保存为紧凑（§4.6） |
| 4.3 Lists | 🟡 | 标记/分隔符保留；序号重新编号 |
| 5.1 Code spans | ✅ | 识别与空白裁剪由 md-it 决定：`` ` a` `` 内容为 ` a`，`` `   ` `` 也识别为 code span；源码填充空格原样保留（见 §4.4） |
| 5.2 Emphasis and strong emphasis | ✅ | flanking、rule-of-three、混合 run 嵌套均为 CommonMark 语义（见 §4.5） |
| 5.3 Links | ✅ | 嵌套/配平括号正确，原始写法保留；参考式链接加载时规范化为内联形式（§4.7） |
| 5.4 Images | ✅ | alt 含标记不再退化为链接；嵌套括号与原始写法保留 |
| 5.5 Autolinks | ✅ | md-it autolink 规则：`<foo@bar>`、`<a@b.co>` 均识别，源文原样保留 |
| 5.6 Raw HTML | ✅* | 同 3.7；行内标签走**白名单**，其余回落为文本 |
| 5.7 Hard line breaks | ✅ | 反斜杠换行 / 多余行尾空格统一写成两个空格（语义等价） |
| 5.8 Soft line breaks | ✅ | 原样保留为 `\n` |
| 5.9 Textual content | ✅ | 逐字符序列化 |

`✅*` = 依赖默认启用的插件。

---

## 4. 语义级差异（历史问题与当前状态）

> 这些不是“保存时改写了写法”，而是**渲染结果或链接目标本身与规范不同**。以下按最初的严重度排序；**已修复项保留“修复前”记录作历史对照**，当前状态以每节开头的状态行为准。

### 4.1 转义符失效 —— 转义反而触发语法 ✅（已修复 2026-10-22）

> **状态：已修复。** 设计见 `docs/superpowers/specs/2026-10-22-backslash-escape-design.md`，实现计划见 `docs/superpowers/plans/2026-10-22-backslash-escape-fix.md`。
> 做法：解析期保留 `\X` 到文本块 + 新增核心行内功能 `escape`（优先级 0.2）把被转义字符标为 `consumed`，其后的扫描器一律跳过；序列化不再二次转义。
> 修复后 `\*`、`` \` ``、`\[`、`\<`、`\~`、`\^`、`\=` 等均不再触发语法，保存保持反斜杠（`tests/features/escape.test.ts` 覆盖）。
> 展示：**光标离开该段时反斜杠隐藏**（只显示字面字符），光标进入时才显示 `\` 源码。
> 以下为**修复前**的问题记录，保留作历史对照。

**规范**：`\*`、`` \` ``、`\[`、`\<`、`\~` 等把标点变为字面量。

**实际（修复前）**：markdown-it 在解析期就把反斜杠剥掉，文本块里剩下裸分隔符；随后 `normalize` 对文本跑 `parseInline`，扫描器**完全不看反斜杠**，于是把分隔符识别为语法并打上 mark；保存时 mark 的 `extRanges` 又抑制了转义 → **反斜杠彻底丢失**。

证据（修复前）：`parser.ts:248-250`（escape 已剥离）、`inline-parse.ts:30-45`（扫描器无转义概念）、`packages/markdown-editor-runtime/src/inline-parse.ts:83-103`（`scanRuns` 只看空白）、`normalize.ts:259-318`、`serializer.ts:198-206, 295-297`（extRanges 抑制转义）。

实测（修复前，§7.2）：

| 输入 | 实时 mark | 保存输出 |
|---|---|---|
| `\*not em\*` | `not em`[em] | `*not em*` ← 反斜杠没了，变成斜体 |
| `` \`not code\` `` | `not code`[code] | `` `not code` `` |
| `\~not sub\~` | `not sub`[sub] | `~not sub~` |
| `\<http://x.com>` | `http://x.com`[autolink] | `<http://x.com>` |
| `\[a\](b)` | `a`[link] | `[a](b)` ← 变成真链接 |

对照：`\#hash` → `\#hash` ✅（不在 method-B 触发集内，修复前后都正常）。

**影响（修复前）**：用户无法用反斜杠写出字面量 `*`、`` ` ``、`[`、`<` 等；文档在编辑/保存后语义漂移。

### 4.2 实体引用解码后可激活语法 ✅（已修复）

> **状态：已修复。** `parser.ts` 显式 `md.disable("entity")`：`&amp;` / `&#42;` 等在解析期**原样保留**，定位层依赖 `content === 原文` 也能正常工作。实体不再被解码，自然也不会解码出分隔符去激活语法；保存原样写回。
> 修复前：markdown-it 解析期解码实体，解码出的 `*` 会落入 method-B 扫描，保存时实体写法丢失、变成真语法。

**当前行为**：

| 输入 | 实时 | 保存输出 |
|---|---|---|
| `&amp;` | `&amp;`（不解码） | `&amp;` |
| `&#42;x&#42;` | `&#42;x&#42;`（无强调） | `&#42;x&#42;` |
| `&lt;http://x.com&gt;` | 源文原样；其中裸 URL 可能被 textox 的**裸 URL 扩展**识别（非 CommonMark autolink） | `&lt;http://x.com&gt;` |

**修复前的实测（历史对照）**：

| 输入 | 实时 | 保存输出 |
|---|---|---|
| `&amp;` | `&` | `&`（实体丢失，语义等价） |
| `&#42;x&#42;` | `x`[em] | `*x*`（实体写法的 `*` 变成斜体） |
| `&lt;http://x.com&gt;` | autolink | `<http://x.com>` |

### 4.3 嵌套括号：加载正常，编辑后链接丢失（文本已不再被破坏） ✅（已修复）

> **状态：已修复。** 行内定位层 `features/inline-derive.ts` 不再用简化正则，而是从 markdown-it 的 `link_open` / `link_close` / 图片 token 反推源文位置——嵌套方括号、配平圆括号、转义 `]` 都由 md-it 解析后交给 textox 定位；`features/url.ts` 负责把非 ASCII 的 percent-encoding 还原，`features/load-assemble.ts` 保证加载期按源文原样回放。图片 alt 里的标记只作为 alt 内容展示，不再抢占 `consumed` 导致退化成链接。
> 修复前：`link.ts` / `image.ts` 用 `[^\]]*?` 一类的简化正则，只能处理「加载时正确、一旦事务就被 normalize 清 mark」的场景；配平括号目标会被截断；alt 含标记的图片会退化成链接。

**当前行为**（实测）：

| 输入 | 实时/保存 |
|---|---|
| `[a [b] c](url)` | link(href=url)，源文仍是 `[a [b] c](url)` |
| `[a\]b](url)` | link(href=url)，源文不变 |
| `![a [b] c](x.png)` | image(src=x.png)，源文不变 |
| `[a](b(c)d)` | link，href=`b(c)d`，源文不变 |
| `[t](foo(and(bar)))` | link，href=`foo(and(bar))` |
| `[[a]](u)` | link（文本 `[a]`，目标 `u`） |
| `*![a](x)*` / `*[a](b)*` / `*<http://x>*` | 强调正确包裹图片 / 链接 / autolink |
| `x ![alt *em*](a.png) y` | 仍是 image，alt 内的 `*em*` 不影响图片识别 |

**修复前的现象（历史对照）**：

> | 输入 | `parse()` 结果 | 实时/保存 |
> |---|---|---|
> | `[a [b] c](url)` | link(href=url) ✅ | link mark 被清除 → `[a [b] c](url)`（链接丢失） |
> | `[a\]b](url)` | link(href=url) ✅ | link mark 被清除 → `[a\]b](url)` |
> | `![a [b] c](x.png)` | image(src=x.png) ✅ | image mark 被清除 → `![a [b] c](x.png)` |
>
> 平衡括号目标被截断（实时）：`[a](b(c)d)` 加载 href=`b(c)d` ✅，实时 href=`b(c` ❌。
>
> 行内图片 alt 含标记时退化为链接：`x ![alt *em*](a.png) y` 加载时是 image ✅，实时变成 `!` + link + em（图片消失，`!` 裸露为文本）。原因：`code` / `emphasis` 先于 `image` 扫描并占用 `consumed`，`image.ts` 见到 `consumed` 即放弃，随后 link 扫描器补位。
>
> 注：**独占一行的** `![alt *em*](x.png)` 会被提升为块级 `image_ref` 节点（`image-ref.ts`），`normalize` 跳过该节点，所以不受此问题影响；只有**行内嵌在段落里**的图片会退化。

### 4.4 全空白 code span 不被识别 ✅（已修复）

> **状态：已修复。** 行内代码的**识别与空白裁剪**改由 markdown-it 的 `code_inline` token 决定，`features/code.ts` 只保留 schema / 序列化 / 定位接线。反引号 run 的配对与源文位置由 `features/inline-derive.ts` 完成。
> 修复前：`features/code.ts` 用 `if (!/\S/.test(inner)) continue;` 直接跳过全空白内容，并从两侧独立裁剪空白。

**当前行为**（实测）：

| 输入 | 实时 | 保存输出 |
|---|---|---|
| `` ` a` `` | code，内容为 ` a`（单侧空格不裁） | `` ` a` `` |
| `` `   ` `` | 识别为 code span；md-it 会把连续空格折叠为 1 个（md-it 自身行为） | `` `   ` ``（源码填充空格原样保留） |
| `` `` b ` c `` `` | code，内容为 ``b ` c`` | 原样 |

### 4.5 强调/加粗：flanking 与 run 规则被简化 ✅（已修复）

> **状态：已修复。** 强调/加粗的配对改为 markdown-it 的 delimiter stack（`em_open` / `strong_open` / `*_close` token），**flanking、rule-of-three、混合 run 嵌套全部由 md-it 决定**；`features/emphasis.ts` 只保留 schema / 序列化 / `Mod-b` 快捷键接线。行内位置仍由 `features/inline-derive.ts` 映射回源文。
> 修复前：`scanRuns` 的 `canOpen/canClose` 只判空白，没有标点 flanking；`emphasis.ts` 只对两端 run 都 ≥3 的 `***x***` 做一次嵌套。

**当前行为**（实测/规范一致）：

| 输入 | 当前 | CommonMark |
|---|---|---|
| `a*"foo"*` | 无强调 | ✅ 无强调（开 run 非 left-flanking） |
| `*foo**bar**baz*` | em 包 strong：`foo` 斜、`bar` 斜+粗、`baz` 斜 | ✅ `<em>foo<strong>bar</strong>baz</em>` |
| `****foo****` | 双重加粗（PM 中同为 `strong` 标记） | ✅ `<strong><strong>foo</strong></strong>` |
| `**foo*bar**` | 整体加粗，内容 `foo*bar` | ✅ `<strong>foo*bar</strong>` |
| `**1*` / `*1**` | rule-of-three 配对 | ✅ |
| `***x***` | em 包 strong | ✅ |

（以上均实测；文本层可往返，差异已不在渲染语义。）

**修复前的实测（历史对照）**：

> | 输入 | 修复前渲染 | CommonMark |
> |---|---|---|
> | `a*"foo"*` | `"foo"` 为 em | 无强调 |
> | `*foo**bar**baz*` | 两个独立 em（`bar` 未加粗） | `<em>foo<strong>bar</strong>baz</em>` |
> | `****foo****` | em 包 strong | `<strong><strong>foo</strong></strong>` |
> | `**foo*bar**` | em 覆盖 `*foo` | `<strong>foo*bar</strong>` |
> | `***x***` | em(strong(x)) ✅ | ✅ 一致 |

### 4.6 松散列表不建模 🟡

schema/序列化器没有 loose/tight 属性；只有 item 内含多个块时才输出空行（`serializer.ts` 的列表序列化规则）。

`- a\n\n- b` → 保存为 `- a\n- b`。文本等价，但**导出 HTML 会按紧凑列表渲染**（`<li>` 内不包 `<p>`），与 CommonMark 语义不同。

### 4.7 链接引用定义不是节点 🟡

markdown-it 在解析期把 `[label]: url "title"` 全部消耗（无 token）。因此：

- 引用式链接 `[t][r]` / `[t][]` / `[t]` **加载时能正确解析**并物化为行内链接（实测 `[t](/url)`）✅；
- 但定义块本身没有节点，**canonical 保存会丢弃它**；只有 `source-preserve`（默认关闭）把定义行当自由段保留；
- 实时输入 `[label]: url` 会由 `features/ref-def.ts` 的「草稿 → Enter 提交」机制转成结构化 `link_def` 块，但**加载既有文档**时 markdown-it 已先消耗定义，因此该节点帮不上加载路径；
- 已知边界：**整篇只有定义的文件** `source-preserve` 判定为 unsupported，会整段丢失（见 `src/plugins/__tests__/footnote-degraded.test.ts`、`source-preserve.test.ts`）。

### 4.8 Autolink 邮箱规则过严 ✅（已修复）

> **状态：已修复。** 自动链接改由 markdown-it 的 `autolink` 规则判定（`parser.ts` 启用，`features/autolink.ts` 只声明 mark 与定界符）；**源文原样保留**——percent-encoded / punycode 不再被改写。
> 修复前：自研 `EMAIL_PART` 要求域名带 `.` 且 TLD ≥2 位。

**当前行为**（实测）：

| 输入 | 当前 | CommonMark |
|---|---|---|
| `<foo@bar>` | autolink ✅ | ✅ |
| `<foo@bar.c>` | autolink ✅ | ✅（规范允许 1 位 TLD） |
| `<a@b.co>` | autolink ✅ | ✅ |
| `<http://x.com>` | autolink ✅，源文不变 | ✅ |

**修复前的实测（历史对照）**：

> | 输入 | 修复前 textox | CommonMark |
> |---|---|---|
> | `<foo@bar>` | 不识别 → `\<foo@bar\>` | autolink ✅ |
> | `<foo@bar.c>` | 不识别 | autolink ✅ |
> | `<http://x.com>` | autolink ✅ | ✅ |
>
> （URI 侧反而更宽松：允许 1 位 scheme、无 2–32 长度上限。）

### 4.9 其他行内细节 ✅（已修复，含已知边界）

> **状态：已修复。** 链接/图片的**原始写法**由定位层从 token 反推、加载期由 `load-assemble.ts` 按源文回放，因此不再把 `[t](<u v>)` 归一成 `[t](u%20v)`、也不再强制把 title 写成双引号。
> 修复前：加载时 markdown-it 归一目标与 title，实时输入又因简化正则无法识别 `'...'` / `(...)` title 与尖括号目标。

**当前行为**：

- **单引号/圆括号 title**：`[t](u 'ti')` 识别为链接，光标进入时源码仍是 `[t](u 'ti')`。
- **尖括号目标**：`[t](<u v>)`、`![a](<x y>)` 识别为链接/图片，源码保持尖括号写法。
- **链接目标内的 `*`**：`[a](x*y*z)` 的目标按字面处理，不会把 `y` 解析成强调。
- **参考式链接例外**：`[t][r]` / `[t][]` / `[t]` 仍在加载时**规范化**为 `[t](/url)`（实时路径拿不到文档级 references，保留原写法会导致编辑后链接丢失，见 §4.7）。
- **硬换行**：反斜杠换行与多余行尾空格统一写成两个空格（语义等价，形状改写）。
- **已知边界 1**：目标内含**非 ASCII 空白**（U+00A0 等）时定位失败——源文保留，但链接 mark 不生成（定位层报 `target 定位失败` 后回落）。
- **已知边界 2**：`~~~x~~~` 既非删除线也非下标。扩展层有意跳过三连波浪号；独立成行时按 CommonMark 落为围栏代码块起始。

**修复前的现象（历史对照）**：

> - **单引号/圆括号 title**：加载时 markdown-it 会归一为双引号（`[a](b 't')` → `[a](b "t")`）✅；但**实时输入** `'...'` / `(...)` 形式的 title 不被 `LINK_RE` 识别。
> - **尖括号目标**：加载正常（`[a](<https://x.com>)` → `[a](https://x.com)`）✅；实时输入 `[a](<url>)` 会被 autolink 扫描器抢占 `<url>` 而误判。

### 4.10 顺带修复：任务列表内的行内偏移

任务项段落以 `task_marker` 原子节点开头：它占一个 PM 位置但不在 `textContent` 里。修复前 `normalize` 把 `parseInline` 的「文本偏移」直接当「内容偏移」使用，原子节点之后的所有 span 整体左移，行内代码的闭合反引号隐藏区间会压到最后一个字母上（`- [ ] ` + `` `abc` `` 的 `c` 不可见）。

已修复：`normalize` 增加 `textContent → 块内容偏移` 的映射，先按文本偏移定位，再换算到 PM 位置。回归用例见 `tests/features/task-inline-offset.test.ts`。

---

## 5. 仅保真度差异（语义一致，源码被规范化）

| 构造 | 输入 → canonical 输出 |
|---|---|
| 缩进代码 | `    code` → ` ```\ncode\n``` ` |
| 松散列表 | `- a\n\n- b` → `- a\n- b` |
| 有序序号 | `1. a\n1. b` → `1. a\n2. b` |
| 分隔线 | `- - -` / `----` → `---` |
| ATX 闭合/缩进 | `# H #` / `   # H` → `# H` |
| 懒续行引用 | `> a\nb` → `> a\n> b` |
| 连续空行 | `a\n\n\n\nb` → `a\n\nb` |
| 硬换行 | `a\` + 换行 → `a  ` + 换行 |
| 引用式链接 | `[t][r]` + 定义 → `[t](/url)`，定义被丢弃（§4.7） |
| Setext 标题 | `H\n===` → `H\n===`（✅ 保留，属少数原样回写者） |

> 行内写法（转义、实体、链接 title / 尖括号目标、code span 填充空格）不在此表：它们现在都按源文保留。开启 `source-preserve`（`src/components/TextoEditor/src/source-preserve-config.ts`，Beta，默认关闭）可让**未编辑的顶层单元**逐字节保留，从而消除上表大部分差异；无法映射时仍回落 canonical。

---

## 6. 非 CommonMark 语法（由插件/核心扩展提供，默认状态）

textox 默认开启大量扩展语法。比对 CommonMark 时需注意「这些不是规范的一部分」：

| 插件 | 扩展语法 | 默认启用 |
|---|---|---|
| `table` | GFM 管道表格 | 是 |
| `html` | GFM HTML 块（7 类）+ 行内 HTML 白名单 + HTML 注释 | 是 |
| `footnote` | `[^N]` 脚注 + 定义重定位 | 是 |
| `math` | 行内 `$…$` / `\(…\)`、块 `$$…$$` / ` ```latex ` / ` ```math ` | 是 |
| `front-matter` | 文档首部 YAML `---…---` | 是 |
| `alert` | GFM alerts `[!NOTE]` 等 | 是 |
| `emoji` | `:name:` 短代码 | 是 |
| `highlight` | `==高亮==` | 是 |
| `sub-sup` | `~下标~` / `^上标^` | 是 |
| `toc` | `[toc]` | 是 |
| `syntax-highlight` | 代码围栏高亮 | 是 |
| `mermaid` | ` ```mermaid ` | 是 |
| `excalidraw` | `![](x.excalidraw)` 嵌入 | 是 |
| `underline` | `<u>text</u>` | 是 |
| 核心（非插件） | `~~删除线~~`、任务列表、裸 URL 自动链接、独立成行的图片块 `image_ref` | 是 |

**注意**：关闭插件 ≠ 回落为字面量文本，唯一例外是脚注 —— 关闭 `footnote` 后 `[^1]: Def` 会被 CommonMark 当**链接引用定义**解析，`[^1]` 退化为引用链接并序列化为 `[^1](Def)`（见 `src/plugins/__tests__/footnote-degraded.test.ts`）。

---

## 7. 实测数据（原始输出摘录）

用真实 `parse` / `createState().apply(tr)` / `serialize` 跑出（临时用例已删除）。§7.1 是 **2026-10 末复测的当前行为**；§7.2 是**修复前的原始输出**，仅作历史对照（其中转义部分的输出与当前一致，其余已变）。

### 7.1 当前行为（复测）

| 输入 | 实时 | 保存输出 |
|---|---|---|
| `\*not em\*` | 文本 `\*not em\*`，无 mark | `\*not em\*` |
| ``\`not code\` `` | 文本原样，无 code mark | ``\`not code\` `` |
| `\[a\](b)` | 文本原样，无 link mark | `\[a\](b)` |
| `&amp;` | `&amp;`（不解码） | `&amp;` |
| `&#42;x&#42;` | `&#42;x&#42;`（无 em） | `&#42;x&#42;` |
| `[a [b] c](url)` | link(href=url) | 原样 |
| `[a](b(c)d)` | link(href=`b(c)d`) | 原样 |
| `x ![alt *em*](a.png) y` | image(src=`a.png`)，alt 内 em 正常展示 | 原样 |
| `` ` a` `` | code，内容 ` a` | `` ` a` `` |
| `` `   ` `` | code（内容折叠为 1 空格） | `` `   ` `` |
| `a*"foo"*` | 无强调 | 原样 |
| `*foo**bar**baz*` | em 包 strong（`bar` 斜+粗） | 原样 |
| `****foo****` | 双重加粗 | 原样 |
| `**foo*bar**` | strong，内容 `foo*bar` | 原样 |
| `<foo@bar>` | autolink | 原样 |
| `<a@b.co>` | autolink | 原样 |
| `[t](<u v>)` | link，源码保持 `<u v>` | 原样 |
| `[t](u 'ti')` | link，源码保持 `'ti'` | 原样 |
| `[t][r]` + `[r]: /url` | link，物化为 `[t](/url)` | `[t](/url)` |
| 任务列表 `- [ ] ` + `` `abc` `` | 行内代码完整覆盖 `abc`（无字符被隐藏） | 原样 |

### 7.2 修复前数据（历史对照）

转义（**与当前一致**）：

```
{"in":"\\*not em\\*","live":"\"\\\\*not em\\\\*\"[]","out":"\\*not em\\*"}
{"in":"\\`not code\\`","live":"\"\\\\`not code\\\\`\"[]","out":"\\`not code\\`"}
{"in":"\\[a\\](b)","live":"\"\\\\[a\\\\](b)\"[]","out":"\\[a\\](b)"}
```

实体（修复前：解码后不回写）：

```
{"in":"&amp;","live":"\"&\"[]","out":"&"}
{"in":"&#42;x&#42;","live":"\"*\"[] \"x\"[em] \"*\"[]","out":"*x*"}
```

嵌套括号 / 行内图片 / 链接目标（修复前）：

```
{"in":"[a [b] c](url)","parsed":"...\"a [b] c\"[link{href:url}]...","live":"\"[a [b] c](url)\"[]","out":"[a [b] c](url)"}
{"in":"[a](b(c)d)","parsed":"href=b(c)d","live":"href=b(c","out":"[a](b(c)d)"}
{"in":"x ![alt *em*](a.png) y","parsed":"...\"alt *em*\"[image{src:a.png}]...","live":"...\"alt *\"[link] \"em\"[em+link] \"*\"[link]...","out":"x ![alt *em*](a.png) y"}
{"in":"![a [b] c](x.png)","parsed":"...\"a [b] c\"[image]...","live":"\"![a [b] c](x.png)\"[]","out":"![a [b] c](x.png)"}
```

code span / 强调 / 自动链接（修复前）：

```
{"in":"`   `","live":"\"` `\"[]","out":"` `"}
{"in":"` a`","live":"\"` \"[] \"a\"[code] \"`\"[]","out":"` a`"}
{"in":"a*\"foo\"*","live":"\"a*\"[] \"\\\"foo\\\"\"[em] \"*\"[]","out":"a*\"foo\"*"}
{"in":"*foo**bar**baz*","live":"\"*\"[] \"foo*\"[em] \"*bar*\"[] \"*baz\"[em] \"*\"[]","out":"*foo**bar**baz*"}
{"in":"****foo****","live":"\"*\"[] \"**\"[em] \"*foo*\"[em+strong] \"**\"[em] \"*\"[]","out":"****foo****"}
{"in":"<foo@bar>","live":"\"<foo@bar>\"[]","out":"<foo@bar>"}
```

块级规范化（仍成立）：

```
{"in":"    indented code","out":"```\nindented code\n```"}
{"in":"- a\n\n- b","out":"- a\n- b"}
{"in":"- - -","out":"---"}
{"in":"# H #","out":"# H"}
{"in":"> a\nb","out":"> a\n> b"}
{"in":"a\n\n\n\nb","out":"a\n\nb"}
{"in":"```js extra info\ncode\n```","out":"```js extra info\ncode\n```"}
```

---

## 8. 建议与落地状态

按投入产出排序，标注当前状态：

1. **转义保护**：**已实施**（2026-10-22，见 §4.1 与 `docs/superpowers/specs/2026-10-22-backslash-escape-design.md`）。
2. **行内图片 alt**：**已实施**——定位层 `features/inline-derive.ts` 从 md-it token 取位置，alt 内的标记不再抢占 `consumed`（见 §4.3）。
3. **嵌套括号**：**已实施**——`link.ts` / `image.ts` 不再依赖简化正则，配平括号与嵌套方括号由 md-it 解析、定位层映射（见 §4.3）。
4. **code span 空白规则**：**已实施**——识别/裁剪交给 md-it，源码填充空格原样保留（见 §4.4）。
5. **强调 flanking / rule-of-three**：**已实施**——配对交给 md-it 的 delimiter stack（见 §4.5）。
6. **邮箱 autolink**：**已实施**——交给 md-it 的 `autolink` 规则（见 §4.8）。
7. **行内保真度**（转义、实体、链接/图片原始写法）：**已实施**（见 §4.1、§4.2、§4.9）。
8. **块级保真度**：**部分实施**——以下仍未做：
   - loose/tight 未建模，松散列表保存为紧凑（§4.6）；
   - 缩进代码仍统一写成围栏（§3.5）；
   - `source-preserve` 仍是 Beta 且默认关闭。
9. **引用定义**：**未实施**——加载期定义仍无节点，canonical 保存丢弃（§4.7）。
10. **目标含非 ASCII 空白**：**未实施**——U+00A0 等空白会令定位失败（§4.9）。
11. **`~~~x~~~`**：**未实施**——扩展层有意跳过；独立成行时落为围栏代码块（§4.9）。

---

## 9. 人工验收

自动化用例覆盖解析 / 实时 / 序列化三条路径，但渲染形态（定界符隐藏、widget、光标进入/离开）仍建议人工过一遍：

- **清单**：`docs/verification/commonmark-checklist.md`
- **用法**：在 textox 里打开该清单，按编号逐条对照「期望」与实际渲染，勾选 `- [ ]` 即完成验收；第 11 节是保存往返检查。
- 清单条目与本文 §4 / §5 一一对应；任一「已生效」条目失败即视为回归。

---

## 附：本报告引用的关键代码位置

| 主题 | 位置 |
|---|---|
| markdown-it 基线（commonmark, html:false, entity 关闭） | `src/components/TextoEditor/src/parser.ts`（`getParser`） |
| paragraph 保留行尾空白 | `src/components/TextoEditor/src/parser.ts`（`paragraphPreserveTrailing`） |
| 解析：保留 `\X` 到文本块 | `src/components/TextoEditor/src/parser.ts`（`escapePreserveBackslash`） |
| 块级 token → 节点映射 | `src/components/TextoEditor/src/parser.ts`（block token 映射段） |
| 行内 text/softbreak/hardbreak | `src/components/TextoEditor/src/parser.ts`（inline token 映射段） |
| 行内 token → 源文定位（语义由 md-it 决定） | `src/components/TextoEditor/src/features/inline-derive.ts` |
| 加载期源文组装（按原写法回放） | `src/components/TextoEditor/src/features/load-assemble.ts` |
| 链接/图片目标非 ASCII 还原 | `src/components/TextoEditor/src/features/url.ts` |
| 图片加载状态（扫描器与定位层共享） | `src/components/TextoEditor/src/features/image-load-status.ts` |
| 转义保护（行内功能） | `src/components/TextoEditor/src/features/escape.ts` |
| 序列化：行内文本原样输出 + extRanges | `src/components/TextoEditor/src/serializer.ts`（行内序列化段） |
| 代码块 / 列表 / 引用 / hr 序列化 | `src/components/TextoEditor/src/serializer.ts`（block 规则） |
| 行内扫描编排（仅扩展语法与兜底） | `src/components/TextoEditor/src/inline-parse.ts` |
| 扩展语法 flanking（仅空白） | `packages/markdown-editor-runtime/src/inline-parse.ts`（`scanRuns`） |
| normalize 强制对齐 mark | `src/components/TextoEditor/src/normalize.ts`（`normalizeInlinePlugin`） |
| 任务列表原子节点的偏移映射 | `src/components/TextoEditor/src/normalize.ts`（textContent → 块内容偏移） |
| 强调/加粗接线 | `src/components/TextoEditor/src/features/emphasis.ts` |
| code span 接线 + 填充空格还原 | `src/components/TextoEditor/src/features/code.ts` |
| link 接线（原始写法保留） | `src/components/TextoEditor/src/features/link.ts` |
| image 接线 + 渲染钩子 | `src/components/TextoEditor/src/features/image.ts` |
| autolink 接线 | `src/components/TextoEditor/src/features/autolink.ts` |
| 节点/标记 schema | `src/components/TextoEditor/src/schema.ts` |
| 插件默认启用判定 | `src/plugins/pluginStatus.ts`（`isPluginEnabled`） |
| source-preserve 开关（默认关） | `src/components/TextoEditor/src/source-preserve-config.ts`（`isSourcePreserveEnabled`） |
