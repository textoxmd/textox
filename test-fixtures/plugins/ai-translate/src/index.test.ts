import { describe, expect, it } from 'vitest';
import { APP_SETTINGS_SECTION } from '@texto/app-api';
import plugin from './index';
import { locales } from './locales';

describe('ai-translate manifest', () => {
  it('declares id, name, description, icon and default enabled', () => {
    expect(plugin.id).toBe('ai-translate');
    expect(plugin.displayNameKey).toBe('ai-translate.pluginName');
    expect(plugin.descriptionKey).toBe('ai-translate.pluginDescription');
    expect(plugin.icon).toBe('languages');
    expect(plugin.defaultEnabled).toBe(false);
    expect(plugin.settingsApply).toBe('immediate');

    const messages = locales['en-US'];
    expect(messages.pluginName).toBe('Translate');
    expect(messages.pluginDescription).toContain('Translate');
  });

  it('contributes its settings section', () => {
    const sections = plugin.contributes?.[APP_SETTINGS_SECTION] ?? [];
    expect(sections).toHaveLength(1);
    expect(sections[0]!.id).toBe('ai-translate.settings');
  });
});
