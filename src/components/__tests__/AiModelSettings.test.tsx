import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { AiModelSettings } from '../settings/AiModelSettings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

interface TestProfile {
  id: string;
  name: string;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
}

/**
 * useSyncExternalStore 要求 getSnapshot 返回稳定引用：mock 的 getAgentSettings
 * 必须一直返回同一个 state 对象（而不是每次新构造字面量），否则 React 会报
 * "The result of getSnapshot should be cached" 并陷入重渲染循环。
 */
const config = vi.hoisted(() => {
  const state = {
    enabled: false,
    profiles: [] as unknown[],
    consent: null as unknown,
    surface: 'floating' as 'floating' | 'sidebar',
  };
  const flags = {
    complete: true,
  };
  return {
    state,
    flags,
    listAgentProfiles: vi.fn(() => state.profiles as never[]),
    isAgentSwitchOn: vi.fn(() => state.enabled),
    consentCoverage: vi.fn(() => ['deepseek', 'custom']),
    providerChoices: vi.fn(() => ['deepseek', 'zhipu', 'custom']),
    defaultModelFor: vi.fn((provider: string) => (provider === 'deepseek' ? 'deepseek-flash' : '')),
    defaultProfileName: vi.fn(
      (provider: string, model: string, label = provider) => (model ? `${label} · ${model}` : label),
    ),
    newProfileId: vi.fn(() => 'p_new'),
    isProfileComplete: vi.fn(() => flags.complete),
    getAgentSettings: vi.fn(() => state),
    subscribeAgentSettings: vi.fn(() => () => {}),
    updateAgentSettings: vi.fn(async () => {}),
    upsertAgentProfile: vi.fn(async () => {}),
    removeAgentProfile: vi.fn(async () => {}),
  };
});

vi.mock('@/agent/config', () => config);

const run = vi.hoisted(() => ({ testAgentConnection: vi.fn(async () => {}) }));
vi.mock('@/agent/run', () => run);

const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('sonner', () => ({ toast }));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(AiModelSettings));
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  config.state.enabled = false;
  config.state.profiles = [];
  config.state.consent = null;
  config.state.surface = 'floating';
  config.flags.complete = true;
});

function profile(overrides: Partial<TestProfile> = {}): TestProfile {
  return {
    id: 'p1',
    name: '工作号',
    provider: 'deepseek',
    model: 'deepseek-flash',
    apiKey: 'k',
    baseUrl: '',
    enabled: true,
    ...overrides,
  };
}

