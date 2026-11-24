import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  declareExtensionPoint,
  registerContributions,
  resetExtensionPointsForTests,
} from '@texto/plugin-sdk';
import { MARKDOWN_EDITOR_EXTENSION, MARKDOWN_EDITOR_FORMAT_TOOLBAR } from '@texto/markdown-editor-api';
import type { FormatToolbarItemMeta, InsertCommandMeta } from '@texto/markdown-editor-api';
import { BUILTIN_TOOLBAR_ITEMS, contributedFormatToolbarItem, contributedToolbarItem } from '../items';
import { listToolbarItems, registerToolbarItem, resetToolbarItemsForTests } from '../registry';
import type { ToolbarContext, ToolbarItem } from '../types';

function makeItem(overrides: Partial<ToolbarItem> = {}): ToolbarItem {
  return {
    id: 'test.item',
    group: 'inline',
    order: 0,
    labelKey: 'common.bold',
    icon: () => null,
    run: () => {},
    ...overrides,
  };
}

describe('toolbar registry', () => {
  beforeEach(() => resetToolbarItemsForTests());

  it('默认只含内置项', () => {
    expect(listToolbarItems()).toEqual(BUILTIN_TOOLBAR_ITEMS);
  });

  it('注册后出现在列表中', () => {
    registerToolbarItem(makeItem({ id: 'plugin.x' }));
    expect(listToolbarItems().some((i) => i.id === 'plugin.x')).toBe(true);
  });

  it('同 id 后注册者覆盖先注册者', () => {
    registerToolbarItem(makeItem({ id: 'dup', labelKey: 'menu.heading_1' }));
    registerToolbarItem(makeItem({ id: 'dup', labelKey: 'menu.heading_2' }));
    const found = listToolbarItems().filter((i) => i.id === 'dup');
    expect(found).toHaveLength(1);
    expect(found[0].labelKey).toBe('menu.heading_2');
  });

  it('运行时项可覆盖同名内置项', () => {
    registerToolbarItem(makeItem({ id: 'bold', labelKey: 'menu.heading_1' }));
    const found = listToolbarItems().filter((i) => i.id === 'bold');
    expect(found).toHaveLength(1);
    expect(found[0].labelKey).toBe('menu.heading_1');
    // 顺序：被覆盖项保持原位置（bold 是内置第一项），总数不变
    const all = listToolbarItems();
    expect(all[0].id).toBe('bold');
    expect(all.length).toBe(BUILTIN_TOOLBAR_ITEMS.length);
  });

  it('非法 item 被拒绝（仅告警不注册）', () => {
    registerToolbarItem(makeItem({ id: 'bad.group', group: 'nope' as never }));
    expect(listToolbarItems().some((i) => i.id === 'bad.group')).toBe(false);
  });

  it('缺少 run 的 item 被拒绝', () => {
    registerToolbarItem(makeItem({ id: 'bad.run', run: undefined as never }));
    expect(listToolbarItems().some((i) => i.id === 'bad.run')).toBe(false);
  });
});

describe('toolbar registry / 插件贡献插入项', () => {
  beforeEach(() => {
    resetToolbarItemsForTests();
    resetExtensionPointsForTests();
  });

  it('贡献插入项并入 insert 组（派生自 editorInsertCommands）', () => {
    declareExtensionPoint({ id: MARKDOWN_EDITOR_EXTENSION }, 'markdown-editor');
    registerContributions('demo', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        {
          id: 'demo.ins',
          insert: {
            id: 'demo-insert',
            keyword: 'demo',
            labelKey: 'common.table',
            icon: [['path', 'M0 0h1v1H0z']],
            order: 0,
            insert: () => {},
          },
          create: () => ({}),
        },
      ],
    });

    const item = listToolbarItems().find((i) => i.id === 'demo-insert');
    expect(item).toBeTruthy();
    expect(item!.group).toBe('insert');
    expect(item!.labelKey).toBe('common.table');
    expect(item!.icon).toBeTruthy();
  });

  it('贡献项覆盖同名内置项且保持原位置', () => {
    declareExtensionPoint({ id: MARKDOWN_EDITOR_EXTENSION }, 'markdown-editor');
    registerContributions('demo', {
      [MARKDOWN_EDITOR_EXTENSION]: [
        {
          id: 'demo.bold',
          insert: {
            id: 'bold',
            keyword: 'bold2',
            labelKey: 'common.boldContributed',
            icon: [['path', 'M0 0h1v1H0z']],
            insert: () => {},
          },
          create: () => ({}),
        },
      ],
    });

    const all = listToolbarItems();
    const bold = all.filter((i) => i.id === 'bold');
    expect(bold).toHaveLength(1);
    expect(bold[0]!.labelKey).toBe('common.boldContributed');
    // 跨组覆盖：贡献项固定归入 insert 组，覆盖后仍占内置项原位、总数不变
    expect(bold[0]!.group).toBe('insert');
    expect(all[0]!.id).toBe('bold');
    expect(all.length).toBe(BUILTIN_TOOLBAR_ITEMS.length);
  });
});

