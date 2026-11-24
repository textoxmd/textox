import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AgentPanel } from '../AgentPanel';
import { resetAgentConfigForTests } from '../config';
import {
  finishAgentSession,
  resetAgentSession,
  resetAgentSessionForTests,
  setAgentSession,
} from '../session';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { invoke, listen } = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: unknown): Promise<unknown> => ({})),
  listen: vi.fn(async (_event: string, _handler: (event: unknown) => void) => () => {}),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));
// 测试只关心 key 本身（i18n 资源由任务 8 补齐）。
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderPanel(): void {
  if (!root || !container) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  }
  act(() => {
    root!.render(createElement(AgentPanel));
  });
}

function seedDone(): void {
  setAgentSession({
    title: '解释',
    anchor: null,
    request: { messages: [{ role: 'user', content: 'hi' }] },
  });
  finishAgentSession('你好');
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({});
  resetAgentConfigForTests();
  resetAgentSessionForTests();
});

afterEach(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  resetAgentConfigForTests();
  resetAgentSessionForTests();
  document.body.innerHTML = '';
});

describe('AgentPanel', () => {
  it('idle 时不渲染面板', () => {
    renderPanel();

    expect(container!.querySelector('.agent-sidebar-panel')).toBeNull();
  });

  it('idle → streaming → idle 时面板跟着出现/消失', () => {
    renderPanel();
    expect(container!.querySelector('.agent-sidebar-panel')).toBeNull();

    act(() => {
      setAgentSession({
        title: '解释',
        anchor: null,
        request: { messages: [{ role: 'user', content: 'hi' }] },
      });
    });
    expect(container!.querySelector('.agent-sidebar-panel')).not.toBeNull();

    // 用 resetAgentSession（会 notify）而非 resetAgentSessionForTests（清空 listeners 且不 notify），
    // 否则组件失去订阅、快照变化不会触发重渲染。
    act(() => {
      resetAgentSession();
    });
    expect(container!.querySelector('.agent-sidebar-panel')).toBeNull();
  });

  it('有结果时渲染结果视图', () => {
    seedDone();

    renderPanel();

    const panel = container!.querySelector('.agent-sidebar-panel');
    expect(panel!.querySelector('.agent-result-sidebar')).not.toBeNull();
    expect(panel!.textContent).toContain('你好');
  });

  it('不依赖 agent_result_surface 配置（侧栏内始终同一视图）', () => {
    seedDone();

    renderPanel();

    expect(container!.querySelector('.agent-sidebar-panel')).not.toBeNull();
    expect(container!.querySelector('.agent-result')).not.toBeNull();
  });
});
