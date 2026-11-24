export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface StandaloneHtmlOptions {
  title: string
  css: string
  bodyHtml: string
  background: string
  foreground: string
  /**
   * 导出时的应用外观。暗色时给 `<html>` 加 `dark` 类，让 filterCss 保留下来的
   * `.dark{--foreground:…}` 变量块真正生效；否则内容里的 `var(--foreground)` 等
   * 会回退到 `:root` 的浅色值，与内联的暗色背景冲突（暗底深字）。
   */
  isDark: boolean
}

/** 组装单文件、无外部依赖的 HTML 文档。 */
export function buildStandaloneHtml(options: StandaloneHtmlOptions): string {
  const { title, css, bodyHtml, background, foreground, isDark } = options
  return [
    '<!doctype html>',
    isDark ? '<html class="dark">' : '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>',
    css,
    `html,body{background:${background};color:${foreground};margin:0}`,
    // 应用外壳样式（app.css 的 `html,body,#root{height:100%;overflow:hidden}`）会被
    // filterCss 当作 html 主题作用域保留下来，把导出文档锁死在视口高度并裁掉溢出。
    // 导出产物必须是可增长的普通文档：显式复位，保证长文档完整、可滚动。
    'html,body{height:auto!important;overflow:visible!important}',
    'body{padding:32px 16px;display:flex;justify-content:center}',
    'main.export-root{width:min(820px,100%);min-width:0}',
    '</style>',
    '</head>',
    '<body>',
    `<main class="export-root">${bodyHtml}</main>`,
    '</body>',
    '</html>',
  ].join('\n')
}
