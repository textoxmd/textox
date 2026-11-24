/// <reference path="./css-tree.d.ts" />
import type * as CssTree from 'css-tree'

// css-tree（含词法器与语法数据）压缩后约 200kB，而导出 HTML 是低频操作。
// 静态 import 会把它钉进应用启动包，故改为首次调用时动态加载（进程内只加载一次）。
type CssTreeModule = typeof CssTree
let cssTreePromise: Promise<CssTreeModule> | null = null

function loadCssTree(): Promise<CssTreeModule> {
  cssTreePromise ??= import('css-tree') as unknown as Promise<CssTreeModule>
  return cssTreePromise
}

/**
 * 只保留「选择器能匹配到 root 子树」的规则，外加主题变量块。
 * 目的是让自包含 HTML 带上内容样式，又不把整份应用 CSS 塞进产物。
 *
 * at-rule 处理：
 * - `@layer` **展开**为内联规则。真实产物（Tailwind v4）把一切都包在 @layer 里，
 *   不展开等于丢掉全部内容样式；而 `@layer` 在老 WebKit / EPUB 阅读器里支持不一，
 *   展平后文档顺序与声明的层序一致，兼容性最好。
 * - `@media` / `@supports` 保留包装（条件本身有意义）。
 * - `@font-face` / `@keyframes` / `@property` 等（块内是声明而非规则）自然被跳过：
 *   导出不内嵌字体二进制，静态产物也不需要动画。
 *
 * 容错：传了 `onParseError` 后 css-tree 对畸形输入做「尽力而为」解析，
 * 所以只有硬抛才返回空串；残缺 CSS 会以残缺形式保留——宁可少几个样式，
 * 也不要整份样式表消失。
 */
export async function filterCss(cssText: string, root: HTMLElement): Promise<string> {
  const csstree = await loadCssTree()
  let ast: CssTree.CssNode
  try {
    ast = csstree.parse(cssText, {
      parseValue: false,
      parseCustomProperty: false,
      onParseError: () => {},
    })
  } catch {
    return ''
  }
  if (ast.type !== 'StyleSheet') return ''

  const KEEP_WRAPPER_AT_RULES = new Set(['media', 'supports'])
  const UNWRAP_AT_RULES = new Set(['layer'])

  // 主题变量定义在 :root / html / .dark 上（克隆子树的祖先），必须带入
  const isThemeScope = (selector: string): boolean =>
    selector.startsWith(':root') || selector.startsWith('html') || selector.startsWith('.dark')

  const matches = (prelude: CssTree.CssNode): boolean => {
    // prelude 是 SelectorList：逐个取 children。
    // 不要对 generate(prelude) 的结果按 ',' 切——那会切坏 `:is(.a,.b)`、`:where(…)`
    // 以及值里含逗号的属性选择器。
    const selectors: string[] = []
    const children = (prelude as { children?: CssTree.List<CssTree.CssNode> }).children
    if (children && typeof children.forEach === 'function') {
      children.forEach((child) => selectors.push(csstree.generate(child)))
    } else {
      selectors.push(csstree.generate(prelude))
    }
    return selectors.some((selector) => {
      if (!selector) return false
      if (isThemeScope(selector)) return true
      try {
        return root.matches(selector) || root.querySelector(selector) !== null
      } catch {
        // 浏览器不认的选择器（如 `::selection`）直接跳过
        return false
      }
    })
  }

  const collect = (children: CssTree.List<CssTree.CssNode>): string[] => {
    const out: string[] = []
    children.forEach((node) => {
      if (node.type === 'Rule') {
        if (matches(node.prelude)) out.push(csstree.generate(node))
        return
      }
      if (node.type !== 'Atrule' || !node.block) return
      const inner = collect(node.block.children)
      if (inner.length === 0) return
      if (UNWRAP_AT_RULES.has(node.name)) {
        out.push(inner.join('\n'))
        return
      }
      if (KEEP_WRAPPER_AT_RULES.has(node.name)) {
        const prelude = node.prelude ? ` ${csstree.generate(node.prelude)}` : ''
        out.push(`@${node.name}${prelude}{${inner.join('')}}`)
      }
      // 其他 at-rule（@font-face / @keyframes / @property …）忽略
    })
    return out
  }

  return collect(ast.children).join('\n')
}
