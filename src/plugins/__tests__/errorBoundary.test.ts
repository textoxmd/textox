import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { PluginErrorBoundary } from '../PluginErrorBoundary';

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Boom(): ReactElement {
  throw new Error('boom');
}

describe('PluginErrorBoundary', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  it('renders a fallback instead of letting the error unmount the app', () => {
    // React 会在控制台重放一次错误，屏蔽掉避免测试输出噪音
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    expect(() =>
      act(() => {
        root!.render(createElement(PluginErrorBoundary, null, createElement(Boom)));
      }),
    ).not.toThrow();

    expect(container.querySelector('.plugin-editor-error')).not.toBeNull();
    expect(container.textContent).toContain('boom');
    spy.mockRestore();
  });
});
