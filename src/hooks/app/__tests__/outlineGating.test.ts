import { describe, expect, it } from 'vitest';
import { isSidebarOutlineVisible, shouldComputeOutline } from '../outlineGating';

describe('isSidebarOutlineVisible', () => {
  it('侧栏大纲 tab 展开时可见', () => {
    expect(isSidebarOutlineVisible('outline', false)).toBe(true);
  });

  it('其他 tab 不可见', () => {
    expect(isSidebarOutlineVisible('files', false)).toBe(false);
    expect(isSidebarOutlineVisible('ai', false)).toBe(false);
  });

  it('侧栏折叠时即使停在大纲 tab 也不可见', () => {
    expect(isSidebarOutlineVisible('outline', true)).toBe(false);
  });
});

describe('shouldComputeOutline', () => {
  it('面板关闭、非 # 模式、侧栏大纲不可见时不计算', () => {
    expect(shouldComputeOutline('off', false, false)).toBe(false);
  });

  it('面板开启时计算', () => {
    expect(shouldComputeOutline('text', false, false)).toBe(true);
    expect(shouldComputeOutline('minimap', false, false)).toBe(true);
  });

  it('# 命令模式即使面板关闭也计算', () => {
    expect(shouldComputeOutline('off', true, false)).toBe(true);
  });

  it('侧栏大纲可见时即使面板关闭也计算', () => {
    expect(shouldComputeOutline('off', false, true)).toBe(true);
  });

  it('App 组合：折叠的侧栏大纲 tab 不触发计算，展开后才计算', () => {
    const outlineStyle = 'off' as const;
    const isOutlineMode = false;

    expect(
      shouldComputeOutline(outlineStyle, isOutlineMode, isSidebarOutlineVisible('outline', true)),
    ).toBe(false);
    expect(
      shouldComputeOutline(outlineStyle, isOutlineMode, isSidebarOutlineVisible('outline', false)),
    ).toBe(true);
  });
});
