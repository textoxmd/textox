import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  declareExtensionPoint,
  defineInsertExtension,
  registerContributions,
  resetExtensionPointsForTests,
  unregisterOwner,
} from '@texto/plugin-sdk';
import {
  MARKDOWN_EDITOR_EXTENSION,
  MARKDOWN_EDITOR_FORMAT_TOOLBAR,
  type InsertCommandMeta,
} from '@texto/markdown-editor-api';

import { SHORTCUT_IDS } from '@/app/constants';
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, type ShortcutAction } from '@/utils/shortcuts';

const { prefetchIcons } = vi.hoisted(() => ({ prefetchIcons: vi.fn() }));
vi.mock('@/components/TextoEditor/src/iconLoader', () => ({ prefetchIcons }));

import {
  resetEditorInsertSurfacesForTests,
  syncEditorInsertSurfaces,
} from '../editorInsertSurfaces';

const OWNER = 'app.textox.demo';

/** 三张表都是模块级可变状态：每个用例前快照、后原样还原，避免污染其它测试。 */
let idsSnapshot: string[] = [];
let defaultsSnapshot: Record<string, string> = {};
let actionsSnapshot: ShortcutAction[] = [];

function command(overrides: Partial<InsertCommandMeta> = {}): InsertCommandMeta {
  return {
    id: 'demo.insert',
    keyword: 'demo',
    labelKey: 'demo.insert.label',
    icon: 'table',
    insert: () => {},
    ...overrides,
  };
}

/** 走真实 SDK 注册表登记一条插入命令（与运行时插件经 bridge 的落点一致）。 */
function registerCommand(cmd: InsertCommandMeta, owner = OWNER): void {
  registerContributions(owner, {
    [MARKDOWN_EDITOR_EXTENSION]: [
      defineInsertExtension({ id: `runtime.insert.${owner}.${cmd.id}`, insert: cmd }),
    ],
  });
}

beforeEach(() => {
  resetExtensionPointsForTests();
  resetEditorInsertSurfacesForTests();
  prefetchIcons.mockClear();

  idsSnapshot = [...SHORTCUT_IDS];
  defaultsSnapshot = { ...DEFAULT_SHORTCUTS };
  actionsSnapshot = SHORTCUT_ACTIONS.map((action) => ({ ...action }));

  declareExtensionPoint({ id: MARKDOWN_EDITOR_EXTENSION }, 'markdown-editor');
  declareExtensionPoint({ id: MARKDOWN_EDITOR_FORMAT_TOOLBAR }, 'markdown-editor');
});

afterEach(() => {
  SHORTCUT_IDS.splice(0, SHORTCUT_IDS.length, ...idsSnapshot);
  for (const key of Object.keys(DEFAULT_SHORTCUTS)) delete DEFAULT_SHORTCUTS[key];
  Object.assign(DEFAULT_SHORTCUTS, defaultsSnapshot);
  SHORTCUT_ACTIONS.splice(0, SHORTCUT_ACTIONS.length, ...actionsSnapshot);
  resetEditorInsertSurfacesForTests();
  resetExtensionPointsForTests();
});

