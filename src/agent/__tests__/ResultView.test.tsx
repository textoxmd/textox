import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AgentResultView } from '../ResultView';
import {
  failAgentSession,
  finishAgentSession,
  resetAgentSessionForTests,
  setAgentSession,
} from '../session';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn(async (_url: string): Promise<void> => {}),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('sonner', () => ({ toast }));

// 测试只关心 key 本身（i18n 资源由任务 8 补齐）。
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let originalClipboard: PropertyDescriptor | undefined;

// 结果视图只按会话的 profileId 反查 profile 展示服务商 / 模型。
const config = vi.hoisted(() => ({
  findAgentProfile: vi.fn(),
  getAgentSettings: vi.fn(),
  subscribeAgentSettings: vi.fn(),
  upsertAgentProfile: vi.fn(),
}));
vi.mock('../config', () => ({
  findAgentProfile: config.findAgentProfile,
  getAgentSettings: config.getAgentSettings,
  subscribeAgentSettings: config.subscribeAgentSettings,
  upsertAgentProfile: config.upsertAgentProfile,
}));

const openaiProfile = {
  id: 'p1',
  name: '工作号',
  provider: 'openai' as const,
  model: 'gpt-6-luna',
  apiKey: 'sk-openai',
  baseUrl: '',
  enabled: true,
};

const deepseekProfile = {
  id: 'p2',
  name: '国内号',
  provider: 'deepseek' as const,
  model: 'deepseek-flash',
  apiKey: 'sk-deepseek',
  baseUrl: '',
  enabled: true,
};

function renderView(variant: 'floating' | 'sidebar' = 'floating'): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(AgentResultView, { variant }));
  });
}

function seedDone(
  text: string,
  options: { sourceText?: string; tabLabel?: string; profileId?: string } = {},
): void {
  setAgentSession({
    title: '解释',
    tabLabel: options.tabLabel,
    sourceText: options.sourceText,
    anchor: null,
    request: { messages: [{ role: 'user', content: 'hi' }] },
    profileId: options.profileId ?? openaiProfile.id,
  });
  finishAgentSession(text);
}

function click(element: Element): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  act(() => {
    element.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  openUrl.mockReset();
  openUrl.mockResolvedValue(undefined);
  toast.success.mockReset();
  toast.error.mockReset();
  originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  resetAgentSessionForTests();
  const profiles = [openaiProfile, deepseekProfile];
  config.findAgentProfile.mockReset();
  config.findAgentProfile.mockImplementation(
    (id: string) => profiles.find((profile) => profile.id === id) ?? null,
  );
  config.getAgentSettings.mockReset();
  config.getAgentSettings.mockReturnValue({
    enabled: true,
    profiles,
    consent: null,
    surface: 'floating',
  });
  config.subscribeAgentSettings.mockReset();
  config.subscribeAgentSettings.mockReturnValue(() => {});
  config.upsertAgentProfile.mockReset();
  config.upsertAgentProfile.mockResolvedValue(undefined);
});

afterEach(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  } else {
    delete (navigator as { clipboard?: unknown }).clipboard;
  }
  resetAgentSessionForTests();
  document.body.innerHTML = '';
});

describe('AgentResultView links', () => {
  it('http(s) 链接阻止默认导航并交给系统浏览器', () => {
    seedDone('查看 [示例](https://example.com)');
    renderView();

    // Streamdown 会把 URL 规范化（补尾斜杠）。
    const link = container!.querySelector('a[href="https://example.com/"]');
    expect(link).not.toBeNull();

    const event = click(link!);

    expect(event.defaultPrevented).toBe(true);
    expect(openUrl).toHaveBeenCalledWith('https://example.com/');
  });

  it('mailto: 链接放行', () => {
    seedDone('[邮件](mailto:help@example.com)');
    renderView();

    const mail = container!.querySelector('a[href="mailto:help@example.com"]');
    expect(mail).not.toBeNull();

    const event = click(mail!);

    expect(event.defaultPrevented).toBe(true);
    expect(openUrl).toHaveBeenCalledWith('mailto:help@example.com');
  });
});

