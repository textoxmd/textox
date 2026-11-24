import { describe, expect, test } from 'vitest'
import { generateThemeCss, extractExtraCss, replaceThemeBlocks, formatCss } from '@/components/styles/theme-css-parser'
import type { ThemeData } from '@/components/styles/theme-data'

const SAMPLE_LIGHT: Record<string, string> = {
  '--background': 'oklch(1 0 0)',
  '--foreground': 'oklch(0.145 0 0)',
  '--card': 'oklch(1 0 0)',
  '--card-foreground': 'oklch(0.145 0 0)',
  '--popover': 'oklch(1 0 0)',
  '--popover-foreground': 'oklch(0.145 0 0)',
  '--primary': 'oklch(0.205 0 0)',
  '--primary-foreground': 'oklch(0.985 0 0)',
  '--secondary': 'oklch(0.97 0 0)',
  '--secondary-foreground': 'oklch(0.205 0 0)',
  '--accent': 'oklch(0.97 0 0)',
  '--accent-foreground': 'oklch(0.205 0 0)',
  '--destructive': 'oklch(0.577 0.245 27.325)',
  '--muted': 'oklch(0.97 0 0)',
  '--muted-foreground': 'oklch(0.556 0 0)',
  '--border': 'oklch(0.922 0 0)',
  '--input': 'oklch(0.922 0 0)',
  '--ring': 'oklch(0.708 0 0)',
  '--chart-1': 'oklch(0.646 0.222 41.116)',
  '--chart-2': 'oklch(0.6 0.118 184.704)',
  '--chart-3': 'oklch(0.398 0.07 227.392)',
  '--chart-4': 'oklch(0.828 0.189 84.429)',
  '--chart-5': 'oklch(0.769 0.188 70.08)',
  '--sidebar': 'oklch(0.985 0 0)',
  '--sidebar-foreground': 'oklch(0.145 0 0)',
  '--sidebar-primary': 'oklch(0.205 0 0)',
  '--sidebar-primary-foreground': 'oklch(0.985 0 0)',
  '--sidebar-accent': 'oklch(0.97 0 0)',
  '--sidebar-accent-foreground': 'oklch(0.205 0 0)',
  '--sidebar-border': 'oklch(0.922 0 0)',
  '--sidebar-ring': 'oklch(0.708 0 0)',
}

const SAMPLE_DARK: Record<string, string> = {
  '--background': 'oklch(0.145 0 0)',
  '--foreground': 'oklch(0.985 0 0)',
  '--card': 'oklch(0.205 0 0)',
  '--card-foreground': 'oklch(0.985 0 0)',
  '--popover': 'oklch(0.205 0 0)',
  '--popover-foreground': 'oklch(0.985 0 0)',
  '--primary': 'oklch(0.922 0 0)',
  '--primary-foreground': 'oklch(0.205 0 0)',
  '--secondary': 'oklch(0.269 0 0)',
  '--secondary-foreground': 'oklch(0.985 0 0)',
  '--accent': 'oklch(0.269 0 0)',
  '--accent-foreground': 'oklch(0.985 0 0)',
  '--destructive': 'oklch(0.704 0.191 22.216)',
  '--muted': 'oklch(0.269 0 0)',
  '--muted-foreground': 'oklch(0.708 0 0)',
  '--border': 'oklch(1 0 0 / 10%)',
  '--input': 'oklch(1 0 0 / 15%)',
  '--ring': 'oklch(0.556 0 0)',
  '--chart-1': 'oklch(0.7 0.15 250)',
  '--chart-2': 'oklch(0.696 0.17 162.48)',
  '--chart-3': 'oklch(0.769 0.188 70.08)',
  '--chart-4': 'oklch(0.627 0.265 303.9)',
  '--chart-5': 'oklch(0.645 0.246 16.439)',
  '--sidebar': 'oklch(0.205 0 0)',
  '--sidebar-foreground': 'oklch(0.985 0 0)',
  '--sidebar-primary': 'oklch(0.488 0.243 264.376)',
  '--sidebar-primary-foreground': 'oklch(0.985 0 0)',
  '--sidebar-accent': 'oklch(0.269 0 0)',
  '--sidebar-accent-foreground': 'oklch(0.985 0 0)',
  '--sidebar-border': 'oklch(1 0 0 / 10%)',
  '--sidebar-ring': 'oklch(0.556 0 0)',
}

function makeThemeData(light?: Record<string, string>, dark?: Record<string, string>): ThemeData {
  return {
    light: light ? { ...light } : {},
    dark: dark ? { ...dark } : {},
  }
}