describe('contributedToolbarItem editable guard', () => {
  it('does not insert when the editor view is not editable', () => {
    const insert = vi.fn();
    const cmd: InsertCommandMeta = {
      id: 'demo',
      keyword: 'demo',
      labelKey: 'demo.label',
      icon: [['path', 'M0 0h1v1H0z']],
      insert,
    };
    const item = contributedToolbarItem(cmd);
    const ctx = {
      editorRef: { current: { editorView: { editable: false } } },
      getView: () => ({}),
      active: { blockInsertDisabled: false },
      isSingleFileMode: false,
    } as unknown as ToolbarContext;

    item.run(ctx);

    expect(insert).not.toHaveBeenCalled();
  });
});

describe('toolbar registry / 插件贡献格式项', () => {
  beforeEach(() => {
    resetToolbarItemsForTests();
    resetExtensionPointsForTests();
  });

  it('surfaces 含 toolbar 的贡献项并入 inline 组，仅 floating 的不出现', () => {
    declareExtensionPoint({ id: MARKDOWN_EDITOR_FORMAT_TOOLBAR }, 'markdown-editor');
    const ul: FormatToolbarItemMeta = {
      id: 'fmt.ul',
      markName: 'underline',
      delim: '<u>',
      closeDelim: '</u>',
      labelKey: 'common.underline',
      icon: [['path', 'M0 0h1v1H0z']],
      order: 4,
    };
    const floatingOnly: FormatToolbarItemMeta = {
      id: 'fmt.float',
      markName: 'm',
      delim: '**',
      labelKey: 'x',
      icon: [['path', 'M0 0h1v1H0z']],
      surfaces: ['floating'],
    };
    registerContributions('demo', {
      [MARKDOWN_EDITOR_FORMAT_TOOLBAR]: [ul, floatingOnly],
    });

    const all = listToolbarItems();
    const found = all.find((i) => i.id === 'fmt.ul');
    expect(found).toBeTruthy();
    expect(found!.group).toBe('inline');
    expect(found!.activeMark).toBe('underline');
    expect(all.some((i) => i.id === 'fmt.float')).toBe(false);
  });

  it('贡献项图标投影为图标组件（经 iconComponentFromSpec）', () => {
    declareExtensionPoint({ id: MARKDOWN_EDITOR_FORMAT_TOOLBAR }, 'markdown-editor');
    const item: FormatToolbarItemMeta = {
      id: 'fmt.icon',
      markName: 'underline',
      delim: '<u>',
      closeDelim: '</u>',
      labelKey: 'common.underline',
      icon: [['path', 'M6 4v6a6 6 0 0 0 12 0V4']],
      order: 4,
    };
    registerContributions('demo-icon', {
      [MARKDOWN_EDITOR_FORMAT_TOOLBAR]: [item],
    });
    const found = listToolbarItems().find((i) => i.id === 'fmt.icon');
    expect(found).toBeTruthy();
    expect(typeof found!.icon).toBe('function');
  });

  it('字符串图标（lucide 名）也能投影出图标组件', () => {
    declareExtensionPoint({ id: MARKDOWN_EDITOR_FORMAT_TOOLBAR }, 'markdown-editor');
    const withName: FormatToolbarItemMeta = {
      id: 'fmt.named',
      markName: 'underline',
      delim: '<u>',
      closeDelim: '</u>',
      labelKey: 'common.underline',
      icon: 'underline',
      order: 4,
    };
    registerContributions('demo-name', {
      [MARKDOWN_EDITOR_FORMAT_TOOLBAR]: [withName],
    });
    const found = listToolbarItems().find((i) => i.id === 'fmt.named');
    expect(found).toBeTruthy();
    expect(typeof found!.icon).toBe('function');
  });
});

describe('contributedFormatToolbarItem', () => {
  it('投影 group / order / labelKey / activeMark，缺省无 isActive', () => {
    const meta: FormatToolbarItemMeta = {
      id: 'fmt.x',
      markName: 'underline',
      delim: '<u>',
      closeDelim: '</u>',
      labelKey: 'common.underline',
      icon: [['path', 'M0 0h1v1H0z']],
      order: 7,
    };
    const item = contributedFormatToolbarItem(meta);
    expect(item.group).toBe('inline');
    expect(item.order).toBe(7);
    expect(item.labelKey).toBe('common.underline');
    expect(item.activeMark).toBe('underline');
    expect(item.isActive).toBeUndefined();
  });

  it('自定义 isActive 用 view.state 求值', () => {
    const meta: FormatToolbarItemMeta = {
      id: 'fmt.y',
      markName: 'm',
      delim: '**',
      labelKey: 'x',
      icon: [['path', 'M0 0h1v1H0z']],
      isActive: () => true,
    };
    const item = contributedFormatToolbarItem(meta);
    const ctx = { getView: () => ({ state: {} }) } as unknown as ToolbarContext;
    expect(item.isActive!(ctx)).toBe(true);
  });
});
