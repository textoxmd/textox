import type { ThemeData } from './theme-data'
import { isOklchValue, ALL_VARIABLES, SCOPE_VARS } from './theme-data'
import * as csstree from 'css-tree'

export function parseThemeCss(css: string): ThemeData {
  const result: ThemeData = { light: {}, dark: {} }

  let tempStyle: HTMLStyleElement | null = null
  try {
    tempStyle = document.createElement('style')
    tempStyle.textContent = css
    document.head.appendChild(tempStyle)

    for (const rule of tempStyle.sheet!.cssRules) {
      if (!(rule instanceof CSSStyleRule)) continue

      const target = rule.selectorText === ':root' ? 'light' : 'dark'
      if (!result[target]) result[target] = {}

      for (let i = 0; i < rule.style.length; i++) {
        const prop = rule.style[i]
        if (!prop.startsWith('--')) continue
        if (SCOPE_VARS.includes(prop)) continue

        const val = rule.style.getPropertyValue(prop).trim()
        if (!val) continue

        result[target][prop] = val
      }
    }
  } finally {
    if (tempStyle && tempStyle.parentNode) {
      tempStyle.parentNode.removeChild(tempStyle)
    }
  }

  return result
}

export function generateThemeCss(data: ThemeData): string {
  const lines: string[] = []

  if (data.light && Object.keys(data.light).length > 0) {
    lines.push(':root {')
    for (const v of ALL_VARIABLES) {
      if (data.light[v]) {
        lines.push(`  ${v}: ${data.light[v]};`)
      }
    }
    lines.push('  --color-scheme: light;')
    lines.push('}')
  }

  if (data.dark && Object.keys(data.dark).length > 0) {
    lines.push('')
    lines.push('.dark {')
    for (const v of ALL_VARIABLES) {
      if (data.dark[v]) {
        lines.push(`  ${v}: ${data.dark[v]};`)
      }
    }
    lines.push('  --color-scheme: dark;')
    lines.push('}')
  }

  return lines.join('\n') + '\n'
}

function formatCssAst(ast: csstree.StyleSheet): string {
  if (!ast.children || ast.children.isEmpty) return ''
  const lines: string[] = []

  function walk(node: csstree.CssNode, indent: string) {
    if (node.type === 'Raw') {
      const trimmed = node.value.trim()
      if (!trimmed) return
      for (const line of trimmed.split('\n')) {
        lines.push(`${indent}${line}`)
      }
    } else if (node.type === 'Rule') {
      if (lines.length > 0 && indent === '') lines.push('')
      lines.push(`${indent}${csstree.generate(node.prelude).replace(/,/g, ', ')} {`)
      for (const child of node.block.children.toArray()) {
        walk(child, indent + '  ')
      }
      lines.push(`${indent}}`)
    } else if (node.type === 'Declaration') {
      const important = node.important ? ' !important' : ''
      lines.push(`${indent}${node.property}: ${csstree.generate(node.value).trim()}${important};`)
    } else if (node.type === 'Atrule') {
      const prelude = node.prelude ? ` ${csstree.generate(node.prelude)}` : ''
      if (node.block) {
        lines.push(`${indent}@${node.name}${prelude} {`)
        for (const child of node.block.children.toArray()) {
          walk(child, indent + '  ')
        }
        lines.push(`${indent}}`)
      } else {
        lines.push(`${indent}@${node.name}${prelude}`)
      }
    }
  }

  for (const child of ast.children.toArray()) {
    walk(child, '')
  }
  return lines.join('\n') + '\n'
}

export function formatCss(css: string): string {
  if (!css.trim()) return ''
  const ast = csstree.parse(css)
  return formatCssAst(ast)
}