describe('AgentResultView actions placement', () => {
  it('sidebar 变体把操作按钮放在底部 footer，标题栏不含按钮', () => {
    seedDone('正文');
    renderView('sidebar');

    const footer = container!.querySelector('.agent-result-footer');
    expect(footer).not.toBeNull();
    expect(footer!.querySelectorAll('button')).toHaveLength(5);
    expect([...footer!.querySelectorAll('button')].map((b) => b.getAttribute('title'))).toEqual([
      'agent.switchModel',
      'agent.copy',
      'agent.retry',
      'agent.floatBack',
      'agent.close',
    ]);
    expect(container!.querySelector('.agent-result-header .agent-result-actions')).toBeNull();

    const floatBack = footer!.querySelector('button[title="agent.floatBack"]');
    expect(floatBack).not.toBeNull();
    expect(
      floatBack!.querySelector('svg')?.classList.contains('lucide-picture-in-picture-2'),
    ).toBe(true);
  });

  it('有原文时 footer 增加原文按钮，顺序在模型切换之后', () => {
    seedDone('正文', { sourceText: '选中的原文' });
    renderView('sidebar');

    const footer = container!.querySelector('.agent-result-footer');
    expect(footer).not.toBeNull();
    expect(footer!.querySelectorAll('button')).toHaveLength(6);
    expect([...footer!.querySelectorAll('button')].map((b) => b.getAttribute('title'))).toEqual([
      'agent.switchModel',
      'agent.source',
      'agent.copy',
      'agent.retry',
      'agent.floatBack',
      'agent.close',
    ]);
    expect(container!.querySelector('.agent-result-header .agent-result-source-toggle')).toBeNull();
  });

  it('floating 变体与侧栏共用底部 footer，且没有顶部标题栏', () => {
    seedDone('正文', { sourceText: '选中的原文' });
    renderView('floating');

    expect(container!.querySelector('.agent-result-header')).toBeNull();
    expect(container!.querySelector('.agent-result-title')).toBeNull();

    const footer = container!.querySelector('.agent-result-footer');
    expect(footer).not.toBeNull();
    expect([...footer!.querySelectorAll('button')].map((b) => b.getAttribute('title'))).toEqual([
      'agent.switchModel',
      'agent.copy',
      'agent.retry',
      'agent.moveToSidebar',
      'agent.close',
    ]);
    // 悬浮卡不提供「原文」入口。
    expect(container!.querySelector('.agent-result-source-toggle')).toBeNull();
    expect(
      footer!.querySelector('button[title="agent.moveToSidebar"] svg')?.classList.contains(
        'lucide-panel-right',
      ),
    ).toBe(true);
  });
});

