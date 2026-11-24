import { describe, expect, test } from 'vitest'
import { buildStandaloneHtml, escapeHtml } from './html-doc'

describe('escapeHtml', () => {
  test('escapes the five dangerous characters', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
  })

  // 既有实体必须再转义一次（渲染为字面 `&amp;`），而不是被识别后原样放过
  test('escapes ampersands exactly once, including existing entities', () => {
    expect(escapeHtml('a &amp; b')).toBe('a &amp;amp; b')
  })
})

describe('buildStandaloneHtml', () => {
  const html = buildStandaloneHtml({
    title: 'A & B',
    css: '.ProseMirror{color:red}',
    bodyHtml: '<p>hi</p>',
    background: 'oklch(1 0 0)',
    foreground: 'oklch(0.25 0 0)',
    isDark: false,
  })

  test('emits a doctype and utf-8 charset', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<meta charset="utf-8">')
  })

  test('escapes the title', () => {
    expect(html).toContain('<title>A &amp; B</title>')
  })

  test('inlines css and body', () => {
    expect(html).toContain('.ProseMirror{color:red}')
    expect(html).toContain('<p>hi</p>')
  })

  test('applies background and foreground on html,body', () => {
    expect(html).toContain('background:oklch(1 0 0)')
    expect(html).toContain('color:oklch(0.25 0 0)')
  })

  // filterCss 会把应用外壳的 `html,body,#root{height:100%;overflow:hidden}`
  // 当作 html 作用域保留下来。导出文档必须复位，否则长文档会被锁在视口高度内裁掉
  // （PNG 导出会得到一张空白细条）。
  test('resets the app-shell viewport lock', () => {
    expect(html).toContain('height:auto!important')
    expect(html).toContain('overflow:visible!important')
  })

  // 浅色导出保持原样：根元素不带 dark 类
  test('omits the dark class for light exports', () => {
    expect(html).toContain('<html>')
    expect(html).not.toContain('<html class="dark">')
  })

  // 暗色导出：根元素带 dark 类，使被保留的 .dark 变量块生效
  test('adds the dark class for dark exports', () => {
    const dark = buildStandaloneHtml({
      title: 't',
      css: '.dark{--foreground:#fff}',
      bodyHtml: '<p>hi</p>',
      background: 'oklch(0.176 0 0)',
      foreground: 'oklch(0.943 0 0)',
      isDark: true,
    })
    expect(dark).toContain('<html class="dark">')
  })
})
