import { describe, expect, test } from 'vitest'
import { normalizeRecentPath } from '@/utils/recentPath'

describe('normalizeRecentPath', () => {
  test('strips trailing slash from directory path', () => {
    expect(normalizeRecentPath('/Users/foo/Documents/')).toBe('/Users/foo/Documents')
  })

  test('strips multiple trailing separators', () => {
    expect(normalizeRecentPath('/Users/foo/Documents//')).toBe('/Users/foo/Documents')
  })

  test('strips trailing backslash (Windows)', () => {
    expect(normalizeRecentPath('C:\\Users\\foo\\Documents\\')).toBe('C:\\Users\\foo\\Documents')
  })

  test('keeps root path unchanged', () => {
    expect(normalizeRecentPath('/')).toBe('/')
  })

  test('keeps Windows drive root unchanged', () => {
    expect(normalizeRecentPath('C:\\')).toBe('C:\\')
  })

  test('keeps path without trailing separator unchanged', () => {
    expect(normalizeRecentPath('/Users/foo/Documents')).toBe('/Users/foo/Documents')
  })

  test('keeps empty string unchanged', () => {
    expect(normalizeRecentPath('')).toBe('')
  })
})
