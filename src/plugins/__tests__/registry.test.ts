import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_AGENT_TOOL, APP_COMMAND, APP_EXPORTER, APP_FILE_EDITOR, APP_IMAGE_UPLOADER, APP_SETTINGS_SECTION, declareAppExtensionPoints } from '@texto/app-api';
import { MARKDOWN_EDITOR_EXTENSION } from '@texto/markdown-editor-api';
import {
  definePlugin,
  getContributions,
  hasExtensionPoint,
  registerContributions,
} from '@texto/plugin-sdk';

import { declareMarkdownEditorExtensionPoint } from '@/components/TextoEditor/src/extension/registry';
import { getExporter } from '@/utils/export/registry';

import { isPluginEnabled, setPluginEnabledState } from '../pluginStatus';
import {
  disabledFileExtensions,
  enabledFileExtensions,
  findCommandByMenuAction,
  isDisabledFileExtension,
  listCommands,
  listCommandsWithOwner,
  listEmbeds,
  listEnabledPlugins,
  listFileEditors,
  listFileEditorsWithOwner,
  listImageUploadersWithOwner,
  listPlugins,
  registerPlugins,
  resetPluginRegistryForTests,
  resolveFileEditor,
  resolveFileEditorWithOwner,
  resolveImageUploaderWithOwner,
  resolveOpenableExtensions,
} from '../registry';
import type { TextoPlugin } from '../types';
import { fakeCommand, fakeExporter, fakeFileEditor, fakePlugin, fakeUploader } from './fixtures/fake-plugin';

const fileEditor = (id: string, ext: string): TextoPlugin =>
  definePlugin({
    id: `p-${id}`,
    version: '0.0.1',
    contributes: {
      [APP_FILE_EDITOR]: [{ id, extensions: [ext], load: async () => ({ default: () => null }) }],
    },
  });

beforeEach(() => {
  declareAppExtensionPoints();
});

afterEach(() => {
  resetPluginRegistryForTests();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('registerPlugins', () => {
  it('indexes every contribution kind', () => {
    registerPlugins([fakePlugin]);

    expect(listPlugins()).toHaveLength(1);
    expect(listFileEditors()).toEqual([fakeFileEditor]);
    // 插件导出器写进运行时权威注册表
    expect(getExporter(fakeExporter.id)).toBe(fakeExporter);
    expect(listCommands()).toEqual([fakeCommand]);
    expect(listImageUploadersWithOwner()[0]?.contribution).toBe(fakeUploader);
  });

  it('registers contributions even when the point owner is later in the list', () => {
    const owner: TextoPlugin = {
      id: 'z-owner',
      version: '1',
      extensionPoints: [{ id: 'z-owner:point' }],
    };
    const contributor: TextoPlugin = {
      id: 'a-contrib',
      version: '1',
      contributes: { 'z-owner:point': [{ id: 'x' }] } as never,
    };

    registerPlugins([contributor, owner]);

    expect(getContributions('z-owner:point')).toEqual([{ id: 'x' }]);
  });

  it('does not duplicate contributions when registerPlugins runs twice', () => {
    registerPlugins([fakePlugin]);
    registerPlugins([fakePlugin]);
    expect(listFileEditors()).toHaveLength(1);
    expect(listCommands()).toHaveLength(1);
  });

  it('skips extension point declarations/contributions from disabled plugins', () => {
    const plugin: TextoPlugin = {
      id: 'off-plugin',
      version: '1',
      defaultEnabled: false,
      extensionPoints: [{ id: 'off-plugin:point' }],
      contributes: { 'off-plugin:point': [{ id: 'x' }] } as never,
    };

    registerPlugins([plugin]);

    expect(hasExtensionPoint('off-plugin:point')).toBe(false);
    expect(getContributions('off-plugin:point')).toEqual([]);
  });

  it('warns when app points are not declared', () => {
    resetPluginRegistryForTests(); // 清掉 beforeEach 声明的应用级扩展点
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerPlugins([fakePlugin]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('应用级扩展点未声明'));
  });
});

describe('resolveFileEditor', () => {
  it('matches by extension, case-insensitively', () => {
    registerPlugins([fakePlugin]);
    expect(resolveFileEditor('/a/b/FILE.FAKE')).toBe(fakeFileEditor);
  });

  it('returns null for unrelated or missing paths', () => {
    registerPlugins([fakePlugin]);
    expect(resolveFileEditor('/a/b/note.md')).toBeNull();
    expect(resolveFileEditor(null)).toBeNull();
    expect(resolveFileEditor('')).toBeNull();
  });

  it('last registration wins on id collision', () => {
    const replacement = definePlugin({
      id: 'fake-2',
      version: '0.0.1',
      contributes: {
        [APP_FILE_EDITOR]: [
          { id: 'fake.editor', extensions: ['.other'], load: async () => ({ default: () => null }) },
        ],
      },
    });
    registerPlugins([fakePlugin, replacement]);

    const editors = listFileEditors();
    expect(editors).toHaveLength(1);
    expect(editors[0]!.extensions).toEqual(['.other']);
  });

  it('warns on id collision', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const replacement = definePlugin({
      id: 'fake-2',
      version: '0.0.1',
      contributes: {
        [APP_FILE_EDITOR]: [
          { id: 'fake.editor', extensions: ['.other'], load: async () => ({ default: () => null }) },
        ],
      },
    });
    registerPlugins([fakePlugin, replacement]);
    expect(warn).toHaveBeenCalled();
  });
});

describe('listEmbeds', () => {
  it('lists embeds from editor extension contributions', () => {
    declareMarkdownEditorExtensionPoint();
    registerContributions('p', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        { id: 'p.embed', embed: { extensions: ['.fake'], insertLabelKey: 'fake.insert' }, create: () => ({}) },
      ],
    } as never);
    expect(listEmbeds()).toEqual([{ id: 'p.embed', extensions: ['.fake'], insertLabelKey: 'fake.insert' }]);
  });
});

