// src/components/sidebar/outline-panel/OutlinePanel.test.tsx
import { afterEach, describe, expect, test } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { OutlinePanel } from './OutlinePanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type OutlineItem = {
  level: number;
  text: string;
  displayText?: string;
  line: number;
  pos?: number;
  excerpt?: string;
}

const outline: OutlineItem[] = [
  { level: 1, text: 'A', line: 1, pos: 0, excerpt: '' },
  { level: 2, text: 'B', line: 2, pos: 10, excerpt: '' },
]

let root: Root | null = null
let container: HTMLDivElement | null = null

function renderPanel(props: {
  outlineStyle: 'off' | 'text' | 'minimap'
  closing?: boolean
  outline?: OutlineItem[]
}): void {
  if (!root || !container) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  const element: ReactElement = createElement(OutlinePanel, {
    width: 260,
    isResizing: false,
    closing: props.closing ?? false,
    outline: props.outline ?? outline,
    outlineStyle: props.outlineStyle,
    activeIndex: -1,
    documentKey: 'doc-a',
    onClose: () => {},
    onOutlineClick: () => {},
    onResizeStart: () => {},
  })
  act(() => {
    root!.render(element)
  })
}

function panel(): HTMLElement | null {
  return container!.querySelector('.outline-panel-float')
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
  }
  container?.remove()
  root = null
  container = null
})

describe('OutlinePanel closing keeps the last view mode', () => {
  // 收起时 outlineStyle 会立刻变成 off，但面板还要播放 200ms 右滑退出动画。
  // 期间若直接按 off 渲染，迷你地图会先闪成文字大纲（即用户报告的 bug）。
  test('stays in minimap mode while sliding out after switching to off', () => {
    renderPanel({ outlineStyle: 'minimap' })
    expect(panel()?.classList.contains('minimap-mode')).toBe(true)
    expect(container!.querySelector('.outline-minimap')).not.toBeNull()

    renderPanel({ outlineStyle: 'off', closing: true })

    expect(panel()?.classList.contains('closing')).toBe(true)
    expect(panel()?.classList.contains('minimap-mode')).toBe(true)
    expect(container!.querySelector('.outline-minimap')).not.toBeNull()
    expect(container!.querySelector('.outline-panel')).toBeNull()
  })

  test('stays in text mode while sliding out after switching to off', () => {
    renderPanel({ outlineStyle: 'text' })
    expect(container!.querySelector('.outline-panel')).not.toBeNull()

    renderPanel({ outlineStyle: 'off', closing: true })

    expect(panel()?.classList.contains('minimap-mode')).toBe(false)
    expect(container!.querySelector('.outline-panel')).not.toBeNull()
    expect(container!.querySelector('.outline-minimap')).toBeNull()
  })
})

describe('OutlinePanel content-avoidance gutter', () => {
  // 面板把实测宽度写入父容器的 --outline-gutter，编辑器据此加右内边距避让浮层。
  // happy-dom 无布局 → offsetWidth 为 0，因此文本模式的值等于留白常量 24。
  test('writes width + gap in text mode and 0 in minimap mode', () => {
    renderPanel({ outlineStyle: 'text' })
    expect(container!.style.getPropertyValue('--outline-gutter')).toBe('24px')

    renderPanel({ outlineStyle: 'minimap' })
    expect(container!.style.getPropertyValue('--outline-gutter')).toBe('0px')
  })

  test('removes the gutter variable on unmount', () => {
    renderPanel({ outlineStyle: 'text' })
    expect(container!.style.getPropertyValue('--outline-gutter')).toBe('24px')

    act(() => root!.unmount())
    root = null

    expect(container!.style.getPropertyValue('--outline-gutter')).toBe('')
  })
})

describe('OutlinePanel outline display text', () => {
  test('renders displayText instead of raw markdown', () => {
    renderPanel({
      outlineStyle: 'text',
      outline: [
        {
          level: 1,
          text: '**Bold**',
          displayText: 'Bold',
          line: 1,
          pos: 0,
          excerpt: '',
        },
      ],
    })

    const label = container!.querySelector('.outline-text')
    expect(label?.textContent).toBe('Bold')
    expect(label?.textContent).not.toContain('**')
  })

  test('keeps an empty displayText empty instead of falling back to text', () => {
    renderPanel({
      outlineStyle: 'text',
      outline: [
        {
          level: 1,
          text: '[](url)',
          displayText: '',
          line: 1,
          pos: 0,
          excerpt: '',
        },
      ],
    })

    const label = container!.querySelector('.outline-text')
    expect(label?.textContent).toBe('')
    expect(label?.textContent).not.toBe('[](url)')
  })

  test('falls back to raw text when displayText is absent', () => {
    renderPanel({
      outlineStyle: 'text',
      outline: [
        {
          level: 1,
          text: '**Bold**',
          line: 1,
          pos: 0,
          excerpt: '',
        },
      ],
    })

    expect(container!.querySelector('.outline-text')?.textContent).toBe(
      '**Bold**',
    )
  })
})
