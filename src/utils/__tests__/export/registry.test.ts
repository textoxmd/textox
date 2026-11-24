import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  findExporterByMenuAction,
  getExporter,
  listExporters,
  registerExporter,
  resetExportersForTests,
} from '@/utils/export/registry'
import type { Exporter, ExporterId } from '@/utils/export/types'

function makeExporter(id: ExporterId): Exporter {
  return {
    id,
    labelKey: `menu.export_${id}`,
    extension: id,
    kind: 'text',
    run: async () => ({ data: `<${id}>`, suggestedName: `a.${id}` }),
  }
}

// 注册表是模块级单例：每个用例自己准备状态，避免隐式顺序依赖
// （否则单跑某个用例、或开启 shuffle 都会失败）。必须在文件级重置——
// 同级 describe 的 beforeEach 只作用于自身用例，无法清除兄弟 describe 残留的状态。
beforeEach(() => {
  resetExportersForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('exporter registry', () => {
  // 文件级 beforeEach 已清空注册表；这里准备本 describe 的初始状态。
  beforeEach(() => {
    registerExporter(makeExporter('html'))
  })

  test('register then get by id', () => {
    const epub = makeExporter('epub')
    registerExporter(epub)
    expect(getExporter('epub')).toBe(epub)
    expect(getExporter('html')).toBeDefined()
  })

  test('unknown id returns undefined', () => {
    expect(getExporter('unknown')).toBeUndefined()
  })

  test('list returns registered exporters', () => {
    expect(listExporters().map(e => e.id)).toContain('html')
  })

  test('list preserves registration order when order is equal', () => {
    // UI 顺序由 `order` 决定（缺省 0）；仅当 order 相等时才回退到注册序。
    // beforeEach 已注册 html；这里再注册 epub（两者 order 均缺省），断言回退顺序。
    registerExporter(makeExporter('epub'))
    expect(listExporters().map(e => e.id)).toEqual(['html', 'epub'])
  })

  test('re-registering the same id overwrites the previous one', () => {
    const second = makeExporter('html')
    registerExporter(second)
    expect(getExporter('html')).toBe(second)
  })
})

describe('listExporters ordering', () => {
  // 文件级 beforeEach 已清空注册表；本 describe 不注册 html，保证断言只含本用例数据。
  test('listExporters sorts by order ascending', () => {
    const ex = (id: string, order: number) => ({
      id, labelKey: 'x', extension: 'x', kind: 'text' as const, order,
      run: async () => ({ data: '', suggestedName: 'x' }),
    })
    registerExporter(ex('later', 20))
    registerExporter(ex('earlier', 10))
    expect(listExporters().map((e) => e.id)).toEqual(['earlier', 'later'])
  })

  test('equal order preserves registration order (stable sort)', () => {
    registerExporter(makeExporter('first'))
    registerExporter(makeExporter('second'))
    expect(listExporters().map((e) => e.id)).toEqual(['first', 'second'])
  })
})

describe('findExporterByMenuAction', () => {
  test('returns the exporter declaring that menu action', () => {
    const declared = {
      id: 'declared',
      labelKey: 'x',
      extension: 'x',
      kind: 'text' as const,
      menuAction: 'export_x',
      run: async () => ({ data: '', suggestedName: 'x' }),
    }
    registerExporter(declared)
    expect(findExporterByMenuAction('export_x')).toBe(declared)
    expect(findExporterByMenuAction('missing')).toBeUndefined()
  })

  test('last registration wins when two exporters share a menu action', () => {
    const first = { id: 'first', labelKey: 'x', extension: 'x', kind: 'text' as const, menuAction: 'dup', run: async () => ({ data: '', suggestedName: 'x' }) }
    const second = { id: 'second', labelKey: 'x', extension: 'x', kind: 'text' as const, menuAction: 'dup', run: async () => ({ data: '', suggestedName: 'x' }) }
    registerExporter(first)
    registerExporter(second)
    expect(findExporterByMenuAction('dup')).toBe(second)
  })
})

describe('registerExporter menuAction guards', () => {
  test('warns when an exporter menuAction collides with a native export item', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerExporter({
      id: 'bad', labelKey: 'x', extension: 'x', kind: 'text',
      menuAction: 'export_pdf', run: async () => ({ data: '', suggestedName: 'x' }),
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('与原生导出项冲突'))
  })

  test('warns when two exporters share a menuAction', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mk = (id: string) => ({
      id, labelKey: 'x', extension: 'x', kind: 'text' as const,
      menuAction: 'dup-action', run: async () => ({ data: '', suggestedName: 'x' }),
    })
    registerExporter(mk('a'))
    registerExporter(mk('b'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('exporter menuAction 冲突'))
  })
})
