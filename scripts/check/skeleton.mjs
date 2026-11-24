#!/usr/bin/env node
// 骨架硬规则守护：src/ 的「生产代码」不得出现插件专属标识字面量。
//
// 排除项（按定义排除，不是放水）：
//   - **/tests/**、**/__tests__/**、**/specs/** —— fixtures 合法使用插件扩展名
//
// 注：`src/i18n/**` 曾整体豁免（历史插件文案 key 直接内联在核心 i18n 文件里）；
// 迁到「插件文案随插件走」（插件 src/locales.ts，注入 plugins 命名空间）后，
// 插件专属字面量已不在 src/i18n 出现，故取消该目录豁免，纳入统一扫描。
//
// 用法：bun run check:skeleton
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'tests', '__tests__', 'specs']);
const EXTS = new Set(['.ts', '.tsx', '.css']);

// 第一方插件标识（大小写不敏感）。新增第一方插件时在此补一条。
// HTML 插件：只匹配语法功能/节点/标记专属标识（html_block / html-inline /
// html_comment …），不误伤 dangerouslySetInnerHTML、`html: true`、text/html、
// markdownToHtml 等常见写法。
// 表格插件：只匹配语法功能/节点/工具栏专属标识（table_cell / table-tb /
// table-resize …）。不收紧裸 `table`：核心仍存在无法消除的合法通用用法——
// 内容/编辑器主题用 `table th, table td` 元素选择器给单元格加边框/内边距
// （插件不接管这些），以及主题 surface token（`--editor-table-*`）。
// 收紧裸词会误伤。
const BANNED = [
  /excalidraw/i,
  /picgo/i,
  /html_block|html-block|html_inline|html-inline|html_comment|html-comment/i,
  /table_cell|table_row|table_open|table_close|tableCanonical|spliceTable|tableToolbar|table-toolbar|table-tb|table-resize|insertTable|buildTable/i,
  /inline_math|math_inline|texmath/i,
  // math/mermaid 插入命令已插件化：只禁命令专有标识，不禁裸 mermaid/latex
  // （CSS 的 .mermaid-* 选择器、codeLanguageMeta.SPECIAL_LANGUAGES、$$ 规则仍合法存在）。
  // `\bmath_block\b` 用词边界避开核心标识符 `MATH_BLOCK_RE`（_ 是 word 字符，
  // 故不会命中），同时仍能拦 `'math_block'` 字面量。
  /\bmath_block\b|insertMathBlock|insertMermaid/i,
  // alert 插件：只禁提醒框专属标识（拆分 ruler / 装饰类名 / 类型 class），
  // 不禁 `alert(`（window.alert）与 `.alert-banner`（主题编辑器横幅）。
  /alert_split|alertSplit|alert-label|alert-(note|tip|important|warning|caution)\b/i,
  // footnote 插件：源码/实现/样式专属标识（src/i18n 已排除、CSS 与 .d.ts 已迁出）。
  /footnote|fn-def|fn-tooltip|reversefootnote|isFootnoteDefPara|scanFNRef/i,
  // front-matter 插件：只禁实现专属标识（节点/token 类型、DOM 标签、camelCase
  // 识别符），不禁连字符 `front-matter`——它是通用领域词，且 specs/tests 目录
  // 已被 SKIP_DIRS 排除。
  /front_matter|frontMatter|yaml-block/i,
  // toc 插件：裸 `toc` 过于通用，只禁定向标识——语法字面量、parseDOM
  // 选择器、插件类名与实现符号。
  /\[toc\]|div\.toc|toc-list|toc-item|toc-empty|toc-h[1-6]|TocNodeView|tocRefreshPlugin|tocSyntaxFeature/i,
  // 语法高亮插件：核心不得硬编码 hljs 语法模块；整包/常用包导入同样属于硬编码
  // （语言由插件经 markdown-editor:syntaxHighlight 贡献，核心只保留 /lib/core）。
  /highlight\.js\/lib\/(?:languages|common)|(?:from|import)\s*\(?\s*['"]highlight\.js['"]/i,
  // typing-particle 插件：粒子实现/配置/预览专属标识（迁出后骨架不得回潮）。
  /typing-particle|typingParticle|ParticleEffectConfig|ParticleConfigStore|renderPreviewOnCanvas|particleConfig/i,
  // underline 插件：只禁功能标识（引号包裹的 mark 名/分隔符、实现符号、死 CSS 类名），
  // 不禁 `text-decoration: underline` / `hover:underline` 等合法通用写法
  // （注：独立引号字符串 "underline"（如 Tailwind class）也会命中，当前 src 无此用法）。
  /(?:['"](?:underline|<\/?u>)['"]|toggleUnderline|toggle_underline|underline-content|underline-marker)/i,
  // highlight 插件：禁 token / 语法字面量 / 实现符号 / 死 CSS 类名。
  // 避开代码高亮：highlight.js 导入、codeHighlight* 标识、
  // MARKDOWN_EDITOR_SYNTAX_HIGHLIGHT、applyCodeHighlightTheme。
  /--highlight-color|['"](?:highlight|==)['"]|highlight-content|highlight-marker/i,
  // sub-sup 插件：禁 feature 名 / 实现符号 / 重新 import 核心 feature / mark 名
  // 与标签 / 专属扫描调用。不误伤 subscription 等普通词，也不 ban 裸 `"sub-sup"`
  // ——它是描述性名称，specs/tests 目录已被 SKIP_DIRS 排除。
  /\bsubSup\b|from\s*['"][^'"]*sub-sup(?:\.ts)?['"]|name:\s*['"]sub-sup['"]|<\s*\/?(?:sub|sup)\s*>|tag:\s*['"](?:sub|sup)['"]|scanFixedDelim\([^)]*['"](?:sub|sup)['"]/i,
  // emoji 插件：禁 glyph / 自动补全专属标识、实现符号、重新 import 核心 feature、
  // 结构化 name / kind。不 ban 裸 `emoji` / `:smile:`——它们是通用描述性文本。
  /emoji-glyph|emoji-completion|emojiAutocomplete|EMOJI_RE|from\s*['"][^'"]*features\/emoji|name:\s*['"]emoji['"]|kind:\s*['"]emoji['"]/i,
  // auto-pair 插件：禁实现符号与结构化 name / import。不 ban 连字符 `auto-pair`
  // （核心 decorations.ts 注释散文在用），也不 ban snake `auto_pair`（它是
  // 通用描述性名称）。
  /[aA]utoPair|shouldAutoPair|backspaceClearPair|from\s*['"][^'"]*features\/auto-pair|name:\s*['"]auto_pair['"]/,
  // heading-type-indicator 插件：禁类名 / 实现符号 / 测试 DSL 标签。
  /heading-type-indicator|headingTypeIndicator|h-label/i,
];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(join(dir, entry.name));
    } else if (EXTS.has(extname(entry.name))) {
      yield join(dir, entry.name);
    }
  }
}

const hits = [];
for (const file of walk(SRC)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (BANNED.some((re) => re.test(line))) {
      hits.push(`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (hits.length > 0) {
  console.error('[check:skeleton] 骨架 src/ 出现插件专属字面量：');
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}

console.log('[check:skeleton] clean');