function toggles(): HTMLButtonElement[] {
  return [...container!.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')];
}

function toggleByLabel(label: string): HTMLButtonElement {
  const found = toggles().find((el) => (el.getAttribute('aria-label') ?? '').includes(label));
  if (!found) throw new Error(`toggle not found: ${label}`);
  return found;
}

function button(text: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll<HTMLButtonElement>('button')].find(
    (el) => (el.textContent ?? '').trim() === text,
  );
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

/**
 * 同意页目前仍渲染在同一次 React 树里，后续会换成 portal；
 * 统一从 document 定位对话框根节点，两种情况下都成立。
 */
function dialogEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

function consentCheckboxes(): HTMLElement[] {
  return [...(dialogEl()?.querySelectorAll<HTMLElement>('[data-slot="checkbox"]') ?? [])];
}

function agreeButton(): HTMLButtonElement {
  const found = dialogEl()?.querySelector<HTMLButtonElement>('.ai-consent-agree');
  if (!found) throw new Error('agree button not found');
  return found;
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function field(labelText: string): HTMLInputElement {
  const label = [...container!.querySelectorAll<HTMLLabelElement>('.ai-profile-form label')].find(
    (el) => (el.textContent ?? '').trim().startsWith(labelText),
  );
  const control = label?.querySelector('input');
  if (!control) throw new Error(`field not found: ${labelText}`);
  return control;
}

async function openNewProfileForm(): Promise<void> {
  await click(button('新建配置'));
}

describe('AiModelSettings', () => {
  it('无同意记录时点总开关打开同意页，而不是直接启用', async () => {
    await render();
    await click(toggleByLabel('AI 功能'));

    expect(dialogEl()).not.toBeNull();
    expect(config.updateAgentSettings).not.toHaveBeenCalled();
  });

  it('同意页确认后写入同意记录并同时启用', async () => {
    await render();
    await click(toggleByLabel('AI 功能'));

    const checkboxes = consentCheckboxes();
    expect(checkboxes).toHaveLength(1);
    await click(checkboxes[0]);
    await click(agreeButton());

    expect(config.updateAgentSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        consent: expect.objectContaining({
          version: 1,
          providers: ['deepseek', 'custom'],
          acceptedAt: expect.any(String),
        }),
      }),
    );
    expect(dialogEl()).toBeNull();
  });

  it('已有同意记录时拨到开仍弹同意页', async () => {
    config.state.consent = {
      version: 1,
      acceptedAt: '2026-11-01T00:00:00Z',
      providers: ['deepseek', 'custom'],
    };
    await render();
    await click(toggleByLabel('AI 功能'));

    expect(dialogEl()).not.toBeNull();
    expect(config.updateAgentSettings).not.toHaveBeenCalled();
  });

  it('列出已有配置', async () => {
    config.state.profiles = [profile()];
    await render();

    expect(container!.textContent).toContain('工作号');
    expect(container!.textContent).toContain('deepseek-flash');
  });

  it('未开启时不显示空配置提示，改为提示先开启', async () => {
    await render();
    expect(container!.textContent).toContain('先开启 AI 功能，再添加模型配置');
    expect(container!.textContent).not.toContain('还没有模型配置');

    const add = button('新建配置');
    expect(add.disabled).toBe(true);
    await click(add);
    expect(container!.textContent).not.toContain('服务提供方');
  });

  it('开启后无配置时给出新建提示', async () => {
    config.state.enabled = true;
    await render();
    expect(container!.textContent).toContain('还没有模型配置，先新建一条');
    expect(button('新建配置').disabled).toBe(false);
  });

  it('新建配置填名称后保存走 upsertAgentProfile', async () => {
    config.state.enabled = true;
    await render();
    await openNewProfileForm();
    await type(field('名称'), '新号');
    await click(button('保存'));

    expect(config.upsertAgentProfile).toHaveBeenCalledTimes(1);
    expect(config.upsertAgentProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'p_new',
        name: '新号',
        provider: 'deepseek',
        model: 'deepseek-flash',
        baseUrl: '',
      }),
    );
    expect(config.updateAgentSettings).not.toHaveBeenCalled();
  });

  it('从模型选择器里点选预设模型后保存', async () => {
    config.state.enabled = true;
    await render();
    await openNewProfileForm();

    await click(container!.querySelector('[data-slot="popover-trigger"]')!);
    const option = [...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')].find(
      (el) => (el.textContent ?? '').trim() === 'deepseek-v4-pro',
    );
    expect(option).toBeDefined();
    await click(option!);
    await click(button('保存'));

    expect(config.upsertAgentProfile).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'deepseek-v4-pro' }),
    );
  });

  it('手填未收录的模型 id 也能保存', async () => {
    config.state.enabled = true;
    await render();
    await openNewProfileForm();

    await click(container!.querySelector('[data-slot="popover-trigger"]')!);
    const input = document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
    expect(input).not.toBeNull();
    await type(input!, 'my-own-model');
    const typed = [...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')].find(
      (el) => (el.textContent ?? '').includes('直接使用'),
    );
    expect(typed).toBeDefined();
    await click(typed!);
    await click(button('保存'));

    expect(config.upsertAgentProfile).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'my-own-model' }),
    );
  });

  it('配置不完整时不写入并提示', async () => {
    config.flags.complete = false;
    config.state.enabled = true;
    await render();
    await openNewProfileForm();
    await type(field('名称'), '新号');
    await click(button('保存'));

    expect(config.upsertAgentProfile).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('单条启用开关直接 upsert，不要求同意', async () => {
    config.state.profiles = [profile({ enabled: false })];
    await render();

    await click(toggleByLabel('工作号'));

    expect(config.upsertAgentProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1', enabled: true }),
    );
    expect(dialogEl()).toBeNull();
    expect(config.updateAgentSettings).not.toHaveBeenCalled();
  });

  it('删除需要二次确认：第一次点击只进入确认态', async () => {
    config.state.profiles = [profile()];
    await render();

    await click(button('删除'));

    expect(config.removeAgentProfile).not.toHaveBeenCalled();
    expect(container!.textContent).toContain('确认删除？');

    await click(button('删除'));

    expect(config.removeAgentProfile).toHaveBeenCalledWith('p1');
  });

  it('删除确认态点取消不调用 removeAgentProfile', async () => {
    config.state.profiles = [profile()];
    await render();

    await click(button('删除'));
    await click(button('取消'));

    expect(config.removeAgentProfile).not.toHaveBeenCalled();
    expect(container!.textContent).not.toContain('确认删除？');
  });

  it('同意写入失败时保留同意页', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    config.updateAgentSettings.mockRejectedValueOnce(new Error('boom'));
    await render();
    await click(toggleByLabel('AI 功能'));

    const checkboxes = consentCheckboxes();
    expect(checkboxes).toHaveLength(1);
    await click(checkboxes[0]);
    await click(agreeButton());

    expect(dialogEl()).not.toBeNull();
    expect(toast.error).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('开关已开启时点击只关闭，不弹同意页', async () => {
    config.state.enabled = true;
    await render();

    expect(toggleByLabel('AI 功能').getAttribute('aria-checked')).toBe('true');
    await click(toggleByLabel('AI 功能'));

    expect(config.updateAgentSettings).toHaveBeenCalledWith({ enabled: false });
    expect(dialogEl()).toBeNull();
  });

  it('当前地区不提供的 provider 仍然展示并加标注', async () => {
    config.state.profiles = [
      profile({ provider: 'openai', model: 'gpt-6-luna', name: '海外号' }),
    ];
    await render();

    expect(container!.querySelector('[data-slot="ai-provider-unavailable"]')).not.toBeNull();
    expect(container!.textContent).toContain('当前地区不提供');
    expect(container!.textContent).toContain('gpt-6-luna');
  });

  it('测试连接按 id 调用并提示成功', async () => {
    config.state.profiles = [profile()];
    await render();

    await click(button('测试连接'));
    await act(async () => {});

    expect(run.testAgentConnection).toHaveBeenCalledWith('p1', expect.any(AbortSignal));
    expect(toast.success).toHaveBeenCalled();
  });

  it('测试连接超时后提示连接超时', async () => {
    vi.useFakeTimers();
    try {
      config.state.profiles = [profile()];
      run.testAgentConnection.mockImplementationOnce(() => new Promise<void>(() => {}));
      await render();

      await click(button('测试连接'));
      await act(async () => {
        vi.advanceTimersByTime(8000);
      });

      expect(toast.error).toHaveBeenCalledWith('连接超时');
    } finally {
      vi.useRealTimers();
    }
  });

  it('切换结果显示位置写 surface', async () => {
    await render();
    const trigger = container!.querySelector<HTMLElement>('[data-slot="select-trigger"]');
    expect(trigger).not.toBeNull();
    await click(trigger!);

    const items = [...document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')];
    const sidebar = items.find((item) => (item.textContent ?? '').trim() === '边栏');
    expect(sidebar).toBeDefined();
    await click(sidebar!);

    expect(config.updateAgentSettings).toHaveBeenCalledWith({ surface: 'sidebar' });
  });
});
