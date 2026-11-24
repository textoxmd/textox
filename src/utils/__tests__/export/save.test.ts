// src/utils/__tests__/export/save.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
vi.mock('@/utils/windowManager', () => ({ IS_MAC: true }))

import { saveExport } from '@/utils/export/save'
import type { Exporter } from '@/utils/export/types'

const base: Omit<Exporter, 'kind'> = {
  id: 'html',
  labelKey: 'menu.export_html',
  extension: 'html',
  run: async () => ({ data: '', suggestedName: '' }),
}

describe('saveExport', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  test('returns null and writes nothing when the user cancels', async () => {
    invokeMock.mockResolvedValueOnce(null) // pick_export_save_path
    const exporter: Exporter = { ...base, kind: 'text' }
    const result = await saveExport(exporter, { data: '<html>', suggestedName: 'a.html' })
    expect(result).toBeNull()
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('pick_export_save_path', { defaultName: 'a.html', extension: 'html' })
  })

  test('writes text exports through write_file', async () => {
    invokeMock.mockResolvedValueOnce('/out/a.html').mockResolvedValueOnce(undefined)
    const exporter: Exporter = { ...base, kind: 'text' }
    expect(await saveExport(exporter, { data: '<html>', suggestedName: 'a.html' })).toBe('/out/a.html')
    expect(invokeMock).toHaveBeenLastCalledWith('write_file', { path: '/out/a.html', content: '<html>' })
  })

  test('writes binary exports as base64 through save_binary_file', async () => {
    invokeMock.mockResolvedValueOnce('/out/a.epub').mockResolvedValueOnce(undefined)
    const exporter: Exporter = { ...base, kind: 'binary', extension: 'epub', id: 'epub' }
    const bytes = new Uint8Array([1, 2, 3])
    expect(await saveExport(exporter, { data: bytes, suggestedName: 'a.epub' })).toBe('/out/a.epub')
    expect(invokeMock).toHaveBeenLastCalledWith('save_binary_file', {
      path: '/out/a.epub',
      base64Data: 'AQID',
    })
  })

  test('propagates write failures instead of reporting success', async () => {
    invokeMock.mockResolvedValueOnce('/out/a.html').mockRejectedValueOnce(new Error('disk full'))
    const exporter: Exporter = { ...base, kind: 'text' }
    await expect(saveExport(exporter, { data: '<html>', suggestedName: 'a.html' })).rejects.toThrow('disk full')
  })
})
