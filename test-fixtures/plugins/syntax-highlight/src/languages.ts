import type { HighlightLanguage } from "@texto/markdown-editor-api";

type Grammar = NonNullable<HighlightLanguage["grammar"]>;

// 语法包一律走动态 import：每个语言一个独立 chunk，只有当文档里真的出现该语言的
// 代码块时才会被加载（`loadGrammar` 由编辑器按需调用一次）。
// 这样入口包不再携带 23 份 highlight.js 语法定义（约 110KB min）。
const loaders: Record<string, () => Promise<Grammar>> = {
  bash: () => import("highlight.js/lib/languages/bash").then((m) => m.default),
  cpp: () => import("highlight.js/lib/languages/cpp").then((m) => m.default),
  csharp: () => import("highlight.js/lib/languages/csharp").then((m) => m.default),
  css: () => import("highlight.js/lib/languages/css").then((m) => m.default),
  diff: () => import("highlight.js/lib/languages/diff").then((m) => m.default),
  go: () => import("highlight.js/lib/languages/go").then((m) => m.default),
  ini: () => import("highlight.js/lib/languages/ini").then((m) => m.default),
  java: () => import("highlight.js/lib/languages/java").then((m) => m.default),
  javascript: () => import("highlight.js/lib/languages/javascript").then((m) => m.default),
  json: () => import("highlight.js/lib/languages/json").then((m) => m.default),
  kotlin: () => import("highlight.js/lib/languages/kotlin").then((m) => m.default),
  lua: () => import("highlight.js/lib/languages/lua").then((m) => m.default),
  markdown: () => import("highlight.js/lib/languages/markdown").then((m) => m.default),
  php: () => import("highlight.js/lib/languages/php").then((m) => m.default),
  python: () => import("highlight.js/lib/languages/python").then((m) => m.default),
  ruby: () => import("highlight.js/lib/languages/ruby").then((m) => m.default),
  rust: () => import("highlight.js/lib/languages/rust").then((m) => m.default),
  scss: () => import("highlight.js/lib/languages/scss").then((m) => m.default),
  sql: () => import("highlight.js/lib/languages/sql").then((m) => m.default),
  swift: () => import("highlight.js/lib/languages/swift").then((m) => m.default),
  typescript: () => import("highlight.js/lib/languages/typescript").then((m) => m.default),
  xml: () => import("highlight.js/lib/languages/xml").then((m) => m.default),
  yaml: () => import("highlight.js/lib/languages/yaml").then((m) => m.default),
};

function lazy(id: string, label: string, grammarKey: string, aliases?: string[]): HighlightLanguage {
  return { id, label, aliases, loadGrammar: loaders[grammarKey]! };
}

/** 官方语法高亮语言包：基础 13（原内置）+ 扩展 10（补齐原下拉有选项无语法者）。 */
export const syntaxHighlightLanguages: HighlightLanguage[] = [
  // ——— 基础 13 ———
  lazy("javascript", "JavaScript", "javascript", ["js", "jsx"]),
  lazy("typescript", "TypeScript", "typescript", ["ts", "tsx"]),
  lazy("python", "Python", "python", ["py"]),
  lazy("html", "HTML / XML", "xml", ["xml", "htm"]),
  lazy("css", "CSS", "css"),
  lazy("json", "JSON", "json"),
  lazy("markdown", "Markdown", "markdown", ["md"]),
  lazy("bash", "Shell / Bash", "bash", ["sh", "shell", "zsh"]),
  lazy("rust", "Rust", "rust", ["rs"]),
  lazy("go", "Go", "go", ["golang"]),
  lazy("sql", "SQL", "sql"),
  lazy("yaml", "YAML", "yaml", ["yml"]),
  lazy("diff", "Diff", "diff", ["patch"]),
  // ——— 扩展 10：补齐原下拉「有选项无语法」的主要语言 ———
  // （shell/sass/xml 走别名；angular 无 hljs 语法故移除。）
  lazy("java", "Java", "java"),
  lazy("cpp", "C / C++", "cpp", ["c", "c++", "cc", "cxx"]),
  lazy("php", "PHP", "php"),
  lazy("scss", "Sass / SCSS", "scss", ["sass"]),
  lazy("csharp", "C#", "csharp", ["cs"]),
  lazy("ruby", "Ruby", "ruby", ["rb"]),
  lazy("swift", "Swift", "swift"),
  lazy("kotlin", "Kotlin", "kotlin", ["kt"]),
  lazy("lua", "Lua", "lua"),
  // highlight.js 11.11.1 无独立 toml 模块：TOML 语法由 ini 语法承载
  // （ini.js 的 aliases 含 'toml'，见 highlight.js SUPPORTED_LANGUAGES）。
  lazy("toml", "TOML", "ini"),
];