describe('AgentResultView sidebar header identity', () => {
  it('done 时 header 常驻但为空，避免正文上移', () => {
    seedDone('正文', { tabLabel: '翻译', sourceText: 'Markdown' });
    renderView('sidebar');

    const header = container!.querySelector('.agent-result-header');
    expect(header).not.toBeNull();
    expect(header!.querySelector('.agent-result-busy-wave')).toBeNull();
    expect(header!.querySelector('svg')).toBeNull();
    expect(container!.querySelector('.agent-result-source-toggle')).not.toBeNull();
    expect(
      container!.querySelector('.agent-result-source-toggle')!.closest('.agent-result-footer'),
    ).not.toBeNull();
  });

  it('streaming 时声波在常驻 header 内，正文在 header 下方', () => {
    setAgentSession({
      title: '解释',
      tabLabel: '翻译',
      sourceText: '选中的原文',
      anchor: null,
      request: { messages: [{ role: 'user', content: 'hi' }] },
    });
    renderView('sidebar');

    const header = container!.querySelector('.agent-result-header');
    expect(header).not.toBeNull();
    const wave = header!.querySelector('.agent-result-busy-wave');
    expect(wave).not.toBeNull();
    expect(wave!.getAttribute('data-icon')).toBe('model-settings');
    expect(container!.querySelector('.agent-result-busy-overlay')).toBeNull();
  });

  it('点击 footer 原文按钮从底部展开面板，再点或点关闭按钮收起', () => {
    seedDone('正文', { tabLabel: '翻译', sourceText: '选中的原文' });
    renderView('sidebar');

    expect(container!.querySelector('.agent-result-source-panel')).toBeNull();
    const toggle = container!.querySelector('.agent-result-footer .agent-result-source-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');

    click(toggle!);

    const panel = container!.querySelector('.agent-result-source-panel');
    expect(panel).not.toBeNull();
    expect(panel!.querySelector('.agent-result-source-panel-header')?.textContent).toBe(
      'agent.source',
    );
    expect(panel!.querySelector('.agent-result-source')?.textContent).toBe('选中的原文');
    expect(
      container!.querySelector('.agent-result-footer .agent-result-source-toggle')!.getAttribute(
        'aria-expanded',
      ),
    ).toBe('true');

    click(panel!.querySelector('.agent-result-source-panel-header button')!);
    expect(container!.querySelector('.agent-result-source-panel')).toBeNull();

    click(container!.querySelector('.agent-result-footer .agent-result-source-toggle')!);
    expect(container!.querySelector('.agent-result-source-panel')).not.toBeNull();
    click(container!.querySelector('.agent-result-footer .agent-result-source-toggle')!);
    expect(container!.querySelector('.agent-result-source-panel')).toBeNull();
  });

  it('没有原文时 footer 不显示原文按钮', () => {
    seedDone('正文', { tabLabel: '翻译' });
    renderView('sidebar');

    expect(container!.querySelector('.agent-result-source-toggle')).toBeNull();
  });

  it('结束后 header 仍在但为空', () => {
    seedDone('正文', { tabLabel: '翻译' });
    renderView('sidebar');

    const header = container!.querySelector('.agent-result-header');
    expect(header).not.toBeNull();
    expect(header!.textContent).toBe('');
    expect(header!.querySelector('.agent-result-busy')).toBeNull();
    expect(header!.querySelector('svg')).toBeNull();
    expect(container!.querySelector('.agent-result-footer')).not.toBeNull();
  });
});