describe('command lookup', () => {
  it('finds by menu action', () => {
    registerPlugins([fakePlugin]);
    expect(findCommandByMenuAction('fake_action')).toBe(fakeCommand);
    expect(findCommandByMenuAction('missing')).toBeUndefined();
  });
});

describe('owner-aware registry', () => {
  it('reports the owning plugin for commands and file editors', () => {
    registerPlugins([fakePlugin]);
    expect(listCommandsWithOwner()).toEqual([{ pluginId: 'fake', command: fakeCommand }]);
    expect(listFileEditorsWithOwner()).toEqual([
      { pluginId: 'fake', contribution: fakeFileEditor },
    ]);
  });

  it('resolves the file-editor owner by extension, last registration wins', () => {
    registerPlugins([fileEditor('a.editor', '.shared'), fileEditor('b.editor', '.shared')]);
    expect(resolveFileEditorWithOwner('x.shared')).toEqual({
      pluginId: 'p-b.editor',
      contribution: expect.objectContaining({ id: 'b.editor' }),
    });
    expect(resolveFileEditorWithOwner('note.md')).toBeNull();
    expect(resolveFileEditorWithOwner(null)).toBeNull();
  });
});

describe('resetPluginRegistryForTests', () => {
  it('clears all registries', () => {
    registerPlugins([fakePlugin]);
    resetPluginRegistryForTests();
    expect(listPlugins()).toHaveLength(0);
    expect(listFileEditors()).toHaveLength(0);
  });
});

describe('plugin enable status', () => {
  it('skips contributions from disabled plugins but keeps them listed', () => {
    setPluginEnabledState('fake', false);
    registerPlugins([fakePlugin]);

    expect(listPlugins()).toHaveLength(1);
    expect(listFileEditors()).toEqual([]);
    expect(listCommands()).toEqual([]);
    expect(getExporter(fakeExporter.id)).toBeUndefined();
  });

  it('registers contributions when enabled again', () => {
    setPluginEnabledState('fake', false);
    registerPlugins([fakePlugin]);
    setPluginEnabledState('fake', true);
    registerPlugins([fakePlugin]);

    expect(listFileEditors()).toEqual([fakeFileEditor]);
    expect(listCommands()).toEqual([fakeCommand]);
  });

  it('honors defaultEnabled: false when the user has not chosen', () => {
    const offByDefault = definePlugin({
      id: 'off-default',
      version: '0.0.1',
      defaultEnabled: false,
      contributes: {
        [APP_FILE_EDITOR]: [{ id: 'off.editor', extensions: ['.off'], load: async () => ({ default: () => null }) }],
      },
    });
    registerPlugins([offByDefault]);

    expect(listFileEditors()).toEqual([]);
    expect(listPlugins()).toHaveLength(1);
  });

  it('listEnabledPlugins excludes disabled plugins', () => {
    setPluginEnabledState('fake', false);
    registerPlugins([fakePlugin]);
    expect(listEnabledPlugins()).toEqual([]);
    expect(isPluginEnabled('fake')).toBe(false);
  });

  it('listEnabledPlugins returns plugins that are enabled', () => {
    registerPlugins([fakePlugin]);
    expect(listEnabledPlugins()).toEqual([fakePlugin]);
  });
});

