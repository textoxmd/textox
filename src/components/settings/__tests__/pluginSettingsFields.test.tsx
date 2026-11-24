import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { PluginSettingsFields, type PluginSettingsFieldsProps } from '../PluginSettingsFields';
import type { SettingsField } from '@texto/plugin-sdk';

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

/** 文案函数：key 原样返回，附带缺省文案时用缺省文案（与 i18next 缺资源时一致）。 */
const t = (key: string, defaultValue?: string) => defaultValue ?? key;

async function renderFields(props: Partial<PluginSettingsFieldsProps> & { fields: SettingsField[] }) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const element = createElement(PluginSettingsFields, {
    values: {},
    onChange: () => {},
    t,
    ...props,
  });
  await act(async () => {
    root!.render(element);
  });
  return container;
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

/** 走原生 setter + input 事件：happy-dom 下直接赋 value 不会触发 React 的 onChange。 */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('PluginSettingsFields', () => {
  it('按 group 分组渲染组标题，未声明 group 的字段不渲染标题', async () => {
    const view = await renderFields({
      fields: [
        { type: 'text', key: 'name', labelKey: 'nameLabel' },
        { type: 'boolean', key: 'emoji', labelKey: 'emojiLabel', group: 'inline', groupLabelKey: 'inlineGroup' },
        { type: 'boolean', key: 'links', labelKey: 'linksLabel', group: 'inline', groupLabelKey: 'inlineGroup' },
      ],
    });

    const titles = [...view.querySelectorAll('[data-slot="plugin-settings-group-title"]')];
    expect(titles).toHaveLength(1);
    expect(titles[0].textContent).toBe('inlineGroup');
    // 两个同组字段共用一个标题，且无组字段排在标题之前（默认组最先出现）。
    expect(view.querySelectorAll('[data-slot="checkbox"]')).toHaveLength(2);
    expect(view.textContent).toContain('nameLabel');
  });

  it('visibleWhen 不满足时隐藏字段，满足时显示', async () => {
    const fields: SettingsField[] = [
      {
        type: 'select',
        key: 'mode',
        labelKey: 'modeLabel',
        default: 'auto',
        options: [{ value: 'auto', label: 'Auto' }],
      },
      { type: 'text', key: 'extra', labelKey: 'extraLabel', visibleWhen: { key: 'mode', equals: 'fixed' } },
    ];

    const hidden = await renderFields({ fields, values: { mode: 'auto' } });
    expect(hidden.textContent).not.toContain('extraLabel');

    const shown = await renderFields({
      fields,
      values: { mode: 'fixed' },
    });
    expect(shown.textContent).toContain('extraLabel');
  });

  it('visibleWhen 可跨 section 求值：依赖字段由 allFields 提供', async () => {
    // 面板按 section 逐段渲染，依赖项往往在另一个 section（mkdext 合并后的典型场景）。
    const advanced: SettingsField = {
      type: 'text',
      key: 'advanced',
      labelKey: 'advancedLabel',
      visibleWhen: { key: 'enabled', equals: true },
    };
    const fields: SettingsField[] = [advanced];
    const withEnabled = (defaultValue: boolean): SettingsField[] => [
      { type: 'boolean', key: 'enabled', labelKey: 'enabledLabel', default: defaultValue },
      advanced,
    ];

    const shown = await renderFields({
      fields,
      allFields: withEnabled(false),
      values: { enabled: true },
    });
    expect(shown.textContent).toContain('advancedLabel');

    // enabled 未写入 → 由 allFields 中的字段默认值回填为 false → 隐藏。
    const hidden = await renderFields({ fields, allFields: withEnabled(false), values: {} });
    expect(hidden.textContent).not.toContain('advancedLabel');

    // 关键回归点：依赖字段默认值为 true 且未写入时，只有 allFields 能回填这个默认值；
    // 仅用 fields 求值会误判为 undefined 而隐藏字段。
    const byDefault = await renderFields({ fields, allFields: withEnabled(true), values: {} });
    expect(byDefault.textContent).toContain('advancedLabel');
  });

  it('不传 allFields 时回退为 fields 本身', async () => {
    const fields: SettingsField[] = [
      { type: 'boolean', key: 'enabled', labelKey: 'enabledLabel', default: false },
      {
        type: 'text',
        key: 'advanced',
        labelKey: 'advancedLabel',
        visibleWhen: { key: 'enabled', equals: true },
      },
    ];

    // 缺省 allFields：只靠 fields 自身回填默认值 → enabled 为 false，高级项隐藏。
    const fallback = await renderFields({ fields, values: {} });
    expect(fallback.textContent).not.toContain('advancedLabel');

    const explicit = await renderFields({ fields, allFields: fields, values: {} });
    expect(explicit.textContent).not.toContain('advancedLabel');
  });

  it('勾选 boolean 时以精确布尔值回调 onChange', async () => {
    const onChange = vi.fn();
    const view = await renderFields({
      fields: [{ type: 'boolean', key: 'shout', labelKey: 'shoutLabel', default: true }],
      values: { shout: true },
      onChange,
    });

    const checkbox = view.querySelector('[data-slot="checkbox"]');
    expect(checkbox).not.toBeNull();
    expect(checkbox!.getAttribute('aria-checked')).toBe('true');

    await click(checkbox!);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('shout', false);
  });

  it('文本输入只透传原始字符串，不做校验', async () => {
    const onChange = vi.fn();
    const view = await renderFields({
      fields: [{ type: 'text', key: 'greeting', labelKey: 'greetingLabel', default: 'Hello' }],
      values: {},
      onChange,
    });

    const input = view.querySelector('input[type="text"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    // 缺省值回填到控件。
    expect(input!.value).toBe('Hello');

    await typeInto(input!, 'Hi');
    expect(onChange).toHaveBeenCalledWith('greeting', 'Hi');
  });

  it('number 越界值原样透传（范围校验属于面板/落盘层）', async () => {
    const onChange = vi.fn();
    const view = await renderFields({
      fields: [{ type: 'number', key: 'count', labelKey: 'countLabel', default: 5, min: 3, max: 20 }],
      values: { count: 5 },
      onChange,
    });

    const input = view.querySelector('input[type="number"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input!.getAttribute('min')).toBe('3');
    expect(input!.getAttribute('max')).toBe('20');

    await typeInto(input!, '99');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('count', 99);
  });

  it('当前值偏离默认值时显示「恢复默认」，点击写回字段默认值', async () => {
    const onChange = vi.fn();
    const view = await renderFields({
      fields: [{ type: 'text', key: 'apiKey', labelKey: 'apiKeyLabel', default: 'def' }],
      values: { apiKey: 'user' },
      onChange,
    });

    const reset = view.querySelector('[data-slot="plugin-field-reset"]');
    expect(reset).not.toBeNull();
    expect(reset!.textContent).toBe('恢复默认');

    await click(reset!);
    expect(onChange).toHaveBeenCalledWith('apiKey', 'def');
  });

  it('当前值等于默认值（或没有默认值）时不显示「恢复默认」', async () => {
    const equalDefault = await renderFields({
      fields: [{ type: 'text', key: 'apiKey', labelKey: 'apiKeyLabel', default: 'def' }],
      values: { apiKey: 'def' },
    });
    expect(equalDefault.querySelector('[data-slot="plugin-field-reset"]')).toBeNull();

    const noDefault = await renderFields({
      fields: [{ type: 'text', key: 'plain', labelKey: 'plainLabel' }],
      values: { plain: 'anything' },
    });
    expect(noDefault.querySelector('[data-slot="plugin-field-reset"]')).toBeNull();
  });

  it('does not render a per-field restart hint (the section shows it once)', async () => {
    const view = await renderFields({
      fields: [
        {
          type: 'boolean',
          key: 'needsRestart',
          labelKey: 'needsRestartLabel',
          default: false,
          apply: 'restart',
        },
        { type: 'boolean', key: 'live', labelKey: 'liveLabel', default: false },
      ],
    });

    // 重启提示是整段级别的（`settings.pluginSettingsRestart` 是整句），字段旁不再重复
    expect(view.querySelector('[data-slot="plugin-field-restart"]')).toBeNull();
    expect(view.textContent).not.toContain('重启后生效');
  });

  it('disabled 时不触发 onChange / onAction', async () => {
    const onChange = vi.fn();
    const onAction = vi.fn();
    const view = await renderFields({
      fields: [
        { type: 'boolean', key: 'shout', labelKey: 'shoutLabel', default: true },
        { type: 'text', key: 'apiKey', labelKey: 'apiKeyLabel', default: 'def' },
        { type: 'action', id: 'test', labelKey: 'actionLabel', run: async () => ({ ok: true }) },
      ],
      values: { shout: true, apiKey: 'user' },
      onChange,
      onAction,
      disabled: true,
    });

    // 所有控件都透传 disabled（happy-dom 不会拦下禁用输入框上的合成事件，
    // 故输入框只断言属性，点击类控件照常验证「点不动」）。
    const textInput = view.querySelector('input[type="text"]') as HTMLInputElement;
    expect(textInput.disabled).toBe(true);
    expect(view.querySelector('[data-slot="checkbox"]')!.hasAttribute('disabled')).toBe(true);
    expect(view.querySelector('[data-slot="plugin-field-reset"]')!.hasAttribute('disabled')).toBe(
      true,
    );

    await click(view.querySelector('[data-slot="checkbox"]')!);
    const actionButton = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'actionLabel',
    );
    expect(actionButton).not.toBeNull();
    await click(actionButton!);

    expect(onChange).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('action 字段点击回调 onAction，preset 按有效配置显示当前选项', async () => {
    const onAction = vi.fn();
    const onChangePatch = vi.fn();
    const view = await renderFields({
      fields: [
        {
          type: 'action',
          id: 'probe',
          labelKey: 'probeLabel',
          run: async () => ({ ok: true, messageKey: 'probeOk' }),
        },
        {
          type: 'preset',
          key: 'preset',
          labelKey: 'presetLabel',
          options: [
            { value: 'warm', label: 'Warm' },
            { value: 'cool', label: 'Cool' },
          ],
          value: () => 'warm',
          apply: () => ({ count: 12 }),
        },
      ],
      onAction,
      onChangePatch,
    });

    const actionButton = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'probeLabel',
    );
    expect(actionButton).not.toBeNull();
    await click(actionButton!);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0]).toMatchObject({ type: 'action', id: 'probe' });

    // radix Select 的选项在 happy-dom 下无法用合成事件选中（pointerup 也不触发提交），
    // 这里只验证 preset 的显示值来自 `field.value(有效配置)`。
    const trigger = view.querySelector('[data-slot="select-trigger"]') as HTMLElement | null;
    expect(trigger).not.toBeNull();
    expect(trigger!.textContent).toBe('Warm');
  });
});