describe('AgentResultView model menu', () => {
  it('按会话的 profile 展示 provider 与模型列表', () => {
    seedDone('正文', { profileId: 'p2' });
    renderView('sidebar');

    const toggle = container!.querySelector('.agent-result-model-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle!.querySelector('[data-provider]')?.getAttribute('data-provider')).toBe(
      'deepseek',
    );

    click(toggle!);

    const menu = container!.querySelector('.agent-model-menu');
    expect(menu).not.toBeNull();
    expect([...menu!.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
      'deepseek-flash',
      'deepseek-v4-pro',
    ]);
    expect(menu!.querySelector('button[aria-checked="true"]')?.textContent).toContain(
      'deepseek-flash',
    );
  });

  it('profile 已被删除时退回 custom 与空模型名', () => {
    seedDone('正文', { profileId: 'gone' });
    renderView('sidebar');

    const toggle = container!.querySelector('.agent-result-model-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle!.querySelector('[data-provider]')?.getAttribute('data-provider')).toBe('custom');

    click(toggle!);

    expect(container!.querySelector('.agent-model-menu-empty')?.textContent).toBe('custom');
  });

  it('配置变更后按 profile 展示的模型同步更新', () => {
    const listeners = new Set<() => void>();
    config.subscribeAgentSettings.mockImplementation((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    seedDone('正文');
    renderView('sidebar');

    click(container!.querySelector('.agent-result-model-toggle')!);
    expect(
      container!.querySelector('.agent-model-menu button[aria-checked="true"]')?.textContent,
    ).toContain('gpt-6-luna');
    click(container!.querySelector('.agent-result-model-toggle')!);

    act(() => {
      // 模拟设置页把这条配置的模型改掉并广播（新 settings 产出新对象引用）。
      const updated = { ...openaiProfile, model: 'gpt-6.1-sol' };
      config.findAgentProfile.mockImplementation((id: string) =>
        id === openaiProfile.id ? updated : null,
      );
      for (const listener of listeners) listener();
    });

    click(container!.querySelector('.agent-result-model-toggle')!);
    expect(
      container!.querySelector('.agent-model-menu button[aria-checked="true"]')?.textContent,
    ).toContain('gpt-6.1-sol');
  });

  it('点击模型按钮弹出当前 provider 的模型列表，当前模型有勾选', () => {
    seedDone('正文');
    renderView('sidebar');

    expect(container!.querySelector('.agent-model-menu')).toBeNull();
    const toggle = container!.querySelector('.agent-result-model-toggle');
    expect(toggle).not.toBeNull();

    click(toggle!);

    const menu = container!.querySelector('.agent-model-menu');
    expect(menu).not.toBeNull();
    expect([...menu!.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
      'gpt-6-luna',
      'gpt-6.1-sol',
      'gpt-6-astra',
    ]);
    expect(menu!.querySelector('button[aria-checked="true"]')?.textContent).toContain('gpt-6-luna');
  });

  it('点击某个模型后菜单关闭，并把模型写回该 profile', async () => {
    seedDone('正文');
    renderView('sidebar');

    click(container!.querySelector('.agent-result-model-toggle')!);
    const target = [...container!.querySelectorAll('.agent-model-menu button')].find(
      (button) => button.textContent?.trim() === 'gpt-6.1-sol',
    );
    expect(target).toBeDefined();

    click(target!);
    await act(async () => {});

    expect(container!.querySelector('.agent-model-menu')).toBeNull();
    expect(config.upsertAgentProfile).toHaveBeenCalledWith({
      ...openaiProfile,
      model: 'gpt-6.1-sol',
    });
  });

  it('floating 变体同样可以切换模型', () => {
    seedDone('正文');
    renderView('floating');

    const toggle = container!.querySelector('.agent-result-model-toggle');
    expect(toggle).not.toBeNull();
    expect(container!.querySelector('.agent-model-menu')).toBeNull();

    click(toggle!);

    expect(container!.querySelector('.agent-model-menu')).not.toBeNull();
  });
});

describe('AgentResultView streaming indicator', () => {
  it('流式时显示忙碌声波，结束后消失但 header 保留', () => {
    setAgentSession({
      title: '解释',
      tabLabel: '翻译',
      anchor: null,
      request: { messages: [{ role: 'user', content: 'hi' }] },
    });
    renderView('sidebar');

    const header = container!.querySelector('.agent-result-header');
    expect(header).not.toBeNull();
    expect(header!.querySelector('.agent-result-busy')).not.toBeNull();

    act(() => {
      finishAgentSession('完成');
    });

    expect(container!.querySelector('.agent-result-busy')).toBeNull();
    expect(container!.querySelector('.agent-result-header')).not.toBeNull();
    expect(container!.querySelector('.agent-result-header svg')).toBeNull();
  });

  it('floating 变体没有状态行，流式无文本时用「…」占位', () => {
    setAgentSession({
      title: '解释',
      anchor: null,
      request: { messages: [{ role: 'user', content: 'hi' }] },
    });
    renderView('floating');

    expect(container!.querySelector('.agent-result-header')).toBeNull();
    expect(container!.querySelector('.agent-result-busy-wave')).toBeNull();
    expect(container!.querySelector('.agent-result-placeholder')?.textContent).toBe('…');

    act(() => {
      finishAgentSession('完成');
    });

    expect(container!.querySelector('.agent-result-header')).toBeNull();
  });
});

describe('AgentResultView scroll state', () => {
  it('正文内容延伸到工具条下方时标记 has-scroll-underlap', () => {
    seedDone('正文');
    renderView('floating');

    const root = container!.querySelector('.agent-result');
    const body = container!.querySelector('.agent-result-body') as HTMLElement;
    expect(root!.classList.contains('has-scroll-underlap')).toBe(false);

    Object.defineProperty(body, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true });
    act(() => {
      body.dispatchEvent(new Event('scroll'));
    });

    expect(root!.classList.contains('has-scroll-underlap')).toBe(true);
  });

  it('侧栏变体的正文顶部渐隐随滚动出现', () => {
    seedDone('正文');
    renderView('sidebar');

    const area = container!.querySelector('.agent-result-body-area');
    const edge = area?.querySelector('.scroll-edge-top');
    expect(edge).not.toBeNull();
    expect(edge!.classList.contains('is-visible')).toBe(false);

    const body = container!.querySelector('.agent-result-body') as HTMLElement;
    Object.defineProperty(body, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(body, 'scrollTop', { value: 100, configurable: true, writable: true });
    act(() => {
      body.dispatchEvent(new Event('scroll'));
    });

    expect(edge!.classList.contains('is-visible')).toBe(true);
  });
});

describe('AgentResultView copy', () => {
  it('复制成功提示 agent.copied', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    seedDone('复制我');
    renderView();

    click(container!.querySelector('button[title="agent.copy"]')!);
    await act(async () => {});

    expect(writeText).toHaveBeenCalledWith('复制我');
    expect(toast.success).toHaveBeenCalledWith('agent.copied');
  });

  it('复制失败提示 agent.copyFailed（不再静默）', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('denied');
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    seedDone('复制我');
    renderView();

    click(container!.querySelector('button[title="agent.copy"]')!);
    await act(async () => {});

    expect(toast.error).toHaveBeenCalledWith('agent.copyFailed');
  });

  it('clipboard 不存在时提示 agent.copyFailed', () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    seedDone('复制我');
    renderView();

    click(container!.querySelector('button[title="agent.copy"]')!);

    expect(toast.error).toHaveBeenCalledWith('agent.copyFailed');
  });

  it('sidebar footer 的复制按钮复制完整结果', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    seedDone('复制我');
    renderView('sidebar');

    click(container!.querySelector('.agent-result-footer button[title="agent.copy"]')!);
    await act(async () => {});

    expect(writeText).toHaveBeenCalledWith('复制我');
  });
});