describe('disabledFileExtensions', () => {
  it('reports extensions declared by disabled plugins, normalized', () => {
    setPluginEnabledState('fake', false);
    registerPlugins([fakePlugin]);
    expect(disabledFileExtensions().sort()).toEqual(['fake']);
  });

  it('normalizes case and leading dot, deduplicating across plugins', () => {
    setPluginEnabledState('fake', false);
    setPluginEnabledState('fake-upper', false);
    registerPlugins([
      fakePlugin,
      definePlugin({
        id: 'fake-upper',
        version: '0.0.1',
        contributes: {
          [APP_FILE_EDITOR]: [{ id: 'fake-upper.editor', extensions: ['.FAKE'], load: async () => ({ default: () => null }) }],
        },
      }),
    ]);
    expect(disabledFileExtensions()).toEqual(['fake']);
  });

  it('reports nothing when plugins are enabled', () => {
    registerPlugins([fakePlugin]);
    expect(disabledFileExtensions()).toEqual([]);
  });

  it('reports app:fileEditor extensions declared by disabled plugins', () => {
    setPluginEnabledState('whiteboard-off', false);
    registerPlugins([
      definePlugin({
        id: 'whiteboard-off',
        version: '0.0.1',
        contributes: {
          [APP_FILE_EDITOR]: [{ id: 'whiteboard-off.editor', extensions: ['.whiteboard'], load: async () => ({ default: () => null }) }],
        },
      }),
    ]);
    expect(disabledFileExtensions()).toContain('whiteboard');
  });

  it('reports embed extensions declared by disabled plugins', () => {
    setPluginEnabledState('embed-off', false);
    registerPlugins([
      definePlugin({
        id: 'embed-off',
        version: '0.0.1',
        contributes: {
          [MARKDOWN_EDITOR_EXTENSION]: [
            { id: 'embed-off.embed', embed: { extensions: ['.whiteboard'], insertLabelKey: 'x.insert' }, create: () => ({}) },
          ],
        } as never,
      }),
    ]);
    expect(disabledFileExtensions()).toContain('whiteboard');
  });
});

describe('isDisabledFileExtension', () => {
  it('matches paths whose extension belongs to a disabled plugin', () => {
    setPluginEnabledState('fake', false);
    registerPlugins([fakePlugin]);
    expect(isDisabledFileExtension('/a/b/FILE.FAKE')).toBe(true);
    expect(isDisabledFileExtension('/a/b/note.md')).toBe(false);
    expect(isDisabledFileExtension('/a/b/noext')).toBe(false);
  });

  it('handles Windows-style paths', () => {
    setPluginEnabledState('fake', false);
    registerPlugins([fakePlugin]);
    expect(isDisabledFileExtension('C:\\a\\b\\FILE.FAKE')).toBe(true);
  });
});

describe('resolveOpenableExtensions', () => {
  it('returns the base list when no plugin declares extensions', () => {
    registerPlugins([]);
    expect(resolveOpenableExtensions(['md', 'txt'])).toEqual(['md', 'txt']);
  });

  it('appends extensions declared by enabled plugins', () => {
    const plugin = fileEditor('board', '.whiteboard');
    registerPlugins([plugin]);
    expect(enabledFileExtensions()).toEqual(['whiteboard']);
    expect(resolveOpenableExtensions(['md', 'txt'])).toEqual(['md', 'txt', 'whiteboard']);
  });

  it('drops extensions whose plugin is installed but disabled', () => {
    const plugin = fileEditor('board', 'whiteboard');
    setPluginEnabledState('p-board', false);
    registerPlugins([plugin]);
    expect(enabledFileExtensions()).toEqual([]);
    expect(resolveOpenableExtensions(['md', 'whiteboard'])).toEqual(['md']);
  });

  it('does not duplicate extensions already in the base list', () => {
    registerPlugins([fileEditor('board', '.WHITEBOARD')]);
    expect(resolveOpenableExtensions(['md', 'whiteboard'])).toEqual(['md', 'whiteboard']);
    expect(resolveOpenableExtensions(['md', 'WhiteBoard'])).toEqual(['md', 'WhiteBoard']);
  });

  it('includes embed extensions declared by enabled plugins', () => {
    declareMarkdownEditorExtensionPoint();
    registerPlugins([
      definePlugin({
        id: 'embed-on',
        version: '0.0.1',
        contributes: {
          [MARKDOWN_EDITOR_EXTENSION]: [
            { id: 'embed-on.embed', embed: { extensions: ['.board'], insertLabelKey: 'x.insert' }, create: () => ({}) },
          ],
        } as never,
      }),
    ]);
    expect(resolveOpenableExtensions(['md'])).toEqual(['md', 'board']);
  });
});

describe('last-wins resolution across different ids', () => {
  it('picks the last-registered file editor when extensions overlap', () => {
    registerPlugins([fileEditor('a.editor', '.shared'), fileEditor('b.editor', '.shared')]);
    expect(resolveFileEditor('x.shared')?.id).toBe('b.editor');
  });

  it('picks the last-registered command when menu actions overlap', () => {
    const cmd = (pluginId: string, titleKey: string) =>
      definePlugin({
        id: pluginId,
        version: '0.0.1',
        contributes: {
          [APP_COMMAND]: [{ id: `${pluginId}.cmd`, titleKey, category: 'plugin', menuAction: 'dup', run: () => {} }],
        },
      });
    registerPlugins([cmd('c1', 'a'), cmd('c2', 'b')]);
    expect(findCommandByMenuAction('dup')?.id).toBe('c2.cmd');
  });
});

