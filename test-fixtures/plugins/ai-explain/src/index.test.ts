import { describe, expect, it } from 'vitest';
import { APP_SETTINGS_SECTION } from '@texto/app-api';
import { MARKDOWN_EDITOR_SELECTION_ACTION } from '@texto/markdown-editor-api';
import plugin from './index';
import { locales } from './locales';

describe('ai-explain manifest', () => {
  it('uses a functional display name and description', () => {
    expect(plugin.id).toBe('ai-explain');
    expect(plugin.displayNameKey).toBe('ai-explain.pluginName');
    expect(plugin.descriptionKey).toBe('ai-explain.pluginDescription');
    expect(plugin.icon).toBe('book-open-text');

    const messages = locales['en-US'];
    expect(messages.pluginName).toBe('Explain');
    expect(messages.pluginDescription).toContain('Explain');
  });

  it('默认关闭', () => {
    expect(plugin.defaultEnabled).toBe(false);
  });

  it('声明 modelProfile 设置段', () => {
    const sections = plugin.contributes?.[APP_SETTINGS_SECTION] ?? [];
    expect(sections[0]?.fields).toEqual([
      expect.objectContaining({ type: 'modelProfile', key: 'modelProfile' }),
    ]);
  });

  it('设置变更即时生效', () => {
    expect(plugin.settingsApply).toBe('immediate');
  });

  it('contributes exactly one explain selection action', () => {
    const actions = plugin.contributes?.[MARKDOWN_EDITOR_SELECTION_ACTION] ?? [];
    expect(actions).toHaveLength(1);
    expect(actions[0]!.id).toBe('ai-explain.explain');
  });

  it('localizes the Chinese name', () => {
    expect(locales['zh-CN'].pluginName).toBe('释义');
    expect(locales['zh-TW'].pluginName).toBe('釋義');
  });
});