describe('generateThemeCss', () => {
  test('generates :root block with light variables', () => {
    const data = makeThemeData(SAMPLE_LIGHT)
    const css = generateThemeCss(data)

    expect(css).toContain(':root {')
    expect(css).toContain('--background: oklch(1 0 0);')
    expect(css).toContain('--color-scheme: light;')
    expect(css).toContain('}')
  })

  test('generates .dark block with dark variables', () => {
    const data = makeThemeData({}, SAMPLE_DARK)
    const css = generateThemeCss(data)

    expect(css).toContain('.dark {')
    expect(css).toContain('--background: oklch(0.145 0 0);')
    expect(css).toContain('--color-scheme: dark;')
    expect(css).toContain('}')
  })

  test('generates both :root and .dark blocks', () => {
    const data = makeThemeData(SAMPLE_LIGHT, SAMPLE_DARK)
    const css = generateThemeCss(data)

    expect(css).toContain(':root {')
    expect(css).toContain('.dark {')
    expect(css.indexOf(':root {')).toBeLessThan(css.indexOf('.dark {'))
  })

  test('includes all variable groups', () => {
    const data = makeThemeData(SAMPLE_LIGHT, SAMPLE_DARK)
    const css = generateThemeCss(data)

    expect(css).toContain('--background')
    expect(css).toContain('--primary')
    expect(css).toContain('--destructive')
    expect(css).toContain('--border')
    expect(css).toContain('--chart-1')
    expect(css).toContain('--sidebar')
  })

  test('handles empty theme data', () => {
    const css = generateThemeCss(makeThemeData())
    expect(css).toBe('\n')
  })

  test('handles light-only theme data', () => {
    const css = generateThemeCss(makeThemeData(SAMPLE_LIGHT))
    expect(css).toContain(':root {')
    expect(css).not.toContain('.dark {')
  })

  test('handles dark-only theme data', () => {
    const css = generateThemeCss(makeThemeData({}, SAMPLE_DARK))
    expect(css).not.toContain(':root {')
    expect(css).toContain('.dark {')
  })

  test('variable values with alpha are preserved', () => {
    const data = makeThemeData(
      { '--border': 'oklch(1 0 0 / 10%)' },
      { '--input': 'oklch(0 0 0 / 50%)' }
    )
    const css = generateThemeCss(data)

    expect(css).toContain('--border: oklch(1 0 0 / 10%);')
    expect(css).toContain('--input: oklch(0 0 0 / 50%);')
  })

  test('output has no double selectors', () => {
    const data = makeThemeData(SAMPLE_LIGHT, SAMPLE_DARK)
    const css = generateThemeCss(data)

    const rootMatches = css.match(/:root\s*\{/g)
    expect(rootMatches?.length).toBe(1)

    const darkMatches = css.match(/\.dark\s*\{/g)
    expect(darkMatches?.length).toBe(1)
  })

  test('output has no corrupted selectors (root/dark without prefix)', () => {
    const data = makeThemeData(SAMPLE_LIGHT, SAMPLE_DARK)
    const css = generateThemeCss(data)

    // These patterns indicate corrupted output
    expect(css).not.toMatch(/^root\s*\{/m)
    expect(css).not.toMatch(/^dark\s*\{/m)
    expect(css).not.toMatch(/^oot\s*\{/m)
    expect(css).not.toMatch(/^ark\s*\{/m)
  })

  test('all variables appear exactly once in :root block', () => {
    const data = makeThemeData(SAMPLE_LIGHT, SAMPLE_DARK)
    const css = generateThemeCss(data)

    const rootBlock = css.split('.dark {')[0]
    const varNames = Object.keys(SAMPLE_LIGHT)

    for (const v of varNames) {
      const re = new RegExp(`  ${v}:`, 'g')
      const matches = rootBlock.match(re)
      expect(matches?.length).toBe(1)
    }
  })

  test('output is deterministic', () => {
    const data = makeThemeData(SAMPLE_LIGHT, SAMPLE_DARK)
    const css1 = generateThemeCss(data)
    const css2 = generateThemeCss(data)
    expect(css1).toBe(css2)
  })
})

describe('extractExtraCss', () => {
  const CSS_WITH_EXTRA = `:root { --a: 1; --b: 2; --color-scheme: light; }
.dark { --a: 3; --b: 4; --color-scheme: dark; }
/* custom comment */
.my-class { color: red; }`

  test('strips :root and .dark blocks, keeps rest', () => {
    const extra = extractExtraCss(CSS_WITH_EXTRA)
    expect(extra).toContain('/* custom comment */')
    expect(extra).toContain('.my-class')
    expect(extra).not.toContain(':root')
    expect(extra).not.toContain('.dark')
  })

  test('returns empty for CSS with only :root/.dark', () => {
    const css = ':root { --a: 1; --color-scheme: light; }\n.dark { --a: 2; --color-scheme: dark; }'
    expect(extractExtraCss(css)).toBe('')
  })

  test('preserves newlines between extra content', () => {
    const css = `:root { --a: 1; --color-scheme: light; }

/* block 1 */
.foo { color: red; }

@media screen {
  .bar { color: blue; }
}`
    const extra = extractExtraCss(css)
    expect(extra).toContain('/* block 1 */')
    expect(extra).toContain('.foo')
    expect(extra).toContain('.bar')
  })

  test('returns empty for empty input', () => {
    expect(extractExtraCss('')).toBe('')
  })
})

describe('formatCss', () => {
  test('formats simple rules with indentation', () => {
    const css = formatCss(`:root { --a: 1; --color-scheme: light; }
.dark { --a: 2; --color-scheme: dark; }`)
    expect(css).toBe(`:root {
  --a: 1;
  --color-scheme: light;
}

.dark {
  --a: 2;
  --color-scheme: dark;
}
`)
  })

  test('handles nested rules inside #writer (multi-line raw)', () => {
    const css = formatCss(`#writer { h1, h2 {
    margin: 1em 0;
  }
  h1 { font-size: 2em; } }`)
    // Raw content is indented as-is, preserving its original indentation
    // plus the block indent (2 spaces)
    expect(css).toBe(`#writer {
  h1, h2 {
      margin: 1em 0;
    }
    h1 { font-size: 2em; }
}
`)
  })

  test('handles single-line raw content inside #writer', () => {
    const css = formatCss(`#writer { h1 { font-size: 2em; } h2 { font-size: 1.5em; } }`)
    expect(css).toBe(`#writer {
  h1 { font-size: 2em; } h2 { font-size: 1.5em; }
}
`)
  })

  test('preserves !important on declarations', () => {
    const css = formatCss(`:root { --bg: oklch(1 0 0) !important; --color: red; }`)
    expect(css).toBe(`:root {
  --bg: oklch(1 0 0) !important;
  --color: red;
}
`)
  })

  test('handles @media with nested rules', () => {
    const css = formatCss(`@media screen { .foo { color: red; } }`)
    expect(css).toBe(`@media screen {
  .foo {
    color: red;
  }
}
`)
  })

  test('handles empty rule', () => {
    const css = formatCss(`.foo {}`)
    expect(css).toBe(`.foo {
}
`)
  })

  test('handles at-rules with block', () => {
    const css = formatCss(`@scope (#writer) { #writer { --bg: oklch(1 0 0); } }`)
    expect(css).toBe(`@scope (#writer) {
  #writer {
    --bg: oklch(1 0 0);
  }
}
`)
  })

  test('handles empty stylesheet', () => {
    expect(formatCss('')).toBe('')
  })

  test('handles single rule', () => {
    const css = formatCss(`:root { --a: 1; }`)
    expect(css).toBe(`:root {
  --a: 1;
}
`)
  })
})

describe('replaceThemeBlocks', () => {
  const FULL_CSS = `:root { --a: 1; --color-scheme: light; }
.dark { --a: 2; --color-scheme: dark; }
.custom { color: red; }`

  const NEW_DATA = { light: { '--a': 'oklch(1 0 0)' }, dark: { '--a': 'oklch(0 0 0)' } }

  test('replaces :root and .dark blocks, preserves custom CSS', () => {
    const result = replaceThemeBlocks(FULL_CSS, NEW_DATA as any)
    expect(result).toContain('.custom {')
    expect(result).toContain('--a: oklch(1 0 0)')
    expect(result).toContain('--a: oklch(0 0 0)')
    expect(result).toMatch(/:root {\n  --a: oklch/)
  })

  test('appends generated CSS when no blocks found', () => {
    const css = '.foo {}'
    const result = replaceThemeBlocks(css, NEW_DATA as any)
    expect(result).toContain(':root')
    expect(result).toContain('.dark')
    expect(result).toContain('.foo')
    expect(result).toMatch(/:root {\n  --a: oklch/)
  })
})
