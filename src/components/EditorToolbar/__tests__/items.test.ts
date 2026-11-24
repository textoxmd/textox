import { describe, expect, it } from 'vitest';
import { BUILTIN_TOOLBAR_ITEMS } from '../items';
import { TOOLBAR_GROUPS } from '../groups';

const VALID_GROUPS = new Set(TOOLBAR_GROUPS.map((g) => g.id));

describe('BUILTIN_TOOLBAR_ITEMS', () => {
  it('id 唯一', () => {
    const ids = BUILTIN_TOOLBAR_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('group 合法且 order 为有限数', () => {
    for (const item of BUILTIN_TOOLBAR_ITEMS) {
      expect(VALID_GROUPS.has(item.group)).toBe(true);
      expect(Number.isFinite(item.order)).toBe(true);
    }
  });

  it('每个 item 具备 labelKey 与 run', () => {
    for (const item of BUILTIN_TOOLBAR_ITEMS) {
      expect(item.labelKey.length).toBeGreaterThan(0);
      expect(typeof item.run).toBe('function');
      expect(item.icon).toBeTruthy();
    }
  });

  it('覆盖全部四个分组', () => {
    const groups = new Set(BUILTIN_TOOLBAR_ITEMS.map((i) => i.group));
    expect([...groups].sort()).toEqual(['blocks', 'inline', 'insert', 'lists']);
  });
});
