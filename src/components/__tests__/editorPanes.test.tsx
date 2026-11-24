import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { EditorPanes } from '../TextoEditor/src/panes/EditorPanes';

function render(props: Parameters<typeof EditorPanes>[0]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(EditorPanes, props)));
  return { host, root };
}

describe('EditorPanes', () => {
  beforeAll(() => {
    // 根配置没有打开 React 的 act 环境（既有编辑器测试同样手动设置）：
    // 不设它 act() 不保证同步刷新，用例会变成偶发失败
    (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  // 断言失败会跳过用例末尾的 unmount / remove，这里兜底清空，避免残留挂载点影响后续用例
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('渲染 #writer 与两个 pane，只有当前模式 data-active=true', () => {
    const { host, root } = render({
      visualMode: 'ir',
      phase: 'idle',
      rtl: false,
      ir: createElement('div', { 'data-testid': 'ir' }),
      sv: createElement('div', { 'data-testid': 'sv' }),
      irHeader: createElement('div', { 'data-testid': 'header' }),
    });
    const irPane = host.querySelector('.editor-pane[data-pane="ir"]')!;
    const svPane = host.querySelector('.editor-pane[data-pane="sv"]')!;
    const header = host.querySelector('[data-testid="header"]')!;
    expect(host.querySelector('#writer')).not.toBeNull();
    expect(host.querySelector('#writer')!.getAttribute('data-pane-transition')).toBeNull();
    expect(irPane.getAttribute('data-active')).toBe('true');
    expect(svPane.getAttribute('data-active')).toBe('false');
    expect(header).not.toBeNull();
    expect(irPane.contains(header)).toBe(true);
    expect(irPane.querySelector('[data-testid="ir"]')).not.toBeNull();
    expect(irPane.querySelector('[data-testid="sv"]')).toBeNull();
    expect(svPane.querySelector('[data-testid="sv"]')).not.toBeNull();

    act(() => root.unmount());
    host.remove();
  });

  it('run 相位带 data-pane-transition', () => {
    const { host, root } = render({
      visualMode: 'sv',
      phase: 'run',
      rtl: true,
      ir: null,
      sv: null,
      className: 'empty-state-no-divider',
    });
    expect(host.querySelector('#writer')!.getAttribute('data-pane-transition')).toBe('run');
    expect(host.querySelector('#writer')!.classList.contains('editor-content-rtl')).toBe(true);
    expect(host.querySelector('#writer')!.classList.contains('empty-state-no-divider')).toBe(true);
    act(() => root.unmount());
    host.remove();
  });
});
