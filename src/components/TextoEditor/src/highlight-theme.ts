/**
 * highlight.js 主题样式表。
 *
 * 12 份主题 CSS 合计约 30kB，而任一时刻只会用到其中一份：静态 import 会把它们
 * 全部作为字符串常量钉进应用启动包。这里改成「主题名 → 动态 import」的加载表，
 * 由 Vite 拆成独立 chunk，首次应用该主题时才下载（模块级缓存使其只加载一次）。
 *
 * 首屏兜底：`src/main.tsx` 静态引入了 atom-one-dark 的普通 CSS（浏览器可直接应用，
 * 不进入本模块的加载路径），因此在首份主题 CSS 到位前仍有可用的高亮配色。
 */

export const THEME_CSS_LOADERS: Record<string, () => Promise<string>> = {
  oneDark: () => import("highlight.js/styles/atom-one-dark.css?raw").then((m) => m.default),
  materialDark: () =>
    import("highlight.js/styles/atom-one-dark-reasonable.css?raw").then((m) => m.default),
  githubDark: () => import("highlight.js/styles/github-dark.css?raw").then((m) => m.default),
  githubLight: () => import("highlight.js/styles/github.css?raw").then((m) => m.default),
  dracula: () => import("highlight.js/styles/monokai-sublime.css?raw").then((m) => m.default),
  atomone: () => import("highlight.js/styles/atom-one-dark.css?raw").then((m) => m.default),
  vscodeDark: () => import("highlight.js/styles/vs2015.css?raw").then((m) => m.default),
  xcodeDark: () => import("highlight.js/styles/base16/xcode-dusk.css?raw").then((m) => m.default),
  xcodeLight: () => import("highlight.js/styles/xcode.css?raw").then((m) => m.default),
  eclipse: () => import("highlight.js/styles/idea.css?raw").then((m) => m.default),
  sublime: () => import("highlight.js/styles/monokai.css?raw").then((m) => m.default),
  basicLight: () => import("highlight.js/styles/github.css?raw").then((m) => m.default),
  tokyoNightDay: () => import("highlight.js/styles/tokyo-night-light.css?raw").then((m) => m.default),
  bbedit: () => import("highlight.js/styles/xcode.css?raw").then((m) => m.default),
  solarizedLight: () => import("highlight.js/styles/atom-one-light.css?raw").then((m) => m.default),
};

let styleEl: HTMLStyleElement | null = null;
/** 主题切换是异步加载的：用递增代号保证只有最后一次请求会写入 <style>。 */
let applyGeneration = 0;

function extractHljsBackground(css: string): string | null {
  const m = css.match(/\.hljs\s*\{[^}]*background\s*:\s*([^;}]+)/);
  return m ? m[1]!.trim() : null;
}

export async function applyHighlightTheme(themeName: string): Promise<void> {
  const loader = THEME_CSS_LOADERS[themeName];
  if (!loader) return;
  const generation = ++applyGeneration;
  const css = await loader();
  // 期间又切了主题：丢弃这次结果，避免旧主题覆盖新主题。
  if (generation !== applyGeneration || !css) return;

  const bg = extractHljsBackground(css);
  const scoped = bg
    ? css + `\n.ProseMirror pre { --cb-chrome-bg: ${bg}; background: ${bg} !important; }\n.ProseMirror pre .hljs { background: ${bg} !important; }`
    : css;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.setAttribute("data-hljs-theme", "");
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = scoped;
}
