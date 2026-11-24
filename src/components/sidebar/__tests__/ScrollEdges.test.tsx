import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ScrollEdges, useScrollEdges } from '../ScrollEdges';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness({ sides }: { sides?: 'both' | 'top' | 'bottom' }) {
  const edges = useScrollEdges<HTMLDivElement>();
  return createElement(
    'div',
    { className: 'scroll-host' },
    createElement(
      'div',
      { className: 'scroll-body', ref: edges.ref },
      createElement('div', { className: 'scroll-content' }),
    ),
    createElement(ScrollEdges, {
      canScrollUp: edges.canScrollUp,
      canScrollDown: edges.canScrollDown,
      sides,
    }),
  );
}

function render(sides?: 'both' | 'top' | 'bottom'): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(Harness, { sides }));
  });
}

function setMetrics(
  el: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop: number },
): void {
  for (const [key, value] of Object.entries(metrics)) {
    Object.defineProperty(el, key, { value, configurable: true, writable: true });
  }
}

function scrollTo(el: HTMLElement, scrollTop: number): void {
  el.scrollTop = scrollTop;
  act(() => {
    el.dispatchEvent(new Event('scroll'));
  });
}

function edge(side: 'top' | 'bottom'): HTMLElement | null {
  return container!.querySelector<HTMLElement>(`.scroll-edge-${side}`);
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe('ScrollEdges', () => {
  it('未溢出时两侧都隐藏，滚动到中部时两侧都显示', () => {
    render();
    const body = container!.querySelector<HTMLElement>('.scroll-body')!;

    expect(edge('top')).not.toBeNull();
    expect(edge('bottom')).not.toBeNull();
    expect(edge('top')!.classList.contains('is-visible')).toBe(false);
    expect(edge('bottom')!.classList.contains('is-visible')).toBe(false);

    setMetrics(body, { scrollHeight: 600, clientHeight: 300, scrollTop: 0 });
    scrollTo(body, 120);
    expect(edge('top')!.classList.contains('is-visible')).toBe(true);
    expect(edge('bottom')!.classList.contains('is-visible')).toBe(true);
  });

  it('滚到顶部只剩底部渐隐，滚到底部只剩顶部渐隐', () => {
    render();
    const body = container!.querySelector<HTMLElement>('.scroll-body')!;
    setMetrics(body, { scrollHeight: 600, clientHeight: 300, scrollTop: 120 });

    scrollTo(body, 0);
    expect(edge('top')!.classList.contains('is-visible')).toBe(false);
    expect(edge('bottom')!.classList.contains('is-visible')).toBe(true);

    scrollTo(body, 300);
    expect(edge('top')!.classList.contains('is-visible')).toBe(true);
    expect(edge('bottom')!.classList.contains('is-visible')).toBe(false);
  });

  it('sides 控制只渲染单侧', () => {
    render('top');
    expect(edge('top')).not.toBeNull();
    expect(edge('bottom')).toBeNull();
  });

  it('后代内容高度变化（容器尺寸与直接子节点不变）后重新计算边缘', async () => {
    render();
    const body = container!.querySelector<HTMLElement>('.scroll-body')!;
    const content = container!.querySelector<HTMLElement>('.scroll-content')!;

    setMetrics(body, { scrollHeight: 600, clientHeight: 300, scrollTop: 0 });
    scrollTo(body, 0);
    expect(edge('bottom')!.classList.contains('is-visible')).toBe(true);

    // 大纲收起：只有后代样式变化，滚动容器尺寸与直接子节点都没变
    setMetrics(body, { scrollHeight: 300, clientHeight: 300, scrollTop: 0 });
    act(() => {
      content.setAttribute('style', 'height: 0px');
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    expect(edge('bottom')!.classList.contains('is-visible')).toBe(false);
  });
});

describe('滚动边缘渐隐样式契约', () => {
  const css = readFileSync(
    path.resolve(__dirname, '../../styles/components/scroll-edge.css'),
    'utf8',
  );

  it('渐变层绝对定位覆盖内容、默认透明，显隐只切 opacity', () => {
    const base = css.match(/\.scroll-edge\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(base).toContain('position: absolute');
    expect(base).toContain('height: 24px');
    expect(base).toContain('pointer-events: none');
    expect(base).toContain('opacity: 0');
    expect(css).toMatch(/\.scroll-edge\.is-visible\s*\{\s*opacity:\s*1;/);
  });

  it('上下两侧用侧栏底色向透明过渡', () => {
    expect(css).toMatch(
      /\.scroll-edge-top\s*\{[\s\S]*?to bottom,[\s\S]*?var\(--scroll-edge-color, var\(--sidebar\)\)/,
    );
    expect(css).toMatch(
      /\.scroll-edge-bottom\s*\{[\s\S]*?to top,[\s\S]*?var\(--scroll-edge-color, var\(--sidebar\)\)/,
    );
  });
});
