import { describe, expect, it } from 'vitest';

import { collectDeclaredI18nKeys } from './plugin-i18n';
import type { TextoPlugin } from './types';

describe('collectDeclaredI18nKeys', () => {
  it('collects every *Key string including nested contributions', () => {
    const plugin = {
      id: 'demo',
      displayNameKey: 'demo.name',
      descriptionKey: 'demo.desc',
      version: '1.0.0',
      locales: { 'en-US': { name: 'Demo' } },
      contributes: {
        'app:settingsSection': [
          {
            id: 'demo.section',
            titleKey: 'demo.sectionTitle',
            fields: [
              { type: 'text', key: 'server', labelKey: 'demo.server', descriptionKey: 'demo.serverDesc' },
              { type: 'select', key: 'mode', labelKey: 'demo.mode', options: [{ value: 'a', labelKey: 'demo.modeA' }] },
            ],
          },
        ],
      },
    } as unknown as TextoPlugin;

    expect(collectDeclaredI18nKeys(plugin).sort()).toEqual(
      ['demo.desc', 'demo.mode', 'demo.modeA', 'demo.name', 'demo.sectionTitle', 'demo.server', 'demo.serverDesc'].sort(),
    );
  });

  it('ignores locales content and non-Key fields', () => {
    const plugin = {
      id: 'demo',
      version: '1.0.0',
      locales: { 'en-US': { nameKey: 'not-a-key' }, 'zh-CN': { nameKey: '也不是' } },
      defaultLocale: 'en-US',
      contributes: {},
    } as unknown as TextoPlugin;
    expect(collectDeclaredI18nKeys(plugin)).toEqual([]);
  });
});
