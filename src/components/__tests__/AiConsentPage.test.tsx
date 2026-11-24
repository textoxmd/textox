import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactElement } from 'react';

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { createRoot, type Root } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // 模拟 i18next 的插值，否则 `{{current}}` 会原样留在文案里。
    t: (key: string, fallback?: string, options?: Record<string, unknown>) =>
      Object.entries(options ?? {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        fallback ?? key,
      ),
  }),
}));

import { AiConsentPage } from '../settings/AiConsentPage';
import type { AgentProviderId } from '@/agent/providers-catalog';

let root: Root | null = null;

async function render(props: {
  providers: AgentProviderId[];
  onCancel?: () => void;
  onAgree?: () => void | Promise<void>;
}): Promise<void> {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const element: ReactElement = createElement(AiConsentPage, {
    providers: props.providers,
    onCancel: props.onCancel ?? (() => {}),
    onAgree: props.onAgree ?? (() => {}),
  });
  await act(async () => root!.render(element));
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
});

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!found) throw new Error('dialog not rendered');
  return found;
}

function text(): string {
  return dialog().textContent ?? '';
}

function checkboxes(): HTMLElement[] {
  return [...dialog().querySelectorAll<HTMLElement>('[data-slot="checkbox"]')];
}

function byClass(name: string): HTMLButtonElement {
  const found = dialog().querySelector<HTMLButtonElement>(`.${name}`);
  if (!found) throw new Error(`button not found: ${name}`);
  return found;
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

describe('AiConsentPage', () => {
  it('纯境内服务商时单步呈现，不出现出境字样', async () => {
    await render({ providers: ['deepseek', 'zhipu'] });

    expect(text()).toContain('开启 AI 功能');
    expect(text()).not.toContain('出境');
    expect(text()).not.toContain('第 1 步');
    expect(checkboxes()).toHaveLength(1);
    expect(dialog().querySelector('.ai-consent-next')).toBeNull();
  });

  it('含境外服务商时分两步，第一步只读', async () => {
    await render({ providers: ['deepseek', 'openai'] });

    expect(text()).toContain('第 1 步 / 共 2 步');
    expect(text()).toContain('你的内容会发送到这些服务商');
    expect(checkboxes()).toHaveLength(0);

    await click(byClass('ai-consent-next'));

    expect(text()).toContain('第 2 步 / 共 2 步');
    expect(text()).toContain('个人信息出境');
    expect(checkboxes()).toHaveLength(2);
  });

  it('第二步两项都勾选后才可提交', async () => {
    const onAgree = vi.fn();
    await render({ providers: ['openai'], onAgree });

    await click(byClass('ai-consent-next'));
    expect(byClass('ai-consent-agree').disabled).toBe(true);

    await click(checkboxes()[0]);
    expect(byClass('ai-consent-agree').disabled).toBe(true);

    await click(checkboxes()[1]);
    expect(byClass('ai-consent-agree').disabled).toBe(false);

    await click(byClass('ai-consent-agree'));
    expect(onAgree).toHaveBeenCalledTimes(1);
  });

  it('上一步回到第一步并保留勾选', async () => {
    await render({ providers: ['openai'] });

    await click(byClass('ai-consent-next'));
    await click(checkboxes()[0]);
    await click(checkboxes()[1]);

    await click(byClass('ai-consent-back'));
    expect(text()).toContain('第 1 步 / 共 2 步');

    await click(byClass('ai-consent-next'));
    expect(byClass('ai-consent-agree').disabled).toBe(false);
  });

  it('custom 不触发出境步骤，只给中性说明', async () => {
    await render({ providers: ['deepseek', 'custom'] });

    expect(checkboxes()).toHaveLength(1);
    expect(text()).not.toContain('出境');
    expect(text()).toContain('请自行确认其运营方');
    expect(dialog().querySelectorAll('.ai-consent-recipients a')).toHaveLength(1);
  });

  it('隐私链接指向服务商政策地址', async () => {
    await render({ providers: ['deepseek'] });
    const link = dialog().querySelector('.ai-consent-recipients a') as HTMLAnchorElement;
    expect(link.href).toBe('https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html');
  });

  it('暂不开启调用 onCancel 且不提交', async () => {
    const onCancel = vi.fn();
    const onAgree = vi.fn();
    await render({ providers: ['deepseek'], onCancel, onAgree });

    await click(byClass('ai-consent-decline'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAgree).not.toHaveBeenCalled();
  });

  it('未勾选时点击同意不触发提交', async () => {
    const onAgree = vi.fn();
    await render({ providers: ['deepseek'], onAgree });

    await click(byClass('ai-consent-agree'));

    expect(onAgree).not.toHaveBeenCalled();
  });

  it('提交进行中不允许取消或回退', async () => {
    const onCancel = vi.fn();
    let resolveAgree: (() => void) | null = null;
    const onAgree = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAgree = resolve;
        }),
    );
    await render({ providers: ['openai'], onCancel, onAgree });

    await click(byClass('ai-consent-next'));
    await click(checkboxes()[0]);
    await click(checkboxes()[1]);
    await click(byClass('ai-consent-agree'));

    expect(dialog().querySelector('.ai-consent-decline')).toBeNull();
    expect(byClass('ai-consent-back').disabled).toBe(true);

    await click(byClass('ai-consent-back'));
    expect(onCancel).not.toHaveBeenCalled();
    expect(text()).toContain('第 2 步 / 共 2 步');

    await act(async () => {
      resolveAgree?.();
    });
  });

  it('单步提交中点击暂不开启不会取消', async () => {
    const onCancel = vi.fn();
    let resolveAgree: (() => void) | null = null;
    const onAgree = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAgree = resolve;
        }),
    );
    await render({ providers: ['deepseek'], onCancel, onAgree });

    await click(checkboxes()[0]);
    await click(byClass('ai-consent-agree'));

    const decline = byClass('ai-consent-decline');
    expect(decline.disabled).toBe(true);
    await click(decline);

    expect(onCancel).not.toHaveBeenCalled();

    // Esc 走 Radix 的 onOpenChange(false)：提交中必须被 !submitting 守卫挡住。
    await act(async () => {
      dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onCancel).not.toHaveBeenCalled();

    await act(async () => {
      resolveAgree?.();
    });
  });
});