describe('AgentResultView states', () => {
  it('流式且尚无文本时 header 显示声波', () => {
    setAgentSession({
      title: '解释',
      anchor: null,
      request: { messages: [{ role: 'user', content: 'hi' }] },
    });
    renderView('sidebar');

    const header = container!.querySelector('.agent-result-header');
    expect(header).not.toBeNull();
    expect(header!.querySelector('.agent-result-busy-wave')).not.toBeNull();
    expect(container!.querySelector('.agent-result-footer')).not.toBeNull();
  });

  it('出错时显示错误信息，并保留侧栏 footer', () => {
    setAgentSession({
      title: '解释',
      anchor: null,
      request: { messages: [{ role: 'user', content: 'hi' }] },
    });
    failAgentSession('模型不可用');
    renderView('sidebar');

    expect(container!.querySelector('.agent-result-error')?.textContent).toBe('模型不可用');
    expect(container!.querySelector('.agent-result-footer')).not.toBeNull();
  });

  it('出错且没有文本时只显示错误条，不挂载 Streamdown', () => {
    setAgentSession({
      title: '解释',
      anchor: null,
      request: { messages: [{ role: 'user', content: 'hi' }] },
    });
    failAgentSession('失败');
    renderView('sidebar');

    expect(container!.querySelector('.agent-result-error')?.textContent).toBe('失败');
    expect(container!.querySelector('.agent-streamdown')).toBeNull();
  });
});
