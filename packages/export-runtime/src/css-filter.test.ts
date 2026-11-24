import { beforeEach, describe, expect, test } from 'vitest'
import { filterCss } from './css-filter'

describe('filterCss', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div class="root"><p class="keep">x</p><span class="tag" data-x="a,b">y</span></div>'
  })

  const root = () => document.querySelector('.root') as HTMLElement

  test('keeps rules matching the root itself', async () => {
    expect(await filterCss('.root{color:red}', root())).toContain('.root')
  })

  test('keeps rules matching a descendant', async () => {
    expect(await filterCss('.root .keep{color:green}', root())).toContain('.keep')
  })

  test('drops rules matching nothing in the subtree', async () => {
    expect(await filterCss('.unused{color:blue}', root())).toBe('')
  })

  test('always keeps :root custom property blocks', async () => {
    expect(await filterCss(':root{--background:white}', root())).toContain('--background')
  })

  test('always keeps .dark custom property blocks', async () => {
    expect(await filterCss('.dark{--background:black}', root())).toContain('--background')
  })

  test('keeps media rules that contain a matching inner rule', async () => {
    const out = await filterCss('@media print{.keep{color:green}}', root())
    expect(out).toContain('@media print')
    expect(out).toContain('.keep')
  })

  test('drops media rules with no matching inner rule', async () => {
    expect(await filterCss('@media print{.unused{color:blue}}', root())).toBe('')
  })

  // 真实的应用产物（Tailwind v4）把一切包在 @layer 里；不展开等于丢掉全部内容样式。
  test('unwraps @layer blocks into inline rules', async () => {
    const out = await filterCss('@layer utilities{.keep{color:green}}', root())
    expect(out).toContain('.keep')
    expect(out).not.toContain('@layer')
  })

  test('unwraps @layer nested inside a media query', async () => {
    const out = await filterCss('@media print{@layer base{.keep{color:green}}}', root())
    expect(out).toContain('@media print')
    expect(out).toContain('.keep')
    expect(out).not.toContain('@layer')
  })

  test('keeps @supports wrappers', async () => {
    const out = await filterCss('@supports (display:grid){.keep{display:grid}}', root())
    expect(out).toContain('@supports')
    expect(out).toContain('.keep')
  })

  // 按裸 ',' 切选择器会切坏含逗号的属性选择器（这条在 bug 存在时返回 ''）
  test('keeps attribute selectors whose value contains a comma', async () => {
    expect(await filterCss('[data-x="a,b"]{color:red}', root())).toContain('[data-x="a,b"]')
  })

  test('keeps :is() selector lists', async () => {
    expect(await filterCss('.keep:is(p, span){color:red}', root())).toContain('.keep:is(')
  })

  test('skips keyframes blocks', async () => {
    expect(await filterCss('@keyframes spin{from{opacity:0}to{opacity:1}}', root())).toBe('')
  })

  test('returns empty string for unparsable input', async () => {
    expect(await filterCss('}}}{{{', root())).toBe('')
  })
})
