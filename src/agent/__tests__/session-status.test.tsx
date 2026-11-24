import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { resetAgentSession, resetAgentSessionForTests, setAgentSession } from '../session';
import { useAgentSessionStatus, useAgentSessionTabLabel } from '../session-status';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const status = useAgentSessionStatus();
  const label = useAgentSessionTabLabel();
  return createElement('span', { 'data-status': status, 'data-label': label });
}

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  resetAgentSessionForTests();
});

describe('session status hooks', () => {
  it('status 与 tabLabel 随会话变化', () => {
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root!.render(createElement(Probe)));

    expect(container.querySelector('span')?.dataset.status).toBe('idle');
    expect(container.querySelector('span')?.dataset.label).toBe('');

    act(() => {
      setAgentSession({
        title: '翻译 · 文本',
        tabLabel: '翻译',
        anchor: null,
        request: { messages: [{ role: 'user', content: 'hi' }] },
      });
    });
    expect(container.querySelector('span')?.dataset.status).toBe('streaming');
    expect(container.querySelector('span')?.dataset.label).toBe('翻译');

    act(() => resetAgentSession());
    expect(container.querySelector('span')?.dataset.status).toBe('idle');
    expect(container.querySelector('span')?.dataset.label).toBe('');
  });
});
