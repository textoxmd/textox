import { describe, expect, test } from 'vitest'
import { getBaseName, getCaptureRect, mountExportOverlay, runExclusiveExport } from './overlay'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('runExclusiveExport', () => {
  test('runs the callback and wraps the value', async () => {
    const outcome = await runExclusiveExport(async () => 42)
    expect(outcome).toEqual({ ran: true, value: 42 })
  })

  test('a second call while busy returns ran:false and never invokes the callback', async () => {
    const gate = deferred<void>()
    const first = runExclusiveExport(async () => { await gate.promise; return 'first' })
    let secondRan = false
    const second = await runExclusiveExport(async () => { secondRan = true; return 'second' })
    expect(second).toEqual({ ran: false })
    expect(secondRan).toBe(false)
    gate.resolve()
    expect(await first).toEqual({ ran: true, value: 'first' })
  })

  test('releases the lock after success', async () => {
    await runExclusiveExport(async () => 'a')
    expect(await runExclusiveExport(async () => 'b')).toEqual({ ran: true, value: 'b' })
  })

  test('releases the lock when the callback rejects', async () => {
    await expect(runExclusiveExport(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(await runExclusiveExport(async () => 'after')).toEqual({ ran: true, value: 'after' })
  })

  test('a callback returning null is distinguishable from busy', async () => {
    expect(await runExclusiveExport(async () => null)).toEqual({ ran: true, value: null })
  })
})

describe('getBaseName', () => {
  test('strips directory and extension', () => {
    expect(getBaseName('/Users/a/notes/My Note.md')).toBe('My Note')
  })

  test('decodes file:// urls with percent-encoding', () => {
    expect(getBaseName('file:///Users/a/%E6%B5%8B%E8%AF%95.md')).toBe('测试')
  })

  test('handles windows separators', () => {
    expect(getBaseName('C:\\docs\\a.md')).toBe('a')
  })

  test('keeps dotfiles intact', () => {
    expect(getBaseName('/a/.hidden')).toBe('.hidden')
  })

  test('handles a name without extension', () => {
    expect(getBaseName('/a/README')).toBe('README')
  })

  test('returns undefined for null', () => {
    expect(getBaseName(null)).toBeUndefined()
  })
})

describe('mountExportOverlay export contract', () => {
  test('replaces [data-export="html"] with rendered HTML from [data-export-source]', async () => {
    // 通用契约：共享运行时只认 data-export / data-export-source，
    // 不认识任何具体插件的标签或类名。
    const container = document.createElement('div')
    container.className = 'prosemirror-editor-container texto-editor'

    // 中性夹具：契约只认 data-export / data-export-source，不关心承载标签。
    const block = document.createElement('div')
    block.setAttribute('data-export', 'html')
    const source = document.createElement('div')
    source.setAttribute('data-export-source', '')
    source.textContent = '<b>bold</b>'
    block.append(source)
    // 渲染容器与源码同处一个块内；旧实现若直接取 textContent 会把两者拼接。
    const render = document.createElement('div')
    render.innerHTML = '<b>rendered</b>'
    block.append(render)
    container.append(block)
    document.body.append(container)

    const overlay = await mountExportOverlay()
    try {
      expect(overlay.wrap.querySelector('[data-export="html"]')).toBeNull()
      // 只注入源码（作为真实 HTML），渲染容器随之被替换掉。
      const bolds = overlay.wrap.querySelectorAll('b')
      expect(bolds).toHaveLength(1)
      expect(bolds[0]!.textContent).toBe('bold')
    } finally {
      overlay.cleanup()
      container.remove()
    }
  })
})

describe('getCaptureRect', () => {
  test('uses the wrap box as the capture rect', () => {
    const wrap = document.createElement('div')
    wrap.getBoundingClientRect = () => ({
      x: 0, y: 100, left: 0, top: 100, right: 900, bottom: 5100,
      width: 900, height: 5000, toJSON() { return {} },
    }) as DOMRect
    expect(getCaptureRect(wrap)).toEqual({ x: 0, y: 100, width: 900, height: 5000 })
  })

  test('adds the page scroll offset to the capture origin', () => {
    const wrap = document.createElement('div')
    wrap.getBoundingClientRect = () => ({
      x: 0, y: 100, left: 0, top: 100, right: 900, bottom: 5100,
      width: 900, height: 5000, toJSON() { return {} },
    }) as DOMRect

    // happy-dom 下直接赋值 window.scrollY 不生效，用 getter 覆盖。
    const original = Object.getOwnPropertyDescriptor(window, 'scrollY')
    Object.defineProperty(window, 'scrollY', { get: () => 120, configurable: true })
    try {
      // box.top = 100，加上 scrollY = 120 → 捕获原点 y = 220。
      expect(getCaptureRect(wrap).y).toBe(220)
    } finally {
      if (original) Object.defineProperty(window, 'scrollY', original)
      else delete (window as unknown as Record<string, unknown>).scrollY
    }
  })

  test('falls back to the viewport width when the wrap box width is 0', () => {
    const wrap = document.createElement('div')
    wrap.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0,
      width: 0, height: 0, toJSON() { return {} },
    }) as DOMRect

    // happy-dom 下 documentElement.clientWidth 默认为 0，需覆盖为非 0
    // 才能区分「回退到视口宽度」与「直接用 box.width(0)」。
    const original = Object.getOwnPropertyDescriptor(document.documentElement, 'clientWidth')
    Object.defineProperty(document.documentElement, 'clientWidth', { get: () => 1024, configurable: true })
    try {
      expect(getCaptureRect(wrap).width).toBe(1024)
    } finally {
      if (original) Object.defineProperty(document.documentElement, 'clientWidth', original)
      else delete (document.documentElement as unknown as Record<string, unknown>).clientWidth
    }
  })
})
