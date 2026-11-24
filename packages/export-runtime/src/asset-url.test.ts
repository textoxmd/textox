import { describe, expect, test } from 'vitest'
import { assetUrlToFsPath } from './image-embed'

describe('assetUrlToFsPath', () => {
  test('decodes macOS asset protocol url', () => {
    expect(assetUrlToFsPath('asset://localhost/%2FUsers%2Fa%2Fb.png')).toBe('/Users/a/b.png')
  })

  test('decodes windows asset protocol url with drive letter', () => {
    expect(assetUrlToFsPath('http://asset.localhost/C%3A%5CUsers%5Ca%5Cb.png')).toBe('C:\\Users\\a\\b.png')
  })

  test('returns null for plain http urls', () => {
    expect(assetUrlToFsPath('https://example.com/a.png')).toBeNull()
  })

  test('returns null for data urls', () => {
    expect(assetUrlToFsPath('data:image/png;base64,AAAA')).toBeNull()
  })

  test('strips the leading slash before a windows drive letter', () => {
    expect(assetUrlToFsPath('http://asset.localhost/%2FC%3A%5CUsers%5Cb.png')).toBe('C:\\Users\\b.png')
  })
})
