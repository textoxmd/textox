import { describe, expect, test, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))

import { embedImages } from './image-embed'

describe('embedImages', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    document.body.innerHTML = `
      <div id="root">
        <img id="local" src="asset://localhost/%2Fdocs%2Fa.png">
        <img id="remote" src="https://example.com/b.png">
        <img id="inline" src="data:image/png;base64,AAAA">
        <img id="relative" src="c.png">
        <img id="noSrc">
      </div>`
  })

  const srcOf = (id: string) => document.getElementById(id)!.getAttribute('src')

  test('replaces local asset urls with data urls', async () => {
    invokeMock.mockResolvedValue('data:image/png;base64,ZZZZ')
    await embedImages(document.getElementById('root') as HTMLElement, null)
    expect(srcOf('local')).toBe('data:image/png;base64,ZZZZ')
    expect(invokeMock).toHaveBeenCalledWith('read_image_as_data_url', { path: '/docs/a.png' })
  })

  test('resolves relative urls against documentDir', async () => {
    invokeMock.mockResolvedValue('data:image/png;base64,YYYY')
    await embedImages(document.getElementById('root') as HTMLElement, '/docs')
    expect(srcOf('relative')).toBe('data:image/png;base64,YYYY')
    expect(invokeMock).toHaveBeenCalledWith('read_image_as_data_url', { path: '/docs/c.png' })
  })

  test('leaves remote and inline urls untouched', async () => {
    invokeMock.mockResolvedValue('data:image/png;base64,REL')
    await embedImages(document.getElementById('root') as HTMLElement, '/docs')
    expect(srcOf('remote')).toBe('https://example.com/b.png')
    expect(srcOf('inline')).toBe('data:image/png;base64,AAAA')
    expect(srcOf('noSrc')).toBeNull()
    // relative 会被内嵌（这里只断言它没被当成远程/内联跳过）
    expect(srcOf('relative')).toBe('data:image/png;base64,REL')
    // remote / inline / noSrc 都不应触发 invoke；local(asset://) 与 relative 会解析。
    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(invokeMock).toHaveBeenCalledWith('read_image_as_data_url', { path: '/docs/a.png' })
    expect(invokeMock).toHaveBeenCalledWith('read_image_as_data_url', { path: '/docs/c.png' })
  })

  test('keeps original src when read fails', async () => {
    invokeMock.mockRejectedValue(new Error('boom'))
    await embedImages(document.getElementById('root') as HTMLElement, null)
    expect(srcOf('local')).toBe('asset://localhost/%2Fdocs%2Fa.png')
  })
})
