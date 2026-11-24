import { describe, expect, it } from 'vitest';
import { isAgentTabVisible, resolveActiveTab, restoreTabAfterClose } from '../tab';

describe('isAgentTabVisible', () => {
  it('idle 不显示，其余状态显示', () => {
    expect(isAgentTabVisible('idle')).toBe(false);
    expect(isAgentTabVisible('streaming')).toBe(true);
    expect(isAgentTabVisible('done')).toBe(true);
    expect(isAgentTabVisible('error')).toBe(true);
  });
});

describe('restoreTabAfterClose', () => {
  it('优先回到进入释义前的 tab', () => {
    expect(restoreTabAfterClose('outline', { hasFile: true, hasRoot: true })).toBe('outline');
    expect(restoreTabAfterClose('files', { hasFile: true, hasRoot: true })).toBe('files');
  });

  it('目标不可用时回落到可用 tab', () => {
    expect(restoreTabAfterClose('outline', { hasFile: false, hasRoot: true })).toBe('files');
    expect(restoreTabAfterClose('files', { hasFile: true, hasRoot: false })).toBeNull();
  });

  it('文件和目录都不可用时返回 null', () => {
    expect(restoreTabAfterClose('outline', { hasFile: false, hasRoot: false })).toBeNull();
    expect(restoreTabAfterClose('files', { hasFile: false, hasRoot: false })).toBeNull();
  });
});

describe('resolveActiveTab', () => {
  const base = {
    agentTabVisible: false,
    showAgent: false,
    closingTarget: null,
    showOutline: false,
    hasRoot: true,
    isSingleFileMode: false,
  };

  it('有结果且停留在释义视图时返回 ai', () => {
    expect(resolveActiveTab({ ...base, agentTabVisible: true, showAgent: true })).toBe('ai');
  });

  it('关闭中优先使用 closingTarget，避免闪回 files', () => {
    expect(
      resolveActiveTab({ ...base, showAgent: true, closingTarget: 'outline', showOutline: false }),
    ).toBe('outline');
    expect(resolveActiveTab({ ...base, showAgent: true, closingTarget: 'files' })).toBe('files');
  });

  it('无 closingTarget 时沿用原有自然默认', () => {
    expect(resolveActiveTab({ ...base, showOutline: true })).toBe('outline');
    expect(resolveActiveTab({ ...base })).toBe('files');
    expect(resolveActiveTab({ ...base, hasRoot: false })).toBe('outline');
    expect(resolveActiveTab({ ...base, isSingleFileMode: true })).toBe('outline');
  });
});
