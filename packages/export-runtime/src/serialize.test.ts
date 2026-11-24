import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const cleanupMock = vi.fn()
vi.mock('./overlay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./overlay')>()
  return { ...actual, mountExportOverlay: vi.fn() }
})
vi.mock('./image-embed', () => ({ embedImages: vi.fn(async () => {}) }))

import { embedImages } from './image-embed'
import { mountExportOverlay } from './overlay'
import { serializeToStandaloneHtml } from './serialize'

/** 复刻真实编辑器结构：容器 → wrap → host → .ProseMirror */
function buildRealisticOverlay(): HTMLElement {
  const wrap = document.createElement('div')
  const clone = document.createElement('div')
  clone.className = 'prosemirror-editor-container texto-editor'
  clone.innerHTML = `
    <div class="texto-web-wrap">
      <div id="writer" class="texto-web-editor-host">
        <div class="ProseMirror">
          <h1>One</h1><p>a</p><h1>Two</h1><p>b</p>
        </div>
      </div>
    </div>`
  wrap.append(clone)
  return wrap
}

describe('serializeToStandaloneHtml', () => {
  beforeEach(() => {
    cleanupMock.mockReset()
    vi.mocked(mountExportOverlay).mockResolvedValue({ wrap: buildRealisticOverlay(), cleanup: cleanupMock })
  })

  afterEach(() => {
    vi.mocked(mountExportOverlay).mockReset()
    vi.mocked(embedImages).mockReset()
    vi.mocked(embedImages).mockImplementation(async () => {})
  })

  test('exposes the .ProseMirror content layer', async () => {
    const doc = await serializeToStandaloneHtml({ currentFile: '/tmp/note.md', documentDir: null })
    try {
      expect(doc.root.className).toContain('texto-editor')
      expect(doc.contentRoot.className).toBe('ProseMirror')
      // PNG 光栅化契约：背景色必须暴露出来，否则暗色主题会导出透明底浅字图。
      expect(doc.background).toBeTruthy()
    } finally {
      doc.cleanup()
    }
  })

  test('uses the file base name as the title', async () => {
    const doc = await serializeToStandaloneHtml({ currentFile: '/tmp/My Note.md', documentDir: null })
    try {
      expect(doc.title).toBe('My Note')
      expect(doc.html).toContain('<title>My Note</title>')
    } finally {
      doc.cleanup()
    }
  })

  test('adds the dark class to the exported html when the app is in dark mode', async () => {
    document.documentElement.classList.add('dark')
    try {
      const doc = await serializeToStandaloneHtml({ currentFile: null, documentDir: null })
      try {
        expect(doc.html).toContain('<html class="dark">')
      } finally {
        doc.cleanup()
      }
    } finally {
      document.documentElement.classList.remove('dark')
    }
  })

  test('cleans up the overlay when the content root is missing', async () => {
    vi.mocked(mountExportOverlay).mockResolvedValueOnce({
      wrap: document.createElement('div'),
      cleanup: cleanupMock,
    })
    await expect(serializeToStandaloneHtml({ currentFile: null, documentDir: null })).rejects.toThrow()
    expect(cleanupMock).toHaveBeenCalledTimes(1)
  })

  test('cleans up the overlay when embedding images throws', async () => {
    vi.mocked(embedImages).mockRejectedValueOnce(new Error('boom'))
    await expect(serializeToStandaloneHtml({ currentFile: null, documentDir: null })).rejects.toThrow('boom')
    expect(cleanupMock).toHaveBeenCalledTimes(1)
  })
})
