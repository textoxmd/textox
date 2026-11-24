import { APP_SETTINGS_SECTION } from '@texto/app-api';
import { definePlugin, OFFICIAL_AUTHOR } from '@texto/plugin-sdk';
import {
  MARKDOWN_EDITOR_CONTEXT_MENU,
  defineCodeBlockExtension,
  defineInsertExtension,
} from '@texto/markdown-editor-api';

import './mermaid.css';
import { mermaidContextMenuItem } from './context-menu';
import { resolveRenderer, setActiveRenderer } from './diagram-engine';
import { mermaidInsert } from './insert';
import { defaultLocale, locales } from './locales';
import { createMermaidPreview } from './mermaid-renderer';
import { CONFIG_RENDERER, mermaidSettingsSection } from './renderer-settings';

export default definePlugin({
  id: 'mermaid',
  displayNameKey: 'mermaid.pluginName',
  locales,
  defaultLocale,
  version: '1.0.0',
  author: OFFICIAL_AUTHOR,
  category: 'editor',
  settingsApply: 'immediate',
  icon: 'workflow',
  contributes: {
    'markdown-editor:extension': [
      defineCodeBlockExtension({
        id: 'mermaid.renderer',
        languages: ['mermaid'],
        createPreview: createMermaidPreview,
      }),
      defineInsertExtension({ id: 'mermaid.insert', insert: mermaidInsert }),
    ],
    [MARKDOWN_EDITOR_CONTEXT_MENU]: [mermaidContextMenuItem],
    [APP_SETTINGS_SECTION]: [mermaidSettingsSection],
  },
  async activate(host) {
    let config: Record<string, unknown> = {};
    try {
      config = await host.config.getAll<Record<string, unknown>>();
    } catch (error) {
      console.error('[mermaid] 读取插件配置失败，使用默认渲染器', error);
    }
    setActiveRenderer(resolveRenderer(config[CONFIG_RENDERER]));
    host.config.subscribe((next) => {
      setActiveRenderer(resolveRenderer(next[CONFIG_RENDERER]));
    });
  },
});