export function replaceThemeBlocks(fullCss: string, data: ThemeData, scopeVars?: Record<string, string>): string {
  const ast = csstree.parse(fullCss)

  let foundRoot = false
  let foundDark = false

  const themeRules: Array<{ node: csstree.Rule; mode: 'light' | 'dark' }> = []

  csstree.walk(ast, {
    visit: 'Rule',
    enter(node: any) {
      const sel = csstree.generate(node.prelude).trim()
      if (sel === ':root') {
        foundRoot = true
        themeRules.push({ node, mode: 'light' })
      } else if (sel === '.dark') {
        foundDark = true
        themeRules.push({ node, mode: 'dark' })
      }
    }
  })

  for (const { node: rule, mode } of themeRules) {
    const vars = mode === 'light' ? data.light : data.dark
    if (!vars) continue

    const seen = new Set<string>()
    const toReplace: Array<{ item: any; list: any; prop: string; value: string }> = []

    csstree.walk(rule.block, {
      visit: 'Declaration',
      enter(decl: any, item: any, list: any) {
        if (!decl.property.startsWith('--')) return
        seen.add(decl.property)
        if (decl.property in vars) {
          toReplace.push({ item, list, prop: decl.property, value: vars[decl.property]! })
        }
      }
    })

    for (const { item, list, prop, value } of toReplace) {
      const newDecl = csstree.parse(`${prop}: ${value}`, { context: 'declaration' })
      list.replace(item, csstree.List.createItem(newDecl))
    }

    for (const [name, value] of Object.entries(vars)) {
      if (name === '--color-scheme') continue
      if (!seen.has(name)) {
        const newDecl = csstree.parse(`${name}: ${value}`, { context: 'declaration' })
        rule.block.children.appendData(newDecl)
      }
    }
  }

  if (!foundRoot && data.light && Object.keys(data.light).length > 0) {
    const css = `:root {\n${Object.entries(data.light).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`
    ast.children.appendData(csstree.parse(css, { context: 'rule' }))
  }
  if (!foundDark && data.dark && Object.keys(data.dark).length > 0) {
    const css = `.dark {\n${Object.entries(data.dark).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`
    ast.children.appendData(csstree.parse(css, { context: 'rule' }))
  }

  if (scopeVars && Object.keys(scopeVars).length > 0) {
    let scopeRule: csstree.Rule | null = null
    let scopeAtRule: csstree.Atrule | null = null

    csstree.walk(ast, {
      visit: 'Rule',
      enter(node: any) {
        if (csstree.generate(node.prelude).trim() === '#writer') {
          scopeRule = node
        }
      }
    })

    if (!scopeRule) {
      csstree.walk(ast, {
        visit: 'Atrule',
        enter(node: any) {
          if (node.name === 'scope' && csstree.generate(node.prelude).trim() === '(#writer)') {
            scopeAtRule = node
          }
        }
      })
    }

    const container: any = scopeRule || scopeAtRule
    if (container) {
      const seen = new Set<string>()
      const toReplace: Array<{ item: any; list: any; prop: string; value: string }> = []

      csstree.walk(container.block, {
        visit: 'Declaration',
        enter(decl: any, item: any, list: any) {
          seen.add(decl.property)
          if (decl.property in scopeVars!) {
            toReplace.push({ item, list, prop: decl.property, value: scopeVars![decl.property]! })
          }
        }
      })

      for (const { item, list, prop, value } of toReplace) {
        const newDecl = csstree.parse(`${prop}: ${value}`, { context: 'declaration' })
        list.replace(item, csstree.List.createItem(newDecl))
      }

      for (const [name, value] of Object.entries(scopeVars)) {
        if (!seen.has(name)) {
          const newDecl = csstree.parse(`${name}: ${value}`, { context: 'declaration' })
          container.block.children.appendData(newDecl)
        }
      }
    } else {
      const css = `#writer {\n${Object.entries(scopeVars).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`
      ast.children.appendData(csstree.parse(css, { context: 'rule' }))
    }
  }

  return formatCssAst(ast)
}


export function getScopeVars(css: string): Record<string, string> {
  const result: Record<string, string> = {}
  const ast = csstree.parse(css)

  csstree.walk(ast, {
    visit: 'Rule',
    enter(node: any) {
      if (csstree.generate(node.prelude).trim() === '#writer') {
        csstree.walk(node.block, {
          visit: 'Declaration',
          enter(decl: any) {
            if (decl.property.startsWith('--') && SCOPE_VARS.includes(decl.property)) {
              result[decl.property] = csstree.generate(decl.value).trim()
            }
          }
        })
      }
    }
  })

  return result
}

export function extractExtraCss(fullCss: string): string {
  let result = fullCss
  const selectors = [':root', '.dark']
  for (const sel of selectors) {
    while (true) {
      const idx = result.indexOf(`${sel} {`)
      if (idx === -1) break
      let depth = 0, end = idx, inBlock = false
      for (let i = idx; i < result.length; i++) {
        if (result[i] === '{') { depth++; inBlock = true }
        else if (result[i] === '}') depth--
        if (depth === 0 && inBlock) { end = i + 1; break }
      }
      result = result.slice(0, idx) + result.slice(end)
    }
  }
  return result.trim()
}

export function extractOklchValues(data: ThemeData, mode: 'light' | 'dark'): Record<string, string> {
  const record = data[mode]
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(record)) {
    if (isOklchValue(val)) {
      result[key] = val
    }
  }
  for (const v of ALL_VARIABLES) {
    if (!result[v]) {
      result[v] = 'oklch(0 0 0)'
    }
  }
  return result
}

export function oklchToComponents(oklch: string): { l: number; c: number; h: number; alpha?: number } {
  const inner = oklch.slice(6, -1).trim()
  const parts = inner.split('/')
  const [l, c, h] = parts[0].split(' ').filter(Boolean).map(Number)
  const alpha = parts[1] ? Number(parts[1].trim()) : undefined
  return { l: l ?? 0, c: c ?? 0, h: h ?? 0, alpha }
}

export function componentsToOklch(l: number, c: number, h: number, alpha?: number): string {
  const lStr = l.toFixed(3)
  const cStr = c.toFixed(3)
  const hStr = h.toFixed(1)
  if (alpha !== undefined) {
    return `oklch(${lStr} ${cStr} ${hStr} / ${alpha})`
  }
  return `oklch(${lStr} ${cStr} ${hStr})`
}
