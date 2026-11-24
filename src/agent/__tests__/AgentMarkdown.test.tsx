import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AgentMarkdown } from '../AgentMarkdown';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const captured = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));

vi.mock('streamdown', () => ({
  Streamdown: (props: Record<string, unknown>) => {
    captured.props.push(props);
    return createElement('div', { 'data-testid': 'streamdown' }, props.children as string);
  },
  defaultRehypePlugins: {
    sanitize: 'sanitize',
    harden: ['harden', { allowedProtocols: ['*'] }],
  },
}));

vi.mock('@streamdown/cjk', () => ({
  cjk: { remarkPluginsBefore: [], remarkPluginsAfter: [] },
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** tsconfig 的 lib 是 ES2020，`Array.prototype.at` 没有类型定义。 */
function lastProps(): Record<string, unknown> {
  return captured.props[captured.props.length - 1];
}

function render(props: { animating?: boolean; onLinkClick?: (href: string) => void } = {}) {
  if (!root || !container) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  }
  act(() => {
    root!.render(
      createElement(AgentMarkdown, {
        source: '# 标题',
        isAnimating: props.animating ?? true,
        onLinkClick: props.onLinkClick ?? (() => {}),
      }),
    );
  });
}

beforeEach(() => {
  captured.props = [];
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = '';
});

describe('AgentMarkdown', () => {
  it('不传 animation/caret，且不启用原始 HTML', () => {
    render();
    const props = lastProps();
    expect(props.isAnimating).toBe(true);
    expect(props.animated).toBeUndefined();
    expect(props.caret).toBeUndefined();
    expect(props.controls).toBe(false);
    expect(props.lineNumbers).toBe(false);

    // 不含 raw（原始 HTML 不解析）；harden 的策略被覆盖为无英文提示。
    const plugins = props.rehypePlugins as [unknown, [unknown, Record<string, unknown>]];
    expect(plugins).toHaveLength(2);
    expect(plugins[0]).toBe('sanitize');
    const [hardenPlugin, hardenOptions] = plugins[1];
    expect(hardenPlugin).toBe('harden');
    expect(hardenOptions).toMatchObject({
      linkBlockPolicy: 'text-only',
      imageBlockPolicy: 'remove',
      allowDataImages: false,
      allowedProtocols: ['*'],
    });
  });

  it('图片组件返回 null', () => {
    render();
    const components = lastProps().components as Record<string, unknown>;
    expect((components.img as () => null)()).toBeNull();
  });

  it('安全链接点击交给 onLinkClick，相对/未闭合链接按文本渲染', () => {
    const onLink = vi.fn();
    render({ onLinkClick: onLink });
    const components = lastProps().components as Record<string, unknown>;
    const Link = components.a as (props: Record<string, unknown>) => unknown;

    const host = document.createElement('div');
    document.body.append(host);
    const linkRoot = createRoot(host);
    act(() => {
      linkRoot.render(
        createElement(Link as never, { href: 'https://example.com', children: '示例' }),
      );
    });
    const anchor = host.querySelector('a')!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      anchor.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(true);
    expect(onLink).toHaveBeenCalledWith('https://example.com');

    const auxClick = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
    act(() => {
      anchor.dispatchEvent(auxClick);
    });
    expect(auxClick.defaultPrevented).toBe(true);
    expect(onLink).toHaveBeenCalledTimes(2);

    // 右键（button 2）不算打开链接，不能拉起系统浏览器。
    const rightClick = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 });
    act(() => {
      anchor.dispatchEvent(rightClick);
    });
    expect(rightClick.defaultPrevented).toBe(false);
    expect(onLink).toHaveBeenCalledTimes(2);

    for (const href of [
      'streamdown:incomplete-link',
      '#anchor',
      '/docs',
      'foo.md',
      'javascript:alert(1)',
      'tel:+123',
      'irc://server/chan',
    ]) {
      act(() => {
        linkRoot.render(createElement(Link as never, { href, children: '文本' }));
      });
      expect(host.querySelector('a')).toBeNull();
      expect(host.textContent).toBe('文本');
    }

    act(() => linkRoot.unmount());
    host.remove();
  });

  it('只有左键 click 打开链接；中键 auxclick 只触发一次', () => {
    const onLink = vi.fn();
    render({ onLinkClick: onLink });
    const components = lastProps().components as Record<string, unknown>;
    const Link = components.a as (props: Record<string, unknown>) => unknown;

    const host = document.createElement('div');
    document.body.append(host);
    const linkRoot = createRoot(host);
    act(() => {
      linkRoot.render(
        createElement(Link as never, { href: 'https://example.com', children: '示例' }),
      );
    });
    const anchor = host.querySelector('a')!;

    // click 携带非左键（例如脚本/键盘构造）不算打开链接。
    const middleClick = new MouseEvent('click', { bubbles: true, cancelable: true, button: 1 });
    act(() => {
      anchor.dispatchEvent(middleClick);
    });
    expect(middleClick.defaultPrevented).toBe(false);
    expect(onLink).not.toHaveBeenCalled();

    // 中键走 auxclick，只触发一次。
    const auxClick = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
    act(() => {
      anchor.dispatchEvent(auxClick);
    });
    expect(auxClick.defaultPrevented).toBe(true);
    expect(onLink).toHaveBeenCalledTimes(1);
    expect(onLink).toHaveBeenCalledWith('https://example.com');

    act(() => linkRoot.unmount());
    host.remove();
  });
});
