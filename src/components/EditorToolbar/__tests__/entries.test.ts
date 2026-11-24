import { describe, expect, it } from 'vitest';
import type { ComponentType } from 'react';
import { buildToolbarEntries, groupEntriesBySection, isEntryVisible, omittedToolbarEntries } from '../entries';
import type { ToolbarContext, ToolbarItem } from '../types';
import type { ToolbarActiveState } from '../../TextoEditor/src/features/toolbar-state';

const Icon: ComponentType<{ size?: number | string }> = () => null;

const EMPTY_ACTIVE: ToolbarActiveState = {
  headingLevel: null,
  bold: false,
  italic: false,
  strikethrough: false,
  inlineCode: false,
  marks: [],
  blockquote: false,
  codeBlock: false,
  bulletList: false,
  orderedList: false,
  taskList: false,
  blockInsertDisabled: false,
};

function makeCtx(overrides: Partial<ToolbarContext> = {}): ToolbarContext {
  return {
    editorRef: { current: null } as ToolbarContext['editorRef'],
    getView: () => null,
    active: EMPTY_ACTIVE,
    isSingleFileMode: false,
    ...overrides,
  };
}

function item(partial: Partial<ToolbarItem> & Pick<ToolbarItem, 'id' | 'group'>): ToolbarItem {
  return {
    order: 0,
    labelKey: `label.${partial.id}`,
    icon: Icon,
    run: () => {},
    ...partial,
  };
}

describe('buildToolbarEntries', () => {
  it('按 section 顺序再按 item.order 排序', () => {
    const items = [
      item({ id: 'insert-b', group: 'insert', order: 2 }),
      item({ id: 'inline-a', group: 'inline', order: 1 }),
      item({ id: 'blocks-a', group: 'blocks', order: 0 }),
      item({ id: 'inline-b', group: 'inline', order: 0 }),
    ];
    const entries = buildToolbarEntries(items, makeCtx());
    expect(entries.map((e) => e.id)).toEqual(['inline-b', 'inline-a', 'blocks-a', 'insert-b']);
  });

  it('为每个 section 的首项标记 isSectionStart，且只标记一次', () => {
    const items = [
      item({ id: 'inline-a', group: 'inline', order: 0 }),
      item({ id: 'inline-b', group: 'inline', order: 1 }),
      item({ id: 'lists-a', group: 'lists', order: 0 }),
      item({ id: 'lists-b', group: 'lists', order: 1 }),
    ];
    const entries = buildToolbarEntries(items, makeCtx());
    expect(entries.filter((e) => e.isSectionStart).map((e) => e.id)).toEqual(['inline-a', 'lists-a']);
  });

  it('空 section 不产生条目', () => {
    const entries = buildToolbarEntries([item({ id: 'inline-a', group: 'inline' })], makeCtx());
    expect(entries.map((e) => e.section)).toEqual(['inline']);
  });

  it('投影 active 与 disabled', () => {
    const items = [
      item({ id: 'bold', group: 'inline', activeKey: 'bold' }),
      item({ id: 'image', group: 'insert', isDisabled: () => true }),
    ];
    const entries = buildToolbarEntries(
      items,
      makeCtx({ active: { ...EMPTY_ACTIVE, bold: true } }),
    );
    expect(entries.find((e) => e.id === 'bold')?.active).toBe(true);
    expect(entries.find((e) => e.id === 'image')?.disabled).toBe(true);
  });

  it('run 会聚焦编辑器并执行 item.run', () => {
    let ran = 0;
    let focused = 0;
    const view = { focus: () => { focused += 1; } } as never;
    const entries = buildToolbarEntries(
      [item({ id: 'bold', group: 'inline', run: () => { ran += 1; } })],
      makeCtx({ getView: () => view }),
    );
    entries[0].run();
    expect(focused).toBe(1);
    expect(ran).toBe(1);
  });

  it('无 view 时 run 不执行 item.run', () => {
    let ran = 0;
    const entries = buildToolbarEntries(
      [item({ id: 'bold', group: 'inline', run: () => { ran += 1; } })],
      makeCtx(),
    );
    entries[0].run();
    expect(ran).toBe(0);
  });
});

describe('omittedToolbarEntries', () => {
  const entries = buildToolbarEntries(
    [
      item({ id: 'a', group: 'inline', order: 0 }),
      item({ id: 'b', group: 'inline', order: 1 }),
      item({ id: 'c', group: 'inline', order: 2 }),
    ],
    makeCtx(),
  );

  it('全部显示时为空', () => {
    expect(omittedToolbarEntries(entries, entries.length - 1)).toEqual([]);
  });

  it('部分显示时返回其后缀', () => {
    expect(omittedToolbarEntries(entries, 0).map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('全部折叠（visibleCount=-1）时返回全部', () => {
    expect(omittedToolbarEntries(entries, -1).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('groupEntriesBySection', () => {
  it('把连续同 section 的条目合并为一段', () => {
    const entries = buildToolbarEntries(
      [
        item({ id: 'inline-a', group: 'inline', order: 0 }),
        item({ id: 'inline-b', group: 'inline', order: 1 }),
        item({ id: 'lists-a', group: 'lists', order: 0 }),
      ],
      makeCtx(),
    );
    const groups = groupEntriesBySection(entries);
    expect(groups.map((g) => g.section)).toEqual(['inline', 'lists']);
    expect(groups[0].entries.map((e) => e.id)).toEqual(['inline-a', 'inline-b']);
  });
});

describe('isEntryVisible', () => {
  it('索引不超过可见数时可见，否则不可见', () => {
    expect(isEntryVisible(0, 2)).toBe(true);
    expect(isEntryVisible(2, 2)).toBe(true);
    expect(isEntryVisible(3, 2)).toBe(false);
  });

  it('visibleCount=-1 时全部不可见', () => {
    expect(isEntryVisible(0, -1)).toBe(false);
  });
});

describe('activeMark / isActive', () => {
  it('activeMark 从 active.marks 判定', () => {
    const entries = buildToolbarEntries(
      [item({ id: 'ul', group: 'inline', activeMark: 'underline' })],
      makeCtx({ active: { ...EMPTY_ACTIVE, marks: ['underline'] } }),
    );
    expect(entries[0]!.active).toBe(true);
  });

  it('isActive 优先于 activeMark', () => {
    const entries = buildToolbarEntries(
      [item({ id: 'x', group: 'inline', activeMark: 'm', isActive: () => true })],
      makeCtx({ active: { ...EMPTY_ACTIVE, marks: [] } }),
    );
    expect(entries[0]!.active).toBe(true);
  });

  it('isActive=false 覆盖命中的 activeMark', () => {
    const entries = buildToolbarEntries(
      [item({ id: 'x', group: 'inline', activeMark: 'm', isActive: () => false })],
      makeCtx({ active: { ...EMPTY_ACTIVE, marks: ['m'] } }),
    );
    expect(entries[0]!.active).toBe(false);
  });

  it('activeMark 未命中 marks 时为 false', () => {
    const entries = buildToolbarEntries(
      [item({ id: 'y', group: 'inline', activeMark: 'm' })],
      makeCtx({ active: { ...EMPTY_ACTIVE, marks: [] } }),
    );
    expect(entries[0]!.active).toBe(false);
  });
});
