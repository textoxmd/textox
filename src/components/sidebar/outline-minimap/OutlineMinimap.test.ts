// src/components/sidebar/outline-minimap/OutlineMinimap.test.ts
import { afterEach, describe, expect, test } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { OutlineMinimap } from './OutlineMinimap'

type OutlineItem = {
  level: number;
  text: string;
  displayText?: string;
  line: number;
  pos?: number;
  excerpt?: string;
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function heading(index: number): OutlineItem {
  return { level: 1, text: `H${index}`, line: index + 1, pos: index, excerpt: `excerpt ${index}` }
}

function makeOutline(length: number): OutlineItem[] {
  return Array.from({ length }, (_, i) => heading(i))
}

let root: Root | null = null
let container: HTMLDivElement | null = null

function renderWith(
  outline: OutlineItem[],
  onOutlineClick: (line: number, text?: string, pos?: number) => void = () => {},
): void {
  if (!root || !container) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  const element: ReactElement = createElement(OutlineMinimap, {
    outline,
    activeIndex: -1,
    documentKey: 'doc-a',
    onOutlineClick,
  })
  act(() => {
    root!.render(element)
  })
}

function hoverItem(index: number): void {
  const buttons = container!.querySelectorAll('.outline-minimap-item')
  act(() => {
    buttons[index]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  })
}

function tooltip(): HTMLElement | null {
  return document.body.querySelector('.outline-minimap-tooltip')
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
  }
  container?.remove()
  root = null
  container = null
})

describe('OutlineMinimap hover preview', () => {
  test('shows the hovered heading excerpt', () => {
    renderWith(makeOutline(10))
    hoverItem(9)
    const el = tooltip()
    expect(el?.classList.contains('is-visible')).toBe(true)
    expect(el?.querySelector('.outline-minimap-tooltip-text')?.textContent).toBe('H9')
  })

  test('does not crash when the outline shrinks below the hovered index', () => {
    renderWith(makeOutline(10))
    hoverItem(9)
    expect(tooltip()?.classList.contains('is-visible')).toBe(true)

    // Same document, content edited so the heading count drops below the hovered index.
    expect(() => renderWith(makeOutline(3))).not.toThrow()

    // The stale preview must not be shown for an item that no longer exists.
    expect(tooltip()?.classList.contains('is-visible')).toBe(false)
  })
})

describe('OutlineMinimap display text', () => {
  test('uses displayText for tooltip and aria-label while click keeps raw text', () => {
    const clicked: Array<{ line: number; text?: string; pos?: number }> = []
    renderWith(
      [
        {
          level: 1,
          text: '**Bold**',
          displayText: 'Bold',
          line: 3,
          pos: 2,
          excerpt: '',
        },
      ],
      (line, text, pos) => clicked.push({ line, text, pos }),
    )

    hoverItem(0)
    expect(
      tooltip()?.querySelector('.outline-minimap-tooltip-text')?.textContent,
    ).toBe('Bold')
    expect(
      container!.querySelector('.outline-minimap-item')?.getAttribute('aria-label'),
    ).toBe('Bold')

    const button = container!.querySelector('.outline-minimap-item') as HTMLElement
    act(() => {
      button.click()
    })
    expect(clicked).toEqual([{ line: 3, text: '**Bold**', pos: 2 }])
  })
})
