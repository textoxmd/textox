import { describe, expect, it } from 'vitest';
import {
  resolveOnboardingWorkspace,
  type ApplyWorkspaceContext,
  type OnboardingStartupConfig,
} from './onboardingStartup';

/** 首次启动引导关闭时的典型状态：主窗口已初始化出一个空白临时文档。 */
const blankCtx: ApplyWorkspaceContext = {
  currentFolder: null,
  hasBufferToKeep: false,
  fileHandleKind: 'temp',
};

const workspaceConfig: OnboardingStartupConfig = {
  startup_behavior: 'workspace',
  workspace_folder: '/Users/me/notes',
};

describe('resolveOnboardingWorkspace', () => {
  it('工作区模式 + 已选目录 + 空白文档：返回要打开的目录', () => {
    expect(resolveOnboardingWorkspace(workspaceConfig, blankCtx)).toBe('/Users/me/notes');
  });

  it('空白启动模式：不切换', () => {
    expect(
      resolveOnboardingWorkspace(
        { startup_behavior: 'blank', workspace_folder: '/Users/me/notes' },
        blankCtx,
      ),
    ).toBeNull();
  });

  it('工作区模式但没选目录：不切换', () => {
    expect(
      resolveOnboardingWorkspace({ startup_behavior: 'workspace', workspace_folder: null }, blankCtx),
    ).toBeNull();
    expect(resolveOnboardingWorkspace({ startup_behavior: 'workspace' }, blankCtx)).toBeNull();
    expect(
      resolveOnboardingWorkspace({ startup_behavior: 'workspace', workspace_folder: '' }, blankCtx),
    ).toBeNull();
  });

  it('当前已打开同一个工作区：不重复打开', () => {
    expect(
      resolveOnboardingWorkspace(workspaceConfig, {
        ...blankCtx,
        currentFolder: '/Users/me/notes',
      }),
    ).toBeNull();
  });

  it('当前打开的是另一个工作区：切换到向导选的目录', () => {
    expect(
      resolveOnboardingWorkspace(workspaceConfig, { ...blankCtx, currentFolder: '/Users/me/old' }),
    ).toBe('/Users/me/notes');
  });

  it('当前有未保存正文：不切目录，避免丢内容', () => {
    expect(
      resolveOnboardingWorkspace(workspaceConfig, { ...blankCtx, hasBufferToKeep: true }),
    ).toBeNull();
  });

  it('当前已打开磁盘文件：不切目录', () => {
    expect(
      resolveOnboardingWorkspace(workspaceConfig, { ...blankCtx, fileHandleKind: 'persistent' }),
    ).toBeNull();
  });

  it('配置缺失：不切换', () => {
    expect(resolveOnboardingWorkspace(null, blankCtx)).toBeNull();
  });
});
