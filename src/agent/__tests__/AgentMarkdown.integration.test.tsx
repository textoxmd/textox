import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AgentMarkdown } from '../AgentMarkdown';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(source: string, onLinkClick: (href: string) => void = vi.fn()) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(AgentMarkdown, { source, isAnimating: false, onLinkClick }));
  });
  return onLinkClick;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = '';
});

describe('AgentMarkdown with real Streamdown', () => {
  it('渲染 GFM 标题、列表、表格与代码块', async () => {
    render('# 标题\n\n- 一\n- 二\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst a = 1;\n```');
    // 代码块的懒加载组件会走 Suspense，等它结算后再断言。
    await act(async () => {});

    expect(container!.querySelector('h1')?.textContent).toContain('标题');
    expect(container!.querySelectorAll('li')).toHaveLength(2);
    expect(container!.querySelector('table')).not.toBeNull();
    expect(container!.querySelector('pre code')?.textContent).toContain('const a = 1;');
    // 不产生逐字动画节点。
    expect(container!.querySelectorAll('[data-sd-animate]')).toHaveLength(0);
  });

  it('原始 HTML 不执行，图片不产生 img', () => {
    render('<script>alert(1)</script>\n\n![x](https://tracker.example/x.png)');

    expect(container!.querySelector('script')).toBeNull();
    expect(container!.querySelector('img')).toBeNull();
  });

  it('被拦下的图片不产生 img，也不出现英文 indicator', () => {
    render('![bad](file:///etc/passwd)');

    expect(container!.querySelector('img')).toBeNull();
    expect(container!.textContent).not.toContain('[Image blocked');
  });

  it('安全链接点击阻止默认行为并回调', () => {
    const onLink = render('[示例](https://example.com)');
    const anchor = container!.querySelector('a')!;
    expect(anchor.getAttribute('target')).toBeNull();
    // Streamdown 会把 URL 规范化（补尾斜杠），断言渲染值而非原始字面量。
    const href = anchor.getAttribute('href')!;
    expect(href).toMatch(/^https:\/\/example\.com\/?$/);

    act(() => {
      anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(onLink).toHaveBeenCalledWith(href);
  });

  it('坏链接不产生可点击 href，也不出现英文 indicator', () => {
    render('[坏链接](javascript:alert(1))');

    expect(container!.querySelector('a[href^="javascript"]')).toBeNull();
    expect(container!.textContent).toContain('坏链接');
    expect(container!.textContent).not.toContain('[blocked]');
  });
});
