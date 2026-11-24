import { describe, expect, test } from 'vitest'
import { buildSaveFilters } from '@/utils/export/save'

describe('buildSaveFilters', () => {
  test('names the format and lists the extension', () => {
    expect(buildSaveFilters('EPUB', 'epub')).toEqual([
      { name: 'EPUB', extensions: ['epub'] },
    ])
  })
})
