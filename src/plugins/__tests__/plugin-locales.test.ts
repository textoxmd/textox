import { describe, expect, it, vi } from 'vitest';
import { collectDeclaredI18nKeys } from '@texto/plugin-sdk';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }));
vi.mock('@/i18n', () => ({
  default: { t: (k: string) => k, language: 'en' },
  registerPluginMessages: vi.fn(async () => {}),
}));

import { listPlugins } from '../registry';

// 生产入口已不再收集第一方旧插件；这些插件现全部位于 `test-fixtures/plugins/`，
// 由共享的测试装配文件注册（与编辑器整合测试同一份清单）。
import '@/components/TextoEditor/tests/plugins-setup';

function resolvePath(root: unknown, path: string): unknown {
  let cur = root;
  for (const seg of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

describe('plugin locales completeness', () => {
  const plugins = () => listPlugins().filter((p) => p.locales);

  // 锁定确切迁移集合：新增/漏迁一个声明 locales 的插件都会失败。
  const MIGRATED_PLUGIN_IDS = [
    'ai-explain', 'ai-translate', 'alert', 'auto-pair', 'emoji', 'footnote',
    'front-matter', 'heading-type-indicator', 'highlight', 'html', 'math',
    'mermaid', 'picgo', 'sub-sup', 'syntax-highlight', 'table', 'toc', 'typing-particle', 'underline',
  ];

  it('declares locales for exactly the migrated plugin set', () => {
    expect(plugins().map((p) => p.id).sort()).toEqual([...MIGRATED_PLUGIN_IDS].sort());
  });

  it('every declared key is namespaced by the plugin id and resolves in defaultLocale', () => {
    for (const plugin of plugins()) {
      const locales = plugin.locales!;
      const def = plugin.defaultLocale ?? Object.keys(locales)[0]!;
      const messages = locales[def];
      expect(messages, `${plugin.id} default locale`).toBeTruthy();
      for (const key of collectDeclaredI18nKeys(plugin)) {
        expect(key.startsWith(`${plugin.id}.`), `${plugin.id} key ${key} prefix`).toBe(true);
        const value = resolvePath(messages, key.slice(plugin.id.length + 1));
        expect(typeof value, `${plugin.id} key ${key} in ${def}`).toBe('string');
      }
    }
  });
});
