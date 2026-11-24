import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, openMock, toastErrorMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: openMock }));
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, info: vi.fn() } }));
vi.mock('@/plugins/registry', () => ({ isDisabledFileExtension: () => false }));

import { openRecentItemPath, type OpenRecentItemDeps } from '../openRecentItem';

function createDeps(overrides: Partial<OpenRecentItemDeps> = {}): OpenRecentItemDeps {
  return {
    t: (key: string) => key,
    openFolder: vi.fn(async () => true),
    executeOpenFile: vi.fn(async () => true),
    addToRecentItems: vi.fn(async () => {}),
    removeRecentItem: vi.fn(),
    notifyDisabledFile: vi.fn(),
    updateWindowFile: vi.fn(async () => {}),
    updateWindowFolder: vi.fn(async () => {}),
    updateWindowMode: vi.fn(async () => {}),
    ...overrides,
  };
}

function respond(handlers: Record<string, (args?: Record<string, unknown>) => unknown>) {
  invokeMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
    const handler = handlers[command];
    return Promise.resolve(handler ? handler(args) : undefined);
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  openMock.mockReset();
  toastErrorMock.mockReset();
});

describe('openRecentItemPath', () => {
  it('目录成功打开后同步窗口信息并返回 true', async () => {
    respond({
      check_path_type: () => 'directory',
      has_bookmark: () => true,
      start_access: () => undefined,
    });
    const deps = createDeps();

    await expect(openRecentItemPath('/notes', deps)).resolves.toBe(true);

    expect(deps.openFolder).toHaveBeenCalledWith('/notes');
    expect(deps.updateWindowFile).toHaveBeenCalledWith(null);
    expect(deps.updateWindowFolder).toHaveBeenCalledWith('/notes');
    expect(deps.updateWindowMode).toHaveBeenCalledWith(false);
    expect(deps.addToRecentItems).toHaveBeenCalledWith('/notes');
  });

  it('打开失败时返回 false，且不写入窗口信息', async () => {
    respond({
      check_path_type: () => 'directory',
      has_bookmark: () => true,
      start_access: () => undefined,
    });
    const deps = createDeps({ openFolder: vi.fn(async () => false) });

    await expect(openRecentItemPath('/notes', deps)).resolves.toBe(false);

    expect(deps.updateWindowFile).not.toHaveBeenCalled();
    expect(deps.updateWindowFolder).not.toHaveBeenCalled();
    expect(deps.updateWindowMode).not.toHaveBeenCalled();
    expect(deps.addToRecentItems).not.toHaveBeenCalled();
  });

  it('文件打开失败时不标记为已打开', async () => {
    respond({
      check_path_type: () => 'file',
      has_bookmark: () => true,
      start_access: () => undefined,
    });
    const deps = createDeps({ executeOpenFile: vi.fn(async () => false) });

    await expect(openRecentItemPath('/notes/a.md', deps)).resolves.toBe(false);

    expect(deps.updateWindowFile).not.toHaveBeenCalled();
    expect(deps.updateWindowMode).not.toHaveBeenCalled();
  });

  it('最近记录等记账失败不影响打开结果', async () => {
    respond({
      check_path_type: () => 'directory',
      has_bookmark: () => true,
      start_access: () => undefined,
    });
    const deps = createDeps({
      addToRecentItems: vi.fn(async () => {
        throw new Error('recent list unavailable');
      }),
    });

    await expect(openRecentItemPath('/notes', deps)).resolves.toBe(true);
    expect(deps.openFolder).toHaveBeenCalledWith('/notes');
  });

  it('路径不存在时移除最近记录并返回 false', async () => {
    respond({ check_path_type: () => null });
    const deps = createDeps();

    await expect(openRecentItemPath('/gone', deps)).resolves.toBe(false);

    expect(deps.removeRecentItem).toHaveBeenCalledWith('/gone');
    expect(toastErrorMock).toHaveBeenCalled();
    expect(deps.openFolder).not.toHaveBeenCalled();
  });

  it('书签失效时通过系统选择器重新授权', async () => {
    respond({
      check_path_type: () => 'directory',
      has_bookmark: () => false,
      create_bookmark: () => undefined,
    });
    openMock.mockResolvedValue('/picked');
    const deps = createDeps();

    await expect(openRecentItemPath('/notes', deps)).resolves.toBe(true);

    expect(openMock).toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith('create_bookmark', { path: '/picked' });
    expect(deps.openFolder).toHaveBeenCalledWith('/picked');
  });
});
