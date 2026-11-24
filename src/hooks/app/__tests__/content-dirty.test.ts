import { describe, expect, it } from 'vitest';
import { resolveDirty } from '../core/dirty';

describe('resolveDirty', () => {
  it('优先使用编辑器 meta', () => {
    expect(resolveDirty('abc', 'abc', 'abc', { stateId: 1, dirty: true })).toBe(true);
    expect(resolveDirty('abc', 'abc', 'abc', { stateId: 1, dirty: false })).toBe(false);
  });

  it('没有 meta 时回退文本比较', () => {
    expect(resolveDirty('abc', 'abc', 'abc', undefined)).toBe(false);
    expect(resolveDirty('abcd', 'abc', 'abc', undefined)).toBe(true);
  });
});
