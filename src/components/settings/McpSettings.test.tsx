import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => {
  const state = { enabled: false };
  const url = 'http://127.0.0.1:38471/mcp';
  return {
    state,
    url,
    invoke: vi.fn(async (command: string, args?: { config?: { mcp_enabled?: boolean; mcp_port?: number } }) => {
      if (command === 'get_config') {
        return { auto_save: false, mcp_enabled: state.enabled, mcp_port: 38471 };
      }
      if (command === 'set_config') {
        state.enabled = args?.config?.mcp_enabled === true;
        return undefined;
      }
      if (command === 'get_mcp_status') {
        return {
          enabled: state.enabled,
          running: state.enabled,
          port: 38471,
          url,
          error: null,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    }),
  };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: api.invoke }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('sonner', () => ({ toast }));

import { McpSettings } from './McpSettings';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(McpSettings));
  });
}

function findButton(label: string, scope: ParentNode = container!): HTMLButtonElement {
  const button = Array.from(scope.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(label),
  );
  if (!button) throw new Error(`button not found: ${label}`);
  return button as HTMLButtonElement;
}

function findIconButton(label: string, scope: ParentNode = container!): HTMLButtonElement {
  const button = scope.querySelector(`button[aria-label="${label}"]`);
  if (!button) throw new Error(`icon button not found: ${label}`);
  return button as HTMLButtonElement;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('McpSettings', () => {
  beforeEach(() => {
    api.state.enabled = false;
    api.invoke.mockClear();
    toast.success.mockClear();
    toast.error.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => {}) },
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it('显示端口与停止状态', async () => {
    await render();

    const port = container!.querySelector('input[type="number"]') as HTMLInputElement;
    expect(port.value).toBe('38471');
    expect(container!.textContent).toContain('settings.mcp.stopped');
  });

  it('打开开关后通过 set_config 落盘并刷新状态', async () => {
    await render();

    const checkbox = container!.querySelector('[data-slot="checkbox"]') as HTMLElement;
    await act(async () => {
      checkbox.click();
    });

    const setCall = api.invoke.mock.calls.find(([command]) => command === 'set_config');
    expect(setCall?.[1]).toEqual({
      config: expect.objectContaining({ mcp_enabled: true }),
    });
    expect(container!.textContent).toContain('settings.mcp.running');
  });

  it('客户端配置在弹窗中查看并可复制', async () => {
    await render();

    // 未打开弹窗前不展示配置内容。
    expect(document.body.textContent).not.toContain('"servers"');

    await act(async () => {
      findButton('settings.mcp.viewConfig').click();
    });

    const dialog = document.querySelector('[data-slot="dialog-content"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain(api.url);
    expect(dialog!.textContent).toContain('"servers"');

    await act(async () => {
      findButton('settings.mcp.copyConfig', dialog!).click();
    });

    const copied = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(copied).toContain(api.url);
    expect(copied).toContain('"mcp"');
    expect(toast.success).toHaveBeenCalledWith('settings.mcp.copiedConfig');
  });

  it('端口改动只作为草稿，点「应用」后才落盘', async () => {
    await render();

    const port = container!.querySelector('input[type="number"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(port, '38472');
    });

    // 编辑过程中不写配置、不触发重启。
    expect(api.invoke.mock.calls.some(([command]) => command === 'set_config')).toBe(false);

    await act(async () => {
      findButton('settings.mcp.apply').click();
    });

    const setCall = api.invoke.mock.calls.find(([command]) => command === 'set_config');
    expect(setCall?.[1]).toEqual({ config: expect.objectContaining({ mcp_port: 38472 }) });
  });

  it('端口被改动后可用撤销图标恢复默认值', async () => {
    await render();

    const port = container!.querySelector('input[type="number"]') as HTMLInputElement;
    // 默认端口下不出现撤销入口。
    expect(container!.querySelector('button[aria-label="settings.mcp.resetPort"]')).toBeNull();

    await act(async () => {
      setInputValue(port, '38472');
    });
    expect(port.value).toBe('38472');

    await act(async () => {
      findIconButton('settings.mcp.resetPort').click();
    });
    expect(port.value).toBe('38471');
    // 只是把草稿恢复成默认值，仍需点「应用」才落盘。
    expect(api.invoke.mock.calls.some(([command]) => command === 'set_config')).toBe(false);
  });

  it('非法端口不应用', async () => {
    await render();

    const port = container!.querySelector('input[type="number"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(port, '999');
    });

    const apply = findButton('settings.mcp.apply');
    expect(apply.disabled).toBe(true);
    await act(async () => {
      apply.click();
    });
    expect(api.invoke.mock.calls.some(([command]) => command === 'set_config')).toBe(false);
  });
});