describe('validation and overlap warnings', () => {
  it('warns on an empty contributions array', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerPlugins([definePlugin({ id: 'empty', version: '0.0.1', contributes: { [APP_COMMAND]: [] } })]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('app:command 声明了空数组'));
  });

  it('warns on a malformed file-editor extension', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerPlugins([
      definePlugin({
        id: 'bad-ext',
        version: '0.0.1',
        contributes: {
          [APP_FILE_EDITOR]: [{ id: 'bad.editor', extensions: ['txt'], load: async () => ({ default: () => null }) }],
        },
      }),
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('应以 "." 开头'));
  });

  it('warns when two plugins claim the same extension', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerPlugins([fileEditor('a.editor', '.dup'), fileEditor('b.editor', '.dup')]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('扩展名'));
  });

  it('warns on an exporter id collision without blocking the later registration', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const exporter = () => ({ id: 'dup-export', labelKey: 'x', extension: 'x', kind: 'text' as const, run: async () => ({ data: '', suggestedName: 'x' }) });
    const first = exporter();
    const second = exporter();
    registerPlugins([
      definePlugin({ id: 'ea', version: '0.0.1', contributes: { [APP_EXPORTER]: [first] } }),
      definePlugin({ id: 'eb', version: '0.0.1', contributes: { [APP_EXPORTER]: [second] } }),
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('exporter id 冲突'));
    expect(getExporter('dup-export')).toBe(second);
  });

  it('warns on malformed agent tool contributions', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerPlugins([
      definePlugin({
        id: 'tools',
        version: '0.0.1',
        contributes: {
          [APP_AGENT_TOOL]: [
            {
              name: 'nodot',
              description: '   ',
              parameters: {},
              execute: async () => ({ content: '' }),
            },
          ],
        },
      }),
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('应以 "<owner>.<name>" 形式命名'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('缺少 description'));
  });
});

describe('image uploader resolution', () => {
  const uploader = (id: string, pluginId: string): TextoPlugin =>
    definePlugin({
      id: pluginId,
      version: '0.0.1',
      contributes: { [APP_IMAGE_UPLOADER]: [{ id, upload: async () => 'u' }] },
    });

  it('returns null when no uploader is registered', () => {
    expect(resolveImageUploaderWithOwner()).toBeNull();
  });

  it('resolves the uploader with its owner plugin id', () => {
    registerPlugins([uploader('p.uploader', 'p')]);
    expect(resolveImageUploaderWithOwner()).toEqual({
      pluginId: 'p',
      contribution: { id: 'p.uploader', upload: expect.any(Function) },
    });
  });

  it('picks the last-registered uploader when several are enabled', () => {
    registerPlugins([uploader('a.uploader', 'a'), uploader('b.uploader', 'b')]);
    expect(resolveImageUploaderWithOwner()?.contribution.id).toBe('b.uploader');
    expect(resolveImageUploaderWithOwner()?.pluginId).toBe('b');
    expect(listImageUploadersWithOwner().map((u) => u.pluginId)).toEqual(['a', 'b']);
  });

  it('ignores uploaders of disabled plugins', () => {
    setPluginEnabledState('p', false);
    registerPlugins([uploader('p.uploader', 'p')]);
    expect(resolveImageUploaderWithOwner()).toBeNull();
  });
});

describe('settings sections are not gated by enable state', () => {
  const withSettings = (id: string, sectionId: string): TextoPlugin =>
    definePlugin({
      id,
      version: '0.0.1',
      contributes: {
        [APP_COMMAND]: [{ id: `${id}.cmd`, titleKey: 't', category: 'plugin', run: () => {} }],
        [APP_SETTINGS_SECTION]: [{ id: sectionId, titleKey: 't', fields: [] }],
      },
    });

  it('registers settings sections for disabled plugins but not their other contributions', () => {
    setPluginEnabledState('off', false);
    registerPlugins([withSettings('off', 'off.settings')]);

    expect(getContributions(APP_SETTINGS_SECTION).map((c) => c.id)).toEqual(['off.settings']);
    expect(getContributions(APP_COMMAND).map((c) => c.id)).toEqual([]);
  });

  it('still registers settings sections for enabled plugins', () => {
    registerPlugins([withSettings('on', 'on.settings')]);

    expect(getContributions(APP_SETTINGS_SECTION).map((c) => c.id)).toEqual(['on.settings']);
    expect(getContributions(APP_COMMAND).map((c) => c.id)).toEqual(['on.cmd']);
  });
});
