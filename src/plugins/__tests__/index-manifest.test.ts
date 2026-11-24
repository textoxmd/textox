import { describe, expect, it, vi } from 'vitest';
import { APP_COMMAND, APP_SETTINGS_SECTION } from '@texto/app-api';
import { MARKDOWN_EDITOR_EXTENSION } from '@texto/markdown-editor-api';
import { getContributions } from '@texto/plugin-sdk';

import { editorInsertCommands } from '@/components/TextoEditor/src/extension/registry';
import { getExporter } from '@/utils/export/registry';

import { listFileEditors, listPlugins } from '../registry';

// 第一方插件已全部外置；这里的清单与贡献断言改用 `test-fixtures/plugins/` 的
// 同一份装配（与编辑器整合测试共享），继续守护注册/扩展点接线。
import '@/components/TextoEditor/tests/plugins-setup';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }));
// initPlugins 现在会经 runtime → host 静态引入 `@/i18n`；其顶层 `listen(...)` 依赖
// Tauri 运行时，在测试环境会抛未处理拒绝。这里只替换 i18n 默认导出，避免副作用。
vi.mock('@/i18n', () => ({
  default: { t: (k: string) => k, language: 'en' },
  registerPluginMessages: vi.fn(async () => {}),
}));

import { registerPluginMessages } from '@/i18n';

// 回归：插件清单经构建期 glob 收集（src 不出现具体插件标识）。确保 glob 仍能
// 收集并注册插件的默认导出，而不是得到空清单；并确保插件贡献的编辑器扩展经清单可解析。
describe('first-party plugin manifest', () => {
  it('registers at least one plugin via the build-time glob', () => {
    const plugins = listPlugins();
    expect(plugins.length).toBeGreaterThan(0);
    for (const plugin of plugins) {
      expect(typeof plugin.id).toBe('string');
      expect(plugin.id.length).toBeGreaterThan(0);
    }
    // glob 确实收集到 PicGo 插件（默认不启用，但仍应在清单里）
    expect(plugins.some((plugin) => plugin.id === 'picgo')).toBe(true);
  });

  it('registers the mermaid editor extension', () => {
    const mermaid = listPlugins().find((plugin) => plugin.id === 'mermaid');
    expect(mermaid).toBeDefined();
    const ext = mermaid?.contributes?.['markdown-editor:extension']?.[0];
    expect(ext?.id).toBe('mermaid.renderer');
    expect(ext?.languages).toEqual(['mermaid']);
    // 运行时链路：initPlugins() 后贡献确实经 registerPlugins 落入扩展点
    expect(getContributions(MARKDOWN_EDITOR_EXTENSION).some((e) => e.id === 'mermaid.renderer')).toBe(true);
  });

  it('registers first-party app:* contributions through the bootstrap', () => {
    expect(getExporter('html')).toBeDefined();
    // excalidraw 已外置到独立仓库（v1 运行时插件），不再是一方内置插件
    expect(listFileEditors().some((e) => e.id === 'excalidraw.editor')).toBe(false);
    expect(getContributions(APP_COMMAND).some((c) => c.id === 'excalidraw.newDrawing')).toBe(false);
    expect(getContributions(APP_SETTINGS_SECTION).some((s) => s.id === 'mermaid.settings')).toBe(true);
  });

  it('卡片图标必须是 lucide 名称或 IconDef 数组（禁止裸 path 字符串回归）', async () => {
    const { default: dynamicIconImports } = await import('lucide-react/dynamicIconImports');
    const iconNames = new Set(Object.keys(dynamicIconImports));
    for (const plugin of listPlugins()) {
      if (plugin.icon === undefined) continue;
      if (Array.isArray(plugin.icon)) {
        expect(plugin.icon.length, `${plugin.id} 的 IconDef 不能为空`).toBeGreaterThan(0);
        continue;
      }
      expect(plugin.icon, `${plugin.id} 的 icon 必须是 kebab 名称或 IconDef 数组`).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(iconNames.has(plugin.icon), `${plugin.id}: lucide 没有图标 "${plugin.icon}"`).toBe(true);
    }
  });

  // 数学公式的插入命令（id `math_block`）随特性迁到外置插件 `app.textox.mkdext`，
  // 由该插件的 `src/features/math/insert.ts` 注册并经运行时桥接入编辑器；
  // 这里只覆盖仍留在宿主内的第一方插件。

  it('registers the mermaid insert command', () => {
    const mermaid = listPlugins().find((plugin) => plugin.id === 'mermaid');
    const mermaidInsert = mermaid?.contributes?.['markdown-editor:extension']?.find((e) => e.insert)?.insert;
    expect(mermaidInsert?.id).toBe('mermaid');
    expect(mermaidInsert?.keyword).toBe('mermaid');
    expect(editorInsertCommands().some((c) => c.id === 'mermaid')).toBe(true);
  });

  it('injects locales for disabled plugins too (settings page needs them)', () => {
    // picgo 的 defaultEnabled 为 false：即便未启用，其文案也必须注入。
    const injectedIds = vi.mocked(registerPluginMessages).mock.calls.map((call) => call[0]);
    expect(injectedIds).toContain('picgo');
    expect(injectedIds).toContain('table');
  });
});