describe('syncEditorInsertSurfaces', () => {
  it('预热贡献项图标', () => {
    registerContributions('demo', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        {
          id: 'demo-insert',
          create: () => ({}),
          insert: {
            id: 'demo',
            keyword: 'demo',
            labelKey: 'common.demo',
            icon: 'bold',
            insert: () => {},
          },
        },
      ],
      [MARKDOWN_EDITOR_FORMAT_TOOLBAR]: [
        {
          id: 'demo-fmt',
          markName: 'em',
          delim: '*',
          labelKey: 'common.italic',
          icon: 'italic',
        },
      ],
    });

    syncEditorInsertSurfaces();

    expect(prefetchIcons).toHaveBeenCalledTimes(1);
    const specs = prefetchIcons.mock.calls[0]![0];
    expect(specs).toContain('bold');
    expect(specs).toContain('italic');
  });

  it('注册新命令后接入 id / 默认键 / 设置项', () => {
    registerCommand(command({ defaultShortcut: 'Cmd+Alt+D', descriptionKey: 'demo.insert.desc' }));

    syncEditorInsertSurfaces();

    expect(SHORTCUT_IDS).toContain('demo.insert');
    expect(DEFAULT_SHORTCUTS['demo.insert']).toBe('Cmd+Alt+D');
    expect(SHORTCUT_ACTIONS.find((action) => action.id === 'demo.insert')).toMatchObject({
      id: 'demo.insert',
      name: 'demo.insert.label',
      description: 'demo.insert.desc',
      defaultShortcut: 'Cmd+Alt+D',
      currentShortcut: 'Cmd+Alt+D',
      category: 'paragraph',
    });
  });

  it('重复同步不产生重复项', () => {
    registerCommand(command({ defaultShortcut: 'Cmd+Alt+D' }));

    syncEditorInsertSurfaces();
    syncEditorInsertSurfaces();

    expect(SHORTCUT_IDS.filter((id) => id === 'demo.insert')).toEqual(['demo.insert']);
    expect(new Set(SHORTCUT_IDS).size).toBe(SHORTCUT_IDS.length);
    expect(SHORTCUT_ACTIONS.filter((action) => action.id === 'demo.insert')).toHaveLength(1);
    expect(DEFAULT_SHORTCUTS['demo.insert']).toBe('Cmd+Alt+D');
  });

  it('命令注销后再同步会撤回三张表的表项', () => {
    registerCommand(command({ defaultShortcut: 'Cmd+Alt+D' }));
    syncEditorInsertSurfaces();
    expect(SHORTCUT_IDS).toContain('demo.insert');

    unregisterOwner(OWNER);
    syncEditorInsertSurfaces();

    expect(SHORTCUT_IDS).not.toContain('demo.insert');
    expect(SHORTCUT_ACTIONS.some((action) => action.id === 'demo.insert')).toBe(false);
    expect('demo.insert' in DEFAULT_SHORTCUTS).toBe(false);
  });

  it('不接管、也不删除宿主内置项', () => {
    // 宿主内置项：`code_block` 本就在三张表里；另造一个只属于宿主的 id 作为哨兵。
    const hostDefault = DEFAULT_SHORTCUTS['code_block'];
    SHORTCUT_IDS.push('host.only');
    DEFAULT_SHORTCUTS['host.only'] = 'Cmd+Alt+H';
    SHORTCUT_ACTIONS.push({
      id: 'host.only',
      name: 'host.only',
      description: 'host.only',
      category: 'paragraph',
      defaultShortcut: 'Cmd+Alt+H',
      currentShortcut: 'Cmd+Alt+H',
    });

    // 插件用一个与内置项相同的 id，且声明了不同的默认键
    registerCommand(command({ id: 'code_block', defaultShortcut: 'Cmd+Alt+K' }));
    syncEditorInsertSurfaces();

    // 已有的默认键优先：插件不得覆盖宿主默认
    expect(DEFAULT_SHORTCUTS['code_block']).toBe(hostDefault);
    expect(SHORTCUT_ACTIONS.filter((action) => action.id === 'code_block')).toHaveLength(1);

    unregisterOwner(OWNER);
    syncEditorInsertSurfaces();

    expect(SHORTCUT_IDS).toContain('code_block');
    expect(SHORTCUT_IDS).toContain('host.only');
    expect(SHORTCUT_ACTIONS.some((action) => action.id === 'code_block')).toBe(true);
    expect(SHORTCUT_ACTIONS.some((action) => action.id === 'host.only')).toBe(true);
    expect(DEFAULT_SHORTCUTS['code_block']).toBe(hostDefault);
    expect(DEFAULT_SHORTCUTS['host.only']).toBe('Cmd+Alt+H');
  });
});
