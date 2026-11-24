import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeEntry } from '@/plugins/runtime/index';

// 只测「读取插件文案」这一层：用内存表替代真实 i18next，避免把 Tauri 事件监听拖进单测。
const bundles = vi.hoisted(() => new Map<string, string>());

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string) => key,
    getFixedT: () => (key: string) => bundles.get(key) ?? key,
  },
}));

import { pluginDisplayDescription, pluginDisplayName } from '../pluginText';

const PLUGIN_ID = 'app.textox.localized';

function entry(manifest: Partial<RuntimeEntry['manifest']> = {}): RuntimeEntry {
  return {
    id: PLUGIN_ID,
    dir: '/tmp/plugins/localized',
    manifest: {
      id: PLUGIN_ID,
      name: 'Manifest Name',
      version: '1.0.0',
      minAppVersion: '2.4.0',
      author: { name: 'Textox' },
      description: 'Manifest description',
      ...manifest,
    },
    enabled: true,
    status: 'enabled',
  } as RuntimeEntry;
}

afterEach(() => {
  bundles.clear();
});

describe('pluginText', () => {
  it('prefers the plugin-provided name over the manifest one', () => {
    bundles.set(`${PLUGIN_ID}.name`, 'ローカライズ名');
    bundles.set(`${PLUGIN_ID}.description`, 'ローカライズ説明');

    expect(pluginDisplayName(entry())).toBe('ローカライズ名');
    expect(pluginDisplayDescription(entry())).toBe('ローカライズ説明');
  });

  it('falls back to the manifest values when the plugin has no locale entry', () => {
    expect(pluginDisplayName(entry())).toBe('Manifest Name');
    expect(pluginDisplayDescription(entry())).toBe('Manifest description');
  });

  it('falls back to the plugin id when the manifest has no name', () => {
    expect(pluginDisplayName(entry({ name: undefined as unknown as string }))).toBe(PLUGIN_ID);
  });

  it('returns an empty description when neither source has one', () => {
    expect(
      pluginDisplayDescription(entry({ description: undefined as unknown as string })),
    ).toBe('');
  });

  it('ignores an empty plugin-provided string so the manifest value still shows', () => {
    bundles.set(`${PLUGIN_ID}.name`, '');

    expect(pluginDisplayName(entry())).toBe('Manifest Name');
  });
});
